import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { TeamsoApiError, TeamsoResponseTooLargeError, type TeamsoClient } from '../client.js';
import type {
  ApiCallResponse,
  ApiQueryValue,
  ApiRequestBody,
  ApiUploadFile,
  HelpLanguage,
} from '../types.js';
import {
  HTTP_METHODS,
  SIDE_EFFECTS,
  checkQuery,
  displayPath,
  exampleFromSchema,
  isBinarySchema,
  isRecord,
  pathVariables,
  resolvePath,
  safeStringify,
  shapeResult,
  splitEndpointId,
  toApiEndpointDetails,
  toApiEndpointSummary,
  toApiModule,
  validateBody,
  type ApiEndpointDetails,
  type ApiEndpointSummary,
  type BodyValidation,
  type ShapedResult,
} from '../utils/api-endpoints.js';
import { escapeCell, markdownTable } from '../utils/format.js';
import {
  ToolInputError,
  apiErrorResult,
  errorResult,
  toolResult,
  type ApiErrorHints,
  type NextAction,
} from '../utils/results.js';
import {
  apiEndpointDescriptionOutputSchema,
  apiEndpointListOutputSchema,
  apiModulesOutputSchema,
  apiReadOutputSchema,
  apiWriteOutputSchema,
  otpOutputSchema,
} from './schemas.js';
import { ADDITIVE_WRITE, DESTRUCTIVE_WRITE, READ_ONLY, otpCodeSchema } from './shared.js';

