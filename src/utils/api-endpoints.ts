import { createRequire } from 'node:module';
import type {
  ApiHttpMethod,
  ApiQueryValue,
  TeamsoApiEndpointDescription,
  TeamsoApiEndpointItem,
  TeamsoApiModule,
  TeamsoApiParameter,
} from '../types.js';

/**
 * Helpers for the generic API tools: defensive projections of the per-user
 * catalog (`/mcp-catalog`), path and query resolution, request body
 * validation (JSON Schema 2020-12), example arguments and result truncation.
 */

export const SIDE_EFFECTS = ['read', 'write', 'delete', 'read_with_writes'] as const;
export type SideEffect = typeof SIDE_EFFECTS[number];

export const SMS_MODES = ['always', 'conditional', 'never'] as const;
export type SmsMode = typeof SMS_MODES[number];

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export interface ApiEndpointSummary {
  id: string;
  method: ApiHttpMethod;
  path: string;
  module?: string;
  moduleTitle?: string;
  summary?: string;
  sideEffect: SideEffect;
  smsCodeRequired: SmsMode;
  fileResponse: boolean;
  multipart: boolean;
  access?: string;
  conditional?: boolean;
}

export interface ApiSmsRequirement {
  mode: SmsMode;
  when?: string;
  preVerify: boolean;
  credits?: string;
}

export interface ApiParameterInfo {
  name: string;
  in: string;
  required: boolean;
  schema: Record<string, unknown>;
}

export interface ApiRequestBodyInfo {
  required: boolean;
  validated?: boolean;
  contentType: string;
  /** Self-contained JSON Schema 2020-12 (the catalog's `$defs` merged in). */
  schema: Record<string, unknown>;
}

export interface ApiEndpointDetails extends ApiEndpointSummary {
  accessReason?: string;
  permission?: string;
  moduleDescription?: string;
  responseKind?: string;
  doc?: string;
  webScreens: string[];
  sms: ApiSmsRequirement | null;
  parameters: ApiParameterInfo[];
  requestBody: ApiRequestBodyInfo | null;
  notes: string[];
  related: string[];
}

// ------------------------------------------------------------ projections

export function toApiEndpointSummary(item: TeamsoApiEndpointItem): ApiEndpointSummary | null {
  const parsedId = splitEndpointId(stringOf(item.id) ?? '');
  const method = normalizeMethod(stringOf(item.method) ?? parsedId?.method);
  const path = stringOf(item.path) ?? parsedId?.path;
  if (!method || !path) return null;
  const sms = smsRequirementOf(item as TeamsoApiEndpointDescription);
  return {
    id: `${method} ${path}`,
    method,
    path,
    ...optional('module', stringOf(item.module)),
    ...optional('moduleTitle', stringOf(item.moduleTitle)),
    ...optional('summary', stringOf(item.summary)),
    sideEffect: sideEffectOf(item.sideEffect, method),
    smsCodeRequired: sms?.mode ?? 'never',
    fileResponse: item.fileResponse === true,
    multipart: item.multipart === true,
    ...optional('access', stringOf(item.access)),
    ...(typeof item.conditional === 'boolean' ? { conditional: item.conditional } : {}),
  };
}