/** Largest file returned as an embedded resource. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
/** Largest JSON response read from the API (it is then shortened to `MAX_RESULT_CHARS`). */
const MAX_JSON_RESPONSE_BYTES = 16 * 1024 * 1024;
/** Largest total of uploaded files per call (decoded). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_JSON_BODY_CHARS = 2 * 1024 * 1024;
const MAX_UPLOAD_FILES = 10;
const MAX_PREVIEW_BODY_CHARS = 20_000;
const MAX_TEXT_SCHEMA_CHARS = 6_000;
const SIDE_EFFECT_SCAN_PAGE_SIZE = 100;
const SIDE_EFFECT_SCAN_MAX_PAGES = 30;
const OTP_VALIDITY_SECONDS = 180;

// ------------------------------------------------------------------ inputs

const langSchema = z.enum(['tr', 'en']).optional()
  .describe('Language of module titles and summaries: `tr` (default) or `en`.');

const endpointIdSchema = z.string()
  .trim()
  .min(3)
  .max(300)
  .regex(/^(GET|POST|PUT|PATCH|DELETE)\s+\/\S*$/i, 'id must look like "METHOD /path", e.g. "GET /leave/{id}"')
  .describe('Endpoint id exactly as `find_api_endpoints` returns it: `"METHOD /path/{placeholder}"`, '
    + 'e.g. `"GET /expense-form/{id}"`. Placeholders stay in the id; their values go in `path_params`.');

const pathParamsSchema = z.record(
  z.string().min(1).max(100),
  z.union([z.string().max(500), z.number()]),
).optional()
  .describe('Values for the `{placeholders}` of the path, e.g. `{"id": "8f1c..."}`.');

const queryValueSchema = z.union([z.string().max(2_000), z.number(), z.boolean()]);
const querySchema = z.record(
  z.string().min(1).max(100),
  z.union([queryValueSchema, z.array(queryValueSchema).max(100)]),
).optional()
  .describe('Query parameters by name (see `describe_api_endpoint`); arrays repeat the parameter.');

const filesSchema = z.array(z.object({
  field: z.string().trim().min(1).max(100).describe('Multipart field name from the endpoint\'s body schema (e.g. `file`).'),
  filename: z.string().trim().min(1).max(200).describe('File name, e.g. `rapor.pdf`.'),
  content_type: z.string().trim().regex(/^[\w.+-]+\/[\w.+-]+$/, 'content_type must be a MIME type like application/pdf')
    .default('application/octet-stream')
    .describe('MIME type, e.g. `application/pdf` or `image/png`.'),
  base64: z.string().min(1).max(14_500_000).describe('File content, base64 encoded.'),
})).max(MAX_UPLOAD_FILES).optional()
  .describe(`Files for multipart endpoints (\`multipart: true\`), at most ${MAX_UPLOAD_FILES} files and 10 MB in total.`);

// ------------------------------------------------------------------- hints

const CATALOG_HINTS: ApiErrorHints = {
  notFound: 'Teamso has no endpoint with that id that your account can call: it does not exist, is hidden from '
    + 'MCP, or needs a permission you do not have. Find the right id with `find_api_endpoints` '
    + '(ids look like "GET /leave/{id}"; put placeholder values in `path_params`).',
};

const OTP_FLOW = 'Call `request_sms_code`, ask the user for the code from the SMS, then call `call_api_write` again '
  + 'with the same arguments, `confirm: true` and `otp_code` (codes are valid for 3 minutes).';

const CALL_HINTS: ApiErrorHints = {
  notFound: 'Teamso could not find that record, or it is not visible to you. Check the `path_params` and `query` '
    + 'values (ids come from list/search endpoints).',
  byCode: {
    OTP_NOT_DONE: `This action needs an SMS verification code (missing, expired or already used). ${OTP_FLOW}`,
    'validation error.The token is not correct.': 'The SMS code is wrong. Ask the user to check it, or call '
      + '`request_sms_code` for a new one.',
    'validation error.token is expired.': 'The SMS code has expired (codes are valid for 3 minutes). Call '
      + '`request_sms_code` for a new one.',
    'Token Not Found': 'No SMS code is waiting for verification. Call `request_sms_code` first.',
    CREDIT_INSUFFICIENT: 'Your company does not have enough digital (SMS) credit for this action. The SMS code was '
      + 'used up, so a retry after topping up needs a new code (`request_sms_code`).',
  },
};

// ------------------------------------------------------------------- tools

export function registerFindApiEndpoints(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'find_api_endpoints',
    {
      title: 'Find Teamso API endpoints',
      description: 'Search the Teamso API endpoints the caller is allowed to use (every module: leave, expenses, '
        + 'payroll, time tracking, recruiting, inventory, settings...). Use it when no specific Teamso tool fits. '
        + 'Each result has an `id` ("METHOD /path"), a summary, its side effect (`read`, `write`, `delete`, '
        + '`read_with_writes`) and whether it needs an SMS code or returns a file. Then call '
        + '`describe_api_endpoint`. Every word of `query` must match (Turkish-insensitive), so use 1-3 keywords.',
      inputSchema: {
        query: z.string().trim().max(200).optional()
          .describe('Keywords matched against path, summary, module and screen names, e.g. "masraf" or "expense form".'),
        module: z.string().trim().min(1).max(60).optional()
          .describe('Module code from `list_api_modules`, e.g. `LEAVE`, `EXPENSE`, `PAY_SLIP`.'),
        method: z.enum(HTTP_METHODS).optional().describe('Only this HTTP method.'),
        side_effect: z.enum(SIDE_EFFECTS).optional()
          .describe('Only endpoints with this side effect, e.g. `read` for safe lookups.'),
        page: z.number().int().min(1).max(1_000).default(1).describe('Page number, starting at 1.'),
        size: z.number().int().min(1).max(50).default(20).describe('Results per page (1-50, default 20).'),
        lang: langSchema,
      },
      outputSchema: apiEndpointListOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ query, module, method, side_effect, page, size, lang }, extra) => {
      try {
        const filter = {
          q: query || undefined,
          module: module?.toUpperCase(),
          method,
          lang: lang as HelpLanguage | undefined,
        };
        let endpoints: ApiEndpointSummary[];
        let total: number;
        let totalPages: number;
        if (side_effect) {
          // The catalog has no side-effect filter: scan it and page locally.
          const matches: ApiEndpointSummary[] = [];
          let complete = false;
          for (let serverPage = 1; serverPage <= SIDE_EFFECT_SCAN_MAX_PAGES; serverPage++) {
            const result = await client.listApiEndpoints(
              { ...filter, page: serverPage, size: SIDE_EFFECT_SCAN_PAGE_SIZE },
              extra.signal,
            );
            const items = summariesOf(result.items);
            matches.push(...items.filter(item => item.sideEffect === side_effect));
            const pages = typeof result.totalPages === 'number' ? result.totalPages : undefined;
            if ((result.items?.length ?? 0) < SIDE_EFFECT_SCAN_PAGE_SIZE || (pages !== undefined && serverPage >= pages)) {
              complete = true;
              break;
            }
          }
          total = matches.length;
          totalPages = Math.max(1, Math.ceil(total / size));
          endpoints = matches.slice((page - 1) * size, page * size);
          if (!complete) totalPages = Math.max(totalPages, page + 1);
        } else {
          const result = await client.listApiEndpoints({ ...filter, page, size }, extra.signal);
          endpoints = summariesOf(result.items);
          total = typeof result.total === 'number' ? result.total : endpoints.length;
          totalPages = typeof result.totalPages === 'number' ? result.totalPages : Math.max(1, Math.ceil(total / size));
        }

        const structured = {
          ...(query ? { query } : {}),
          ...(filter.module ? { module: filter.module } : {}),
          ...(method ? { method } : {}),
          ...(side_effect ? { sideEffect: side_effect } : {}),
          page,
          size,
          total,
          totalPages,
          endpoints,
        };
        if (endpoints.length === 0) {
          const text = total > 0
            ? `No results on page ${page}; there are ${totalPages} page(s).`
            : 'No endpoint you can call matches this search. Use fewer or different keywords (every word must '
              + 'match), try English or Turkish terms, or browse with `list_api_modules`. If the endpoint exists but '
              + 'is not listed, your Teamso account lacks the permission for it.';
          return toolResult(text, structured);
        }
        const table = markdownTable(
          ['Endpoint', 'Summary', 'Effect', 'SMS code', 'File'],
          endpoints.map(endpoint => [
            `\`${endpoint.id}\``,
            truncateText(endpoint.summary ?? '', 140),
            endpoint.sideEffect,
            endpoint.smsCodeRequired === 'never' ? '' : endpoint.smsCodeRequired,
            endpoint.fileResponse ? 'yes' : '',
          ]),
        );
        const more = page < totalPages ? `\n\nMore results: call again with \`page: ${page + 1}\`.` : '';
        return toolResult(
          `## API endpoints you can call (${total} found, page ${page}/${totalPages})\n\n${table}${more}\n\n`
            + 'Next: `describe_api_endpoint` with the `id` to see its parameters and body.',
          {
            ...structured,
            nextAction: {
              tool: 'describe_api_endpoint',
              arguments: { id: endpoints[0]!.id },
              reason: 'See the parameters, body schema and SMS/file notes of the endpoint before calling it.',
            },
          },
        );
      } catch (error) {
        return apiErrorResult(error, {
          notFound: 'This Teamso server does not offer the API catalog yet. Use the specific Teamso tools instead.',
        });
      }
    },
  );
}

export function registerListApiModules(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_api_modules',
    {
      title: 'List Teamso API modules',
      description: 'List the Teamso product modules (leave, time tracking, payroll, expenses, recruiting...) with how '
        + 'many API endpoints the caller can use in each. Use a module `code` to narrow `find_api_endpoints`.',
      inputSchema: { lang: langSchema },
      outputSchema: apiModulesOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ lang }, extra) => {
      try {
        const modules = (await client.listApiModules(lang as HelpLanguage | undefined, extra.signal))
          .map(toApiModule)
          .filter((module): module is NonNullable<ReturnType<typeof toApiModule>> => module !== null);
        const usable = modules.filter(module => module.allowedCount > 0);
        if (usable.length === 0) {
          return toolResult('Your Teamso account cannot call any catalogued API endpoint.', { modules });
        }
        const table = markdownTable(
          ['Code', 'Module', 'You can call', 'Total'],
          usable.map(module => [`\`${module.code}\``, module.title, module.allowedCount, module.endpointCount]),
        );
        const hidden = modules.length - usable.length;
        return toolResult(
          `## Teamso API modules\n\n${table}`
            + (hidden ? `\n\n${hidden} more module(s) have no endpoint you can call.` : ''),
          {
            modules,
            nextAction: {
              tool: 'find_api_endpoints',
              arguments: { module: usable[0]!.code },
              reason: 'List the endpoints of the module that fits the user\'s task (add `query` keywords to narrow it).',
            },
          },
        );
      } catch (error) {
        return apiErrorResult(error, {
          notFound: 'This Teamso server does not offer the API catalog yet. Use the specific Teamso tools instead.',
        });
      }
    },
  );
}

export function registerDescribeApiEndpoint(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'describe_api_endpoint',
    {
      title: 'Describe a Teamso API endpoint',
      description: 'Show how to call one Teamso API endpoint the caller may use: path and query parameters, the '
        + 'JSON Schema of the request body, response kind (JSON or file), side effect, SMS-code requirement and '
        + 'notes, plus ready-made example arguments for `call_api_read` (reads) or `call_api_write` (changes).',
      inputSchema: {
        id: endpointIdSchema,
        lang: langSchema,
      },
      outputSchema: apiEndpointDescriptionOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ id, lang }, extra) => {
      try {
        const details = await loadEndpoint(client, id, lang as HelpLanguage | undefined, extra.signal);
        const example = exampleCall(details);
        const isRead = details.sideEffect === 'read';
        const lines = [
          `## \`${details.id}\``,
          '',
          details.summary ?? '',
          '',
          `- **Effect:** ${effectLabel(details)}`,
          `- **Module:** ${details.moduleTitle ?? details.module ?? '—'}`,
          `- **Access:** ${details.access ?? 'allowed'}${details.accessReason ? ` (${details.accessReason})` : ''}`,
          `- **SMS code:** ${smsLabel(details)}`,
          `- **Response:** ${details.fileResponse ? 'a file (returned as an embedded resource)' : 'JSON'}`
            + `${details.multipart ? '; the request is multipart (use `files`)' : ''}`,
        ];
        const parameters = details.parameters.filter(parameter => parameter.in !== 'header' || parameter.required);
        if (parameters.length) {
          lines.push('', '### Parameters', '', markdownTable(
            ['Name', 'In', 'Required', 'Type'],
            parameters.map(parameter => [
              `\`${parameter.name}\``,
              parameter.in,
              parameter.required ? 'yes' : 'no',
              typeLabel(parameter.schema),
            ]),
          ));
        }
        if (details.requestBody) {
          const schemaText = safeStringify(details.requestBody.schema, 2);
          lines.push('', `### Body (${details.requestBody.contentType}${details.requestBody.required ? ', required' : ''})`, '',
            '```json', truncateText(schemaText, MAX_TEXT_SCHEMA_CHARS), '```');
          if (schemaText.length > MAX_TEXT_SCHEMA_CHARS) {
            lines.push('', '_Schema shortened here; the full schema is in `structuredContent.requestBody.schema`._');
          }
        }
        if (details.notes.length) {
          lines.push('', '### Notes', '', ...details.notes.map(note => `- ${note}`));
        }
        lines.push('', `### Example \`${example.tool}\` arguments`, '', '```json', safeStringify(example.arguments, 2), '```');
        lines.push('', isRead
          ? 'Replace the `<placeholders>` and call `call_api_read`.'
          : 'Replace the `<placeholders>` and call `call_api_write` without `confirm` to get a preview. Show the '
            + 'preview to the user and repeat the call with `confirm: true` only after they explicitly agree.');
        return toolResult(lines.join('\n'), {
          endpoint: {
            ...summaryOf(details),
            ...(details.accessReason ? { accessReason: details.accessReason } : {}),
            ...(details.permission ? { permission: details.permission } : {}),
            ...(details.moduleDescription ? { moduleDescription: details.moduleDescription } : {}),
            ...(details.responseKind ? { responseKind: details.responseKind } : {}),
            ...(details.doc ? { doc: details.doc } : {}),
            webScreens: details.webScreens,
          },
          sms: details.sms,
          parameters: details.parameters,
          requestBody: details.requestBody,
          notes: details.notes,
          related: details.related,
          example,
          nextAction: {
            tool: example.tool,
            arguments: example.arguments,
            reason: isRead
              ? 'Fill in the placeholders with real values and call it.'
              : 'Fill in the placeholders and call without confirm for a preview; run it with confirm=true only after '
                + 'the user explicitly confirms the preview.'
                + (details.sms && (details.sms.mode === 'always' || details.sms.preVerify)
                  ? ' It needs an SMS code: call request_sms_code after the confirmation and pass otp_code.'
                  : ''),
          },
        });
      } catch (error) {
        return apiErrorResult(error, CATALOG_HINTS);
      }
    },
  );
}

export function registerCallApiRead(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'call_api_read',
    {
      title: 'Read data through the Teamso API',
      description: 'Call a Teamso API endpoint whose side effect is `read` (from `find_api_endpoints` / '
        + '`describe_api_endpoint`) and return its data. The request is marked read-only, so Teamso refuses '
        + 'anything that would change data; endpoints that write are refused here (use `call_api_write`). Large '
        + 'lists are shortened with `truncated: true`; files (PDF, Excel, CSV, images) come back as an embedded '
        + 'resource (up to 8 MB). Runs with the caller\'s own Teamso permissions.',
      inputSchema: {
        id: endpointIdSchema.optional(),
        method: z.enum(HTTP_METHODS).optional().describe('With `path`, instead of `id`.'),
        path: z.string().trim().min(1).max(300).optional()
          .describe('Catalog path pattern with placeholders (e.g. `/leave/{id}`), with `method`, instead of `id`.'),
        path_params: pathParamsSchema,
        query: querySchema,
        body: z.unknown().optional()
          .describe('Only for reads sent as POST (the filter goes in the body); see `describe_api_endpoint`.'),
        lang: langSchema,
      },
      outputSchema: apiReadOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ id, method, path, path_params, query, body, lang }, extra) => {
      try {
        const endpointId = endpointIdOf(id, method, path);
        const details = await loadEndpoint(client, endpointId, lang as HelpLanguage | undefined, extra.signal);
        if (details.sideEffect !== 'read') {
          return errorResult(`\`${details.id}\` ${effectLabel(details).toLowerCase()}, so \`call_api_read\` does not run `
            + 'it. Use `call_api_write` with the same arguments: it shows a preview first, and runs only after the '
            + 'user confirms.');
        }
        const prepared = prepareRequest(details, { path_params, query, body });
        if (!prepared.validation.valid) {
          return errorResult(`The request does not match \`${details.id}\`:\n\n`
            + prepared.validation.errors.map(problem => `- ${problem}`).join('\n')
            + '\n\nCheck the parameters with `describe_api_endpoint`.');
        }
        const response = await client.callApi({
          method: details.method,
          path: prepared.path,
          query: prepared.query,
          body: prepared.body,
          readIntent: true,
          maxResponseBytes: details.fileResponse ? MAX_FILE_BYTES : MAX_JSON_RESPONSE_BYTES,
        }, extra.signal);
        const request = { method: details.method, path: displayPath(prepared.path, prepared.query) };
        const rendered = renderResponse(details, request.path, response);
        return {
          content: rendered.content,
          structuredContent: {
            endpoint: summaryOf(details),
            request,
            ...rendered.structured,
            warnings: prepared.warnings,
          },
        };
      } catch (error) {
        return callErrorResult(error, true);
      }
    },
  );
}

export function registerCallApiWrite(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'call_api_write',
    {
      title: 'Change data through the Teamso API',
      description: 'Create, update, approve or delete something through a Teamso API endpoint from '
        + '`find_api_endpoints` (side effect `write`, `delete` or `read_with_writes`). Without `confirm` it only '
        + 'returns a PREVIEW (resolved request, body checked against the endpoint\'s JSON Schema, warnings, SMS-code '
        + 'need) and sends nothing. Show the preview to the user; only after they explicitly confirm, call again '
        + 'with the same arguments and `confirm: true`. Endpoints that need an SMS code also need `otp_code` '
        + '(see `request_sms_code`). Runs with the caller\'s own Teamso permissions.',
      inputSchema: {
        id: endpointIdSchema,
        path_params: pathParamsSchema,
        query: querySchema,
        body: z.unknown().optional()
          .describe('Request body: JSON matching the endpoint\'s body schema. For multipart endpoints, an object of '
            + 'the non-file form fields.'),
        files: filesSchema,
        confirm: z.boolean().default(false)
          .describe('false (default): preview only, nothing is sent. true: run it — only after the user explicitly '
            + 'confirmed the preview.'),
        otp_code: otpCodeSchema.optional()
          .describe('SMS verification code from `request_sms_code`, for endpoints that need one (valid for 3 minutes).'),
        lang: langSchema,
      },
      outputSchema: apiWriteOutputSchema,
      annotations: DESTRUCTIVE_WRITE,
    },
    async ({ id, path_params, query, body, files, confirm, otp_code, lang }, extra) => {
      try {
        const details = await loadEndpoint(client, id, lang as HelpLanguage | undefined, extra.signal);
        if (details.sideEffect === 'read') {
          return errorResult(`\`${details.id}\` only reads data. Use \`call_api_read\` with the same arguments; `
            + 'it needs no confirmation.');
        }
        const prepared = prepareRequest(details, { path_params, query, body, files });
        const warnings = [...prepared.warnings];
        const sms = details.sms;
        const codeFirst = Boolean(sms && (sms.mode === 'always' || sms.preVerify));
        if (otp_code && !sms) {
          warnings.push('`otp_code` is not needed by this endpoint and is not used.');
        }
        const request = { method: details.method, path: displayPath(prepared.path, prepared.query) };
        const summary = humanSummary(details, request.path);
        const common = {
          endpoint: summaryOf(details),
          request,
          summary,
          validation: prepared.validation,
          sms,
          files: prepared.files,
        };

        if (!confirm) {
          const previewBody = previewBodyOf(body, prepared.body, warnings);
          const nextAction = previewNextAction(details, { id, path_params, query, body, files, otp_code, lang },
            prepared.validation, codeFirst && !otp_code);
          return toolResult(previewText(details, request.path, summary, prepared, previewBody, warnings), {
            mode: 'preview',
            ...common,
            ...(previewBody !== undefined ? { body: previewBody } : {}),
            warnings,
            nextAction,
          });
        }

        if (!prepared.validation.valid) {
          return errorResult(`Nothing was sent: the request does not match \`${details.id}\`.\n\n`
            + prepared.validation.errors.map(problem => `- ${problem}`).join('\n')
            + '\n\nFix it (see `describe_api_endpoint`), preview again and get the user\'s confirmation.');
        }
        if (codeFirst && !otp_code) {
          return errorResult(`Nothing was sent: \`${details.id}\` needs an SMS verification code`
            + `${sms?.preVerify ? ' before the first attempt' : ''}. ${OTP_FLOW}`);
        }

        const call = () => client.callApi({
          method: details.method,
          path: prepared.path,
          query: prepared.query,
          body: prepared.body,
          maxResponseBytes: details.fileResponse ? MAX_FILE_BYTES : MAX_JSON_RESPONSE_BYTES,
        }, extra.signal);
        let smsVerified = false;
        // Verify only right before the call: a verified code unlocks the next SMS-protected action.
        if (codeFirst && otp_code) {
          await client.verifyOtp(otp_code, extra.signal);
          smsVerified = true;
        }
        let response: ApiCallResponse;
        try {
          response = await call();
        } catch (error) {
          // Conditional SMS: the API asks for the code only in some cases. Verify and retry once.
          if (!smsVerified && otp_code && error instanceof TeamsoApiError && error.messageCode === 'OTP_NOT_DONE') {
            await client.verifyOtp(otp_code, extra.signal);
            smsVerified = true;
            response = await call();
          } else {
            throw error;
          }
        }
        const rendered = renderResponse(details, request.path, response, 'Done');
        return {
          content: rendered.content,
          structuredContent: {
            mode: 'executed',
            ...common,
            smsVerified,
            warnings,
            ...rendered.structured,
          },
        };
      } catch (error) {
        return callErrorResult(error, false);
      }
    },
  );
}

export function registerRequestSmsCode(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'request_sms_code',
    {
      title: 'Send an SMS verification code',
      description: 'Send a 6-digit SMS verification code to the caller\'s phone, for API endpoints that need one '
        + '(`smsCodeRequired` in `find_api_endpoints`, e.g. expense finalisation, payslip approval, overtime '
        + 'conversion). The code is valid for 3 minutes, a new code invalidates the previous one, and each SMS uses '
        + 'company digital credit, so call it only after the user confirmed the action. Then ask the user for the '
        + 'code and pass it as `otp_code` to `call_api_write`. (`request_leave_otp` does the same for leave tools.)',
      inputSchema: {},
      outputSchema: otpOutputSchema,
      annotations: ADDITIVE_WRITE,
    },
    async (_args, extra) => {
      try {
        await client.requestOtp(extra.signal);
        const message = 'An SMS code was sent to your phone number registered in Teamso. It is valid for 3 minutes.';
        return toolResult(`${message}\n\nAsk the user for the code, then call \`call_api_write\` again with the same `
          + 'arguments, `confirm: true` and `otp_code`.', {
          sent: true,
          validForSeconds: OTP_VALIDITY_SECONDS,
          message,
          nextAction: {
            tool: 'call_api_write',
            arguments: { confirm: true, otp_code: '<code from the SMS>' },
            reason: 'Repeat the confirmed call_api_write call (same id, path_params, query, body and files) with '
              + 'the code within 3 minutes.',
          },
        });
      } catch (error) {
        return apiErrorResult(error, {
          byCode: {
            USER_NOT_FOUND: 'Teamso could not find a phone number for your account to send the SMS code to.',
          },
        });
      }
    },
  );
}

// ----------------------------------------------------------------- helpers

async function loadEndpoint(
  client: TeamsoClient,
  id: string,
  lang: HelpLanguage | undefined,
  signal?: AbortSignal,
): Promise<ApiEndpointDetails> {
  const parsed = splitEndpointId(id);
  if (!parsed) throw new ToolInputError('`id` must look like "METHOD /path", e.g. "GET /leave/{id}".');
  let description;
  try {
    description = await client.getApiEndpoint(`${parsed.method} ${parsed.path}`, lang, signal);
  } catch (error) {
    if (error instanceof TeamsoApiError && (error.status === 404 || error.messageCode === 'ITEM_NOT_FOUND')) {
      throw new ToolInputError(`${CATALOG_HINTS.notFound}\n\n_Teamso API: HTTP ${error.status} · \`ITEM_NOT_FOUND\`_`);
    }
    throw error;
  }
  const details = toApiEndpointDetails(description);
  if (!details) {
    throw new ToolInputError('The Teamso API catalog returned an incomplete description for this endpoint. '
      + 'Try again later or use the Teamso app.');
  }
  // Never call anything other than what the catalog described.
  if (details.id !== `${parsed.method} ${parsed.path}`) {
    throw new ToolInputError(`The catalog described \`${details.id}\` instead of \`${parsed.method} ${parsed.path}\`; `
      + 'nothing was called. Use the exact id from `find_api_endpoints`.');
  }
  return details;
}

function endpointIdOf(id: string | undefined, method: string | undefined, path: string | undefined): string {
  if (id) return id;
  if (method && path) {
    if (!path.startsWith('/')) throw new ToolInputError('`path` must start with "/" (a catalog path such as `/leave/{id}`).');
    return `${method} ${path}`;
  }
  throw new ToolInputError('Pass `id` (e.g. "GET /leave/{id}") or both `method` and `path`. '
    + 'Find ids with `find_api_endpoints`.');
}

function summariesOf(items: unknown): ApiEndpointSummary[] {
  return (Array.isArray(items) ? items : [])
    .filter(isRecord)
    .map(item => toApiEndpointSummary(item))
    .filter((item): item is ApiEndpointSummary => item !== null);
}

function summaryOf(details: ApiEndpointDetails): ApiEndpointSummary {
  return {
    id: details.id,
    method: details.method,
    path: details.path,
    ...(details.module ? { module: details.module } : {}),
    ...(details.moduleTitle ? { moduleTitle: details.moduleTitle } : {}),
    ...(details.summary ? { summary: details.summary } : {}),
    sideEffect: details.sideEffect,
    smsCodeRequired: details.smsCodeRequired,
    fileResponse: details.fileResponse,
    multipart: details.multipart,
    ...(details.access ? { access: details.access } : {}),
    ...(details.conditional !== undefined ? { conditional: details.conditional } : {}),
  };
}

interface PreparedRequest {
  path: string;
  query: Record<string, ApiQueryValue>;
  body?: ApiRequestBody;
  validation: BodyValidation;
  warnings: string[];
  files: Array<{ field: string; filename: string; contentType: string; sizeBytes: number }>;
}

interface RequestInput {
  path_params?: Record<string, string | number>;
  query?: Record<string, ApiQueryValue>;
  body?: unknown;
  files?: Array<{ field: string; filename: string; content_type: string; base64: string }>;
}

/** Resolves the path, checks the query and builds and validates the body. Problems go into `validation`. */
function prepareRequest(details: ApiEndpointDetails, input: RequestInput): PreparedRequest {
  const problems: string[] = [];
  const pathValues = input.path_params ?? {};
  const resolved = resolvePath(details.path, pathValues);
  problems.push(...resolved.problems);
  const query = input.query ?? {};
  const queryCheck = checkQuery(details.parameters, query);
  problems.push(...queryCheck.problems);
  const warnings = [...queryCheck.warnings];

  let body: ApiRequestBody | undefined;
  let checked = true;
  const files: PreparedRequest['files'] = [];
  const requestBody = details.requestBody;
  const hasBody = input.body !== undefined && input.body !== null;
  const hasFiles = (input.files?.length ?? 0) > 0;

  if (details.method === 'GET' && (hasBody || hasFiles)) {
    problems.push('GET requests carry no body or files; pass inputs in `query` or `path_params`.');
  } else if (!requestBody) {
    if (hasBody) problems.push('This endpoint takes no request body; pass inputs in `query` or `path_params`.');
    if (hasFiles) problems.push('This endpoint does not accept file uploads.');
  } else if (details.multipart || requestBody.contentType.startsWith('multipart/')) {
    const schema = requestBody.schema;
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const fileFields = Object.keys(properties).filter(name => isBinarySchema(properties[name]));
    const fields: Record<string, string[]> = {};
    const shape: Record<string, unknown> = {};
    if (hasBody) {
      if (!isRecord(input.body)) {
        problems.push('For multipart endpoints `body` must be an object of form fields (files go in `files`).');
      } else {
        for (const [name, value] of Object.entries(input.body)) {
          const values = Array.isArray(value) ? value : [value];
          if (values.some(item => item !== null && typeof item === 'object')) {
            problems.push(`body.${name}: multipart form fields must be text, numbers or booleans.`);
            continue;
          }
          fields[name] = values.filter(item => item !== null && item !== undefined).map(String);
          shape[name] = value;
        }
      }
    }
    const uploads: ApiUploadFile[] = [];
    let totalBytes = 0;
    for (const file of input.files ?? []) {
      if (fileFields.length && !fileFields.includes(file.field)) {
        problems.push(`files: "${file.field}" is not a file field of this endpoint (file fields: ${fileFields.join(', ')}).`);
        continue;
      }
      const data = decodeBase64(file.base64);
      if (!data) {
        problems.push(`files: "${file.filename}" is not valid base64.`);
        continue;
      }
      totalBytes += data.byteLength;
      const filename = file.filename.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f\u007f"]/g, '');
      uploads.push({ field: file.field, filename, contentType: file.content_type, data });
      files.push({ field: file.field, filename, contentType: file.content_type, sizeBytes: data.byteLength });
      const existing = shape[file.field];
      const isArrayField = isRecord(properties[file.field]) && (properties[file.field] as Record<string, unknown>).type === 'array';
      shape[file.field] = isArrayField
        ? [...(Array.isArray(existing) ? existing : []), '<file>']
        : '<file>';
    }
    if (totalBytes > MAX_UPLOAD_BYTES) {
      problems.push(`files: ${formatBytes(totalBytes)} in total; at most ${formatBytes(MAX_UPLOAD_BYTES)} can be uploaded per call.`);
    }
    const validation = validateBody(schema, shape);
    checked = validation.checked;
    problems.push(...validation.errors);
    body = { kind: 'multipart', fields, files: uploads };
  } else {
    if (hasFiles) problems.push('This endpoint does not accept file uploads; send the data in `body`.');
    if (!hasBody) {
      if (requestBody.required) problems.push('body is required (see the body schema in `describe_api_endpoint`).');
    } else {
      const text = safeStringify(input.body);
      if (text.length > MAX_JSON_BODY_CHARS) {
        problems.push(`body is too large (${formatBytes(text.length)}; at most ${formatBytes(MAX_JSON_BODY_CHARS)}).`);
      }
      const validation = validateBody(requestBody.schema, input.body);
      checked = validation.checked;
      problems.push(...validation.errors);
      if (requestBody.contentType.startsWith('text/')) {
        if (typeof input.body !== 'string') problems.push('body must be a string (this endpoint takes plain text).');
        else body = { kind: 'text', value: input.body, contentType: requestBody.contentType };
      } else {
        body = { kind: 'json', value: input.body };
      }
    }
  }

  if (!checked) warnings.push('The body schema could not be checked; Teamso validates the body itself.');
  return {
    path: resolved.path,
    query,
    body,
    validation: { checked, valid: problems.length === 0, errors: problems },
    warnings,
    files,
  };
}