export function toApiEndpointDetails(description: TeamsoApiEndpointDescription): ApiEndpointDetails | null {
  const summary = toApiEndpointSummary(description);
  if (!summary) return null;
  const defs = isRecord(description.$defs) ? description.$defs : {};
  const parameters = (Array.isArray(description.parameters) ? description.parameters : [])
    .map(toParameterInfo)
    .filter((parameter): parameter is ApiParameterInfo => parameter !== null);
  // Every {var} of the path is a required path parameter, even when the catalog forgot one.
  for (const name of pathVariables(summary.path)) {
    if (!parameters.some(parameter => parameter.in === 'path' && parameter.name === name)) {
      parameters.push({ name, in: 'path', required: true, schema: { type: 'string' } });
    }
  }
  const body = isRecord(description.requestBody) ? description.requestBody : null;
  const requestBody: ApiRequestBodyInfo | null = body
    ? {
      required: body.required === true,
      ...(typeof body.validated === 'boolean' ? { validated: body.validated } : {}),
      contentType: stringOf(body.contentType) ?? (summary.multipart ? 'multipart/form-data' : 'application/json'),
      schema: withDefs(isRecord(body.schema) ? body.schema : {}, defs),
    }
    : null;
  return {
    ...summary,
    ...optional('accessReason', stringOf(description.accessReason)),
    ...optional('permission', stringOf(description.permission)),
    ...optional('moduleDescription', stringOf(description.moduleDescription)),
    ...optional('responseKind', stringOf(description.responseKind)),
    ...optional('doc', stringOf(description.doc)),
    webScreens: stringArray(description.webScreens),
    sms: smsRequirementOf(description),
    parameters,
    requestBody,
    notes: stringArray(description.notes),
    related: stringArray(description.related),
  };
}

export function toApiModule(module: TeamsoApiModule) {
  const code = stringOf(module.code);
  if (!code) return null;
  return {
    code,
    title: stringOf(module.title) ?? code,
    ...optional('description', stringOf(module.description)),
    endpointCount: numberOf(module.endpointCount) ?? 0,
    allowedCount: numberOf(module.allowedCount) ?? 0,
  };
}

function toParameterInfo(parameter: TeamsoApiParameter): ApiParameterInfo | null {
  const name = stringOf(parameter?.name);
  const location = stringOf(parameter?.in);
  if (!name || !location) return null;
  return {
    name,
    in: location,
    required: parameter.required === true || location === 'path',
    schema: isRecord(parameter.schema) ? parameter.schema : {},
  };
}

/** SMS requirement from `smsCode {mode, when, preVerify, credits}`, else from `smsCodeRequired`. */
export function smsRequirementOf(description: TeamsoApiEndpointDescription): ApiSmsRequirement | null {
  const detail = isRecord(description.smsCode) ? description.smsCode : null;
  const flag = description.smsCodeRequired;
  let mode: SmsMode = 'never';
  const detailMode = stringOf(detail?.mode)?.toLowerCase();
  const flagMode = typeof flag === 'string' ? flag.toLowerCase() : undefined;
  if (detailMode === 'always' || detailMode === 'conditional') mode = detailMode;
  else if (flagMode === 'always' || flagMode === 'conditional') mode = flagMode;
  else if (flag === true || (detail && detailMode !== 'never')) mode = 'always';
  else if (flagMode && flagMode !== 'never' && flagMode !== 'false') mode = 'always';
  if (mode === 'never') return null;
  return {
    mode,
    ...optional('when', stringOf(detail?.when)),
    preVerify: detail?.preVerify === true,
    ...optional('credits', stringOf(detail?.credits)),
  };
}

/**
 * Unknown or missing values never become `read`: a GET with an unrecognised
 * side effect is handled as a write, so `call_api_read` refuses it.
 */
export function sideEffectOf(value: unknown, method: ApiHttpMethod): SideEffect {
  if (typeof value === 'string' && (SIDE_EFFECTS as readonly string[]).includes(value)) return value as SideEffect;
  if (method === 'DELETE') return 'delete';
  if (method !== 'GET') return 'write';
  return value === undefined || value === null ? 'read' : 'read_with_writes';
}

export function normalizeMethod(value: string | undefined): ApiHttpMethod | undefined {
  const upper = value?.trim().toUpperCase();
  return upper && (HTTP_METHODS as readonly string[]).includes(upper) ? upper as ApiHttpMethod : undefined;
}

/** `"POST /leave"` → `{ method: 'POST', path: '/leave' }`. */
export function splitEndpointId(id: string): { method: ApiHttpMethod; path: string } | null {
  const match = /^\s*([A-Za-z]+)\s+(\/\S*)\s*$/.exec(id);
  const method = normalizeMethod(match?.[1]);
  if (!match || !method) return null;
  return { method, path: match[2]! };
}