function decodeBase64(value: string): Uint8Array | null {
  const cleaned = value.replace(/^data:[^,]*;base64,/i, '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned) || cleaned.length % 4 === 1) return null;
  return new Uint8Array(Buffer.from(cleaned, 'base64'));
}

interface Rendered {
  content: CallToolResult['content'];
  structured: Record<string, unknown>;
}

function renderResponse(details: ApiEndpointDetails, requestPath: string, response: ApiCallResponse, verb = 'Result'): Rendered {
  if (response.kind === 'file') {
    if (response.data.byteLength > MAX_FILE_BYTES) {
      throw new TeamsoResponseTooLargeError(MAX_FILE_BYTES, response.data.byteLength);
    }
    if (response.data.byteLength === 0) {
      throw new ToolInputError('Teamso returned an empty file. Check the parameters, or open it in the Teamso app.');
    }
    const fileName = response.fileName ?? fallbackFileName(details.path, response.contentType);
    const resourceUri = `teamso://api/files/${encodeURIComponent(fileName)}`;
    const file = {
      fileName,
      mimeType: response.contentType,
      sizeBytes: response.data.byteLength,
      resourceUri,
    };
    return {
      content: [
        {
          type: 'text',
          text: `## ${verb}: \`${details.method} ${requestPath}\`\n\nFile \`${fileName}\` (${response.contentType}, `
            + `${formatBytes(response.data.byteLength)}) is attached.`,
        },
        {
          type: 'resource',
          resource: {
            uri: resourceUri,
            mimeType: response.contentType,
            blob: Buffer.from(response.data).toString('base64'),
          },
        },
      ],
      structured: { responseType: 'file', status: response.status, truncated: false, file },
    };
  }

  const shaped: ShapedResult = shapeResult(response.result);
  const lines = [
    `## ${verb}: \`${details.method} ${requestPath}\``,
    '',
    `Teamso answered${response.messageCode ? ` \`${response.messageCode}\`` : ` HTTP ${response.status}`}`
      + `${response.message && response.message !== response.messageCode ? ` (${response.message})` : ''}.`,
  ];
  if (shaped.resultPreview !== undefined) {
    lines.push('', '```json', shaped.resultPreview, '```');
  } else if (shaped.result !== undefined && shaped.result !== null) {
    const compact = safeStringify(shaped.result);
    lines.push('', '```json', compact.length <= 8_000 ? safeStringify(shaped.result, 2) : compact, '```');
  } else {
    lines.push('', 'No data in the response.');
  }
  if (shaped.truncated && shaped.truncation) lines.push('', `**Truncated:** ${shaped.truncation.hint}`);
  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    structured: {
      responseType: 'json',
      status: response.status,
      ...(response.messageCode ? { messageCode: response.messageCode } : {}),
      ...(response.message ? { message: response.message } : {}),
      ...(shaped.result !== undefined ? { result: shaped.result } : {}),
      truncated: shaped.truncated,
      ...(shaped.truncation ? { truncation: shaped.truncation } : {}),
      ...(shaped.resultPreview !== undefined ? { resultPreview: shaped.resultPreview } : {}),
    },
  };
}

function isEmptyReadAnswer(error: unknown): error is TeamsoApiError {
  return error instanceof TeamsoApiError
    && error.status === 200
    && (error.messageCode === 'GET_ERROR' || error.messageCode === 'ITEM_NOT_FOUND')
    && (error.result === undefined || error.result === null);
}

function callErrorResult(error: unknown, readMode: boolean): CallToolResult {
  if (error instanceof TeamsoResponseTooLargeError) {
    return errorResult(`${error.message} MCP returns files up to ${formatBytes(MAX_FILE_BYTES)} and shortens long `
      + 'lists; this response is too large. Narrow it (filters, a shorter date range, `page`/`size`) or download '
      + 'it in the Teamso app.');
  }
  if (readMode && error instanceof TeamsoApiError && error.status === 403
    && isRecord(error.body) && error.body.error === 'MCP_READ_INTENT') {
    return errorResult('Teamso refused this as a read because the endpoint changes data. Use `call_api_write` '
      + '(preview, then confirm with the user).');
  }
  if (readMode && isEmptyReadAnswer(error)) {
    // Many Teamso lists answer `GET_ERROR` / `ITEM_NOT_FOUND` with HTTP 200 and no data when nothing matches.
    return errorResult(`Teamso returned no data (\`${error.messageCode}\`${error.apiMessage && error.apiMessage !== error.messageCode
      ? `: "${error.apiMessage}"` : ''}). Teamso list and search endpoints answer this way when there is nothing `
      + 'to show, so for a list this most likely means there are no matching records: tell the user that '
      + 'instead of reporting a failure (check date ranges and filters first). For a single record fetched by '
      + 'id, it was not found or is not visible to you.\n\n'
      + `_Teamso API: HTTP ${error.status} · \`${error.messageCode}\`_`);
  }
  return apiErrorResult(error, CALL_HINTS);
}

function effectLabel(details: ApiEndpointSummary): string {
  switch (details.sideEffect) {
    case 'read': return 'Reads data';
    case 'delete': return 'Deletes data';
    case 'read_with_writes': return 'Changes data (although it is a GET)';
    default: return 'Changes data';
  }
}

function smsLabel(details: ApiEndpointDetails): string {
  const sms = details.sms;
  if (!sms) return 'not needed';
  const parts = [sms.mode === 'always' ? 'required' : `only when ${sms.when ?? 'Teamso asks for it (OTP_NOT_DONE)'}`];
  if (sms.preVerify) parts.push('verify before the first attempt');
  if (sms.credits && sms.credits !== 'none') parts.push(`uses digital credits (${sms.credits})`);
  return parts.join('; ');
}

function typeLabel(schema: Record<string, unknown>): string {
  const type = typeof schema.type === 'string' ? schema.type : schema.$ref ? 'object' : 'any';
  const detail = schema['x-pattern'] ?? schema.format ?? (Array.isArray(schema.enum) ? schema.enum.join(', ') : undefined);
  const fallback = schema.default !== undefined ? `, default ${String(schema.default)}` : '';
  return `${type}${detail ? ` (${String(detail)})` : ''}${fallback}`;
}

function humanSummary(details: ApiEndpointDetails, requestPath: string): string {
  const parts = [`${effectLabel(details)}: ${details.method} ${requestPath}`];
  if (details.summary) parts.push(`— ${truncateText(details.summary, 160)}`);
  if (details.sms) {
    parts.push(details.sms.mode === 'always' || details.sms.preVerify
      ? '(needs an SMS code)'
      : '(may need an SMS code)');
  }
  return parts.join(' ');
}