// ------------------------------------------------------------- path/query

const PATH_VARIABLE = /\{([^{}:]+)(?::[^{}]*)?\}/g;

export function pathVariables(pattern: string): string[] {
  return [...pattern.matchAll(PATH_VARIABLE)].map(match => match[1]!.trim());
}

export interface ResolvedPath {
  path: string;
  problems: string[];
}

/**
 * Fills `{var}` placeholders. Values travel as single path segments: `/`, `\`, `;`, `%`, control
 * characters and dot-only values are refused (Teamso's firewall rejects them, and they could change
 * the route), never silently rewritten.
 */
export function resolvePath(pattern: string, values: Record<string, string | number> = {}): ResolvedPath {
  const problems: string[] = [];
  const names = pathVariables(pattern);
  for (const name of Object.keys(values)) {
    if (!names.includes(name)) {
      problems.push(`path_params.${name} is not a placeholder of ${pattern}`
        + (names.length ? ` (placeholders: ${names.map(item => `{${item}}`).join(', ')})` : ' (it has none)') + '.');
    }
  }
  const path = pattern.replace(PATH_VARIABLE, (_whole, rawName: string) => {
    const name = rawName.trim();
    const raw = values[name];
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      problems.push(`path_params.${name} is required (it fills {${name}} in ${pattern}).`);
      return `{${name}}`;
    }
    const value = String(raw).trim();
    if (value.length > 500 || /[/\\;%\u0000-\u001f\u007f]/.test(value) || /^\.+$/.test(value)) {
      problems.push(`path_params.${name} cannot be sent as a URL path segment (no "/", "\\", ";", "%", `
        + 'control characters or dot-only values, at most 500 characters).');
      return `{${name}}`;
    }
    return encodeURIComponent(value).replace(/%3A/gi, ':');
  });
  return { path, problems };
}

/** Required query parameters that are missing; unknown names are warnings (the API ignores them). */
export function checkQuery(
  parameters: ApiParameterInfo[],
  query: Record<string, ApiQueryValue> = {},
): { problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  const known = parameters.filter(parameter => parameter.in === 'query');
  for (const parameter of known) {
    const value = query[parameter.name];
    const missing = value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
    if (parameter.required && missing && parameter.schema.default === undefined) {
      problems.push(`query.${parameter.name} is required${describeType(parameter.schema)}.`);
    }
  }
  for (const name of Object.keys(query)) {
    if (!known.some(parameter => parameter.name === name)) {
      warnings.push(`query.${name} is not a documented parameter of this endpoint; Teamso may ignore it.`);
    }
  }
  for (const parameter of parameters) {
    if (parameter.in === 'header' && parameter.required && parameter.schema.default === undefined) {
      warnings.push(`This endpoint expects the header \`${parameter.name}\`, which MCP tools do not send; `
        + 'the call may fail. Use the Teamso app for it.');
    }
  }
  return { problems, warnings };
}

function describeType(schema: Record<string, unknown>): string {
  const parts = [stringOf(schema.type), stringOf(schema['x-pattern']) ?? stringOf(schema.format)].filter(Boolean);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

/** Path with the query string, for display (`/leave/abc?page=1`). */
export function displayPath(path: string, query: Record<string, ApiQueryValue> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

// -------------------------------------------------------- body validation

type AjvValidate = ((data: unknown) => boolean) & { errors?: Array<Record<string, unknown>> | null };
interface AjvInstance {
  compile(schema: unknown): AjvValidate;
  removeSchema(schema?: unknown): unknown;
}
type AjvConstructor = new (options: Record<string, unknown>) => AjvInstance;

let ajv: AjvInstance | undefined;

function getAjv(): AjvInstance {
  if (!ajv) {
    const require = createRequire(import.meta.url);
    const loaded = require('ajv/dist/2020') as { default?: AjvConstructor } & AjvConstructor;
    const Ajv2020 = loaded.default ?? loaded;
    // Teamso dates are not RFC 3339 (`yyyy-MM-dd HH:mm`) and `x-*` keywords are hints: check
    // structure, types, enums and bounds, not formats.
    ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false, logger: false });
  }
  return ajv;
}