function previewBodyOf(input: unknown, body: ApiRequestBody | undefined, warnings: string[]): unknown {
  if (body?.kind === 'multipart') return Object.keys(body.fields).length ? body.fields : undefined;
  if (input === undefined || input === null) return undefined;
  if (safeStringify(input).length > MAX_PREVIEW_BODY_CHARS) {
    warnings.push('The body is too long to repeat in the preview; it is sent as given.');
    return undefined;
  }
  return input;
}

function previewText(
  details: ApiEndpointDetails,
  requestPath: string,
  summary: string,
  prepared: PreparedRequest,
  previewBody: unknown,
  warnings: string[],
): string {
  const lines = [
    '## Preview — nothing has been sent',
    '',
    `**${summary}**`,
    '',
    `- **Request:** \`${details.method} ${requestPath}\``,
  ];
  if (details.sideEffect === 'delete') lines.push('- **Warning:** this deletes data in Teamso; it may not be undoable.');
  if (details.sideEffect === 'read_with_writes') lines.push('- **Warning:** this GET endpoint changes data.');
  lines.push(`- **SMS code:** ${smsLabel(details)}`);
  if (prepared.files.length) {
    lines.push(`- **Files:** ${prepared.files.map(file => `${escapeCell(file.filename)} → \`${file.field}\` (${formatBytes(file.sizeBytes)})`).join(', ')}`);
  }
  if (previewBody !== undefined) {
    lines.push('', '```json', truncateText(safeStringify(previewBody, 2), 4_000), '```');
  }
  if (prepared.validation.valid) {
    lines.push('', prepared.validation.checked ? 'The request matches the endpoint\'s schema.' : 'The body could not be checked.');
  } else {
    lines.push('', '**Fix before running:**', ...prepared.validation.errors.map(problem => `- ${problem}`));
  }
  if (warnings.length) lines.push('', '**Notes:**', ...warnings.map(warning => `- ${warning}`));
  lines.push('', prepared.validation.valid
    ? 'Show this to the user. Run it only after they explicitly confirm: call `call_api_write` again with the same '
      + 'arguments and `confirm: true`.'
      + (details.sms && (details.sms.mode === 'always' || details.sms.preVerify)
        ? ' It needs an SMS code: after the confirmation call `request_sms_code` and pass the code as `otp_code`.'
        : '')
    : 'Correct the arguments and preview again.');
  return lines.join('\n');
}

function previewNextAction(
  details: ApiEndpointDetails,
  input: RequestInput & { id: string; otp_code?: string; lang?: string },
  validation: BodyValidation,
  needsCode: boolean,
): NextAction {
  if (!validation.valid) {
    return {
      tool: 'describe_api_endpoint',
      arguments: { id: details.id },
      reason: 'The request does not match the endpoint; check its parameters and body schema, fix the arguments and '
        + 'preview again.',
    };
  }
  if (needsCode) {
    return {
      tool: 'request_sms_code',
      arguments: {},
      reason: 'After the user explicitly confirms this preview, send the SMS code, ask the user for it, then call '
        + 'call_api_write with the same arguments, confirm=true and otp_code.',
    };
  }
  const args: Record<string, unknown> = { id: input.id };
  if (input.path_params) args.path_params = input.path_params;
  if (input.query) args.query = input.query;
  if (input.body !== undefined) args.body = input.body;
  if (input.otp_code) args.otp_code = input.otp_code;
  args.confirm = true;
  return {
    tool: 'call_api_write',
    arguments: args,
    reason: 'Only after the user explicitly confirms this preview.'
      + (input.files?.length ? ' Pass the same `files` again.' : ''),
  };
}

function exampleCall(details: ApiEndpointDetails): { tool: 'call_api_read' | 'call_api_write'; arguments: Record<string, unknown> } {
  const tool = details.sideEffect === 'read' ? 'call_api_read' : 'call_api_write';
  const args: Record<string, unknown> = { id: details.id };
  const pathParams: Record<string, unknown> = {};
  for (const name of pathVariables(details.path)) pathParams[name] = `<${name}>`;
  if (Object.keys(pathParams).length) args.path_params = pathParams;
  const query: Record<string, unknown> = {};
  for (const parameter of details.parameters) {
    if (parameter.in === 'query' && parameter.required) {
      query[parameter.name] = exampleFromSchema(parameter.schema, parameter.schema) ?? `<${parameter.name}>`;
    }
  }
  if (Object.keys(query).length) args.query = query;
  const requestBody = details.requestBody;
  if (requestBody && details.method !== 'GET') {
    const schema = requestBody.schema;
    if (details.multipart || requestBody.contentType.startsWith('multipart/')) {
      const properties = isRecord(schema.properties) ? schema.properties : {};
      const fields: Record<string, unknown> = {};
      const files: unknown[] = [];
      for (const [name, property] of Object.entries(properties)) {
        if (isBinarySchema(property)) {
          files.push({ field: name, filename: '<file name>', content_type: '<mime type>', base64: '<base64 content>' });
        } else {
          fields[name] = exampleFromSchema(property, schema);
        }
      }
      if (Object.keys(fields).length) args.body = fields;
      if (files.length) args.files = files;
    } else {
      const example = exampleFromSchema(schema, schema);
      if (example !== null || requestBody.required) args.body = example;
    }
  }
  return { tool, arguments: args };
}

function fallbackFileName(path: string, contentType: string): string {
  const base = path.split('/').filter(part => part && !part.startsWith('{')).pop() ?? 'download';
  const extension = MIME_EXTENSIONS[contentType] ?? 'bin';
  return `${base}.${extension}`;
}

const MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'text/csv': 'csv',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'application/zip': 'zip',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'text/plain': 'txt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