export interface BodyValidation {
  /** False when the schema could not be compiled (the body was not checked). */
  checked: boolean;
  valid: boolean;
  errors: string[];
}

const MAX_VALIDATION_ERRORS = 20;

export function validateBody(schema: Record<string, unknown>, value: unknown): BodyValidation {
  const instance = getAjv();
  let validate: AjvValidate;
  try {
    validate = instance.compile(schema);
  } catch {
    return { checked: false, valid: true, errors: [] };
  }
  try {
    const valid = validate(value);
    const errors = (validate.errors ?? []).slice(0, MAX_VALIDATION_ERRORS).map(formatAjvError);
    return { checked: true, valid, errors: valid ? [] : errors };
  } finally {
    // Compiled schemas are cached by object; drop it so a long-running server does not grow.
    try {
      instance.removeSchema(schema);
    } catch {
      // nothing cached
    }
  }
}

function formatAjvError(error: Record<string, unknown>): string {
  const location = `body${String(error.instancePath ?? '').replace(/\//g, '.')}`;
  const params = isRecord(error.params) ? error.params : {};
  if (error.keyword === 'required' && params.missingProperty) {
    return `${location}.${String(params.missingProperty)} is required.`;
  }
  if (error.keyword === 'enum' && Array.isArray(params.allowedValues)) {
    return `${location} must be one of ${params.allowedValues.map(item => JSON.stringify(item)).join(', ')}.`;
  }
  if (error.keyword === 'additionalProperties' && params.additionalProperty) {
    return `${location}.${String(params.additionalProperty)} is not allowed.`;
  }
  return `${location} ${String(error.message ?? 'is invalid')}.`;
}

function withDefs(schema: Record<string, unknown>, defs: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...schema };
  if (Object.keys(defs).length > 0) {
    merged.$defs = { ...(isRecord(schema.$defs) ? schema.$defs : {}), ...defs };
  }
  return merged;
}

/** True for `{type: string, format: binary}` and arrays of it (multipart file parts). */
export function isBinarySchema(schema: unknown): boolean {
  if (!isRecord(schema)) return false;
  if (schema.format === 'binary') return true;
  return schema.type === 'array' && isBinarySchema(schema.items);
}

// ---------------------------------------------------------------- examples

const MAX_EXAMPLE_DEPTH = 4;
const MAX_EXAMPLE_PROPERTIES = 12;

/** A small example value for a schema: required properties first, placeholders for strings. */
export function exampleFromSchema(schema: unknown, root: Record<string, unknown>, depth = 0): unknown {
  if (!isRecord(schema)) return null;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  const ref = stringOf(schema.$ref);
  if (ref) {
    if (depth >= MAX_EXAMPLE_DEPTH) return {};
    return exampleFromSchema(resolveRef(ref, root), root, depth + 1);
  }
  const type = Array.isArray(schema.type) ? schema.type.find(item => item !== 'null') : schema.type;
  switch (type) {
    case 'string': {
      const pattern = stringOf(schema['x-pattern']);
      if (schema.format === 'binary') return '<file>';
      if (pattern) return `<${pattern}>`;
      if (schema.format === 'date') return '<yyyy-MM-dd>';
      if (schema.format === 'date-time') return '<yyyy-MM-dd HH:mm>';
      if (schema.format === 'email') return '<email>';
      return '<string>';
    }
    case 'integer':
    case 'number':
      return typeof schema.minimum === 'number' ? schema.minimum : 0;
    case 'boolean':
      return false;
    case 'array':
      return depth >= MAX_EXAMPLE_DEPTH ? [] : [exampleFromSchema(schema.items, root, depth + 1)];
    case 'object':
    default: {
      if (!isRecord(schema.properties)) return type === 'object' || schema['x-open-object'] ? {} : null;
      if (depth >= MAX_EXAMPLE_DEPTH) return {};
      const required = stringArray(schema.required);
      const names = required.length
        ? required
        : Object.keys(schema.properties).slice(0, MAX_EXAMPLE_PROPERTIES);
      const example: Record<string, unknown> = {};
      for (const name of names.slice(0, MAX_EXAMPLE_PROPERTIES)) {
        example[name] = exampleFromSchema(schema.properties[name], root, depth + 1);
      }
      return example;
    }
  }
}

function resolveRef(ref: string, root: Record<string, unknown>): unknown {
  if (!ref.startsWith('#/')) return undefined;
  let node: unknown = root;
  for (const part of ref.slice(2).split('/')) {
    if (!isRecord(node)) return undefined;
    node = node[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return node;
}

// -------------------------------------------------------------- truncation

export const MAX_RESULT_CHARS = 40_000;

export interface ShapedResult {
  result?: unknown;
  truncated: boolean;
  truncation?: {
    originalChars: number;
    arrayPath?: string;
    originalItems?: number;
    returnedItems?: number;
    hint: string;
  };
  /** First characters of the JSON when no list could be shortened. */
  resultPreview?: string;
}

const PAGING_HINT = 'Ask for less: use the endpoint\'s paging or filter parameters (e.g. `page`/`size` or a '
  + 'search value in `query`, see describe_api_endpoint) and call again.';

/**
 * Keeps results within `maxChars` of JSON. The longest list (the result itself or an array up to
 * two levels down, e.g. `items`, `content`) is cut to the items that fit; the cut is always reported.
 */
export function shapeResult(result: unknown, maxChars = MAX_RESULT_CHARS): ShapedResult {
  const json = safeStringify(result);
  if (json.length <= maxChars) return { result, truncated: false };

  const candidate = largestArray(result);
  if (candidate) {
    const { path, array } = candidate;
    let low = 0;
    let high = array.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const size = safeStringify(replaceAt(result, path, array.slice(0, middle))).length;
      if (size <= maxChars) low = middle;
      else high = middle - 1;
    }
    if (low > 0) {
      return {
        result: replaceAt(result, path, array.slice(0, low)),
        truncated: true,
        truncation: {
          originalChars: json.length,
          arrayPath: path.length ? path.join('.') : '(result)',
          originalItems: array.length,
          returnedItems: low,
          hint: `Only the first ${low} of ${array.length} items are included. ${PAGING_HINT}`,
        },
      };
    }
  }
  return {
    truncated: true,
    truncation: {
      originalChars: json.length,
      hint: `The result is ${json.length} characters of JSON; only the first ${maxChars} are in resultPreview. `
        + PAGING_HINT,
    },
    resultPreview: json.slice(0, maxChars),
  };
}

function largestArray(value: unknown): { path: string[]; array: unknown[] } | null {
  let best: { path: string[]; array: unknown[]; size: number } | null = null;
  const consider = (path: string[], node: unknown) => {
    if (!Array.isArray(node) || node.length < 2) return;
    const size = safeStringify(node).length;
    if (!best || size > best.size) best = { path, array: node, size };
  };
  consider([], value);
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      consider([key], child);
      if (isRecord(child)) {
        for (const [innerKey, inner] of Object.entries(child)) consider([key, innerKey], inner);
      }
    }
  }
  return best;
}

function replaceAt(value: unknown, path: string[], replacement: unknown): unknown {
  if (path.length === 0) return replacement;
  const [head, ...rest] = path;
  const record = value as Record<string, unknown>;
  return { ...record, [head!]: replaceAt(record[head!], rest, replacement) };
}

export function safeStringify(value: unknown, space?: number): string {
  try {
    return JSON.stringify(value === undefined ? null : value, null, space) ?? 'null';
  } catch {
    return '"[unserializable]"';
  }
}

// ------------------------------------------------------------------ utils

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function optional<K extends string>(key: K, value: string | undefined): { [P in K]?: string } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: string };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
