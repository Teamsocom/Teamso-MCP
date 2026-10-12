import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TeamsoClient } from '../client.js';
import { markdownTable } from '../utils/format.js';
import { apiErrorResult, errorResult, toolResult } from '../utils/results.js';
import { toPayslip } from '../utils/structured.js';
import { payslipListOutputSchema, payslipPdfOutputSchema } from './schemas.js';
import { READ_ONLY, idSchema } from './shared.js';

export function registerListMyPayslips(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_my_payslips',
    {
      title: 'List my payslips',
      description: 'List the caller\'s own e-payslips (newest term first) with their status and any '
        + 'objection answers. Open one with `get_payslip_pdf`.',
      inputSchema: {
        term: z.string().trim().regex(/^\d{4}(-\d{2})?$/, 'term must be `yyyy` or `yyyy-MM`').optional()
          .describe('Only this payroll term: a month `yyyy-MM` or a whole year `yyyy`.'),
        limit: z.number().int().min(1).max(50).default(12).describe('Maximum payslips (1-50, default 12).'),
      },
      outputSchema: payslipListOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ term, limit }, extra) => {
      try {
        const page = await client.listMyPayslips({
          size: limit,
          ...(term ? { searchKey: 'term' as const, searchValue: term } : {}),
        }, extra.signal);
        const payslips = (page?.content ?? []).map(toPayslip);
        const total = page?.pagination?.totalElements ?? payslips.length;
        if (payslips.length === 0) {
          return toolResult(term ? `No payslips for ${term}.` : 'You have no payslips yet.', { payslips, total: 0 });
        }
        const table = markdownTable(
          ['Term', 'Id', 'Status', 'Sent'],
          payslips.map(payslip => [payslip.term, `\`${payslip.id}\``, payslip.status, payslip.sentToEmployeeAt]),
        );
        return toolResult(`## My payslips\n\n${table}`, {
          payslips,
          total,
          nextAction: {
            tool: 'get_payslip_pdf',
            arguments: { payslip_id: payslips[0]!.id },
            reason: 'Open the payslip PDF when the user asks for its details.',
          },
        });
      } catch (error) {
        return apiErrorResult(error, {
          byCode: {
            INVALID_INPUT_PARAMETERS: 'Teamso rejected the payslip filter. Use `term` as `yyyy-MM` or `yyyy`.',
          },
        });
      }
    },
  );
}

export function registerGetPayslipPdf(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'get_payslip_pdf',
    {
      title: 'Get a payslip PDF',
      description: 'Download one of the caller\'s payslips as a PDF, returned as an embedded '
        + '`application/pdf` resource. Payslips contain salary data: show them only to their owner.',
      inputSchema: {
        payslip_id: idSchema('Payslip id from `list_my_payslips`.'),
      },
      outputSchema: payslipPdfOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ payslip_id }, extra) => {
      try {
        const file = await client.downloadPayslip(payslip_id, extra.signal);
        if (file.data.byteLength === 0) {
          return errorResult('Teamso returned an empty payslip file. Try again, or open it in the Teamso app.');
        }
        const fileName = file.fileName ?? `payslip-${payslip_id}.pdf`;
        const resourceUri = `teamso://payslips/${encodeURIComponent(payslip_id)}.pdf`;
        const sizeBytes = file.data.byteLength;
        return {
          content: [
            {
              type: 'text' as const,
              text: `Payslip PDF \`${fileName}\` (${Math.ceil(sizeBytes / 1024)} KB) is attached.`,
            },
            {
              type: 'resource' as const,
              resource: {
                uri: resourceUri,
                mimeType: file.contentType || 'application/pdf',
                blob: Buffer.from(file.data).toString('base64'),
              },
            },
          ],
          structuredContent: {
            payslipId: payslip_id,
            fileName,
            mimeType: file.contentType || 'application/pdf',
            sizeBytes,
            resourceUri,
          },
        };
      } catch (error) {
        return apiErrorResult(error, {
          notFound: 'Teamso has no payslip PDF with that id for you (it may not be sent to you yet). '
            + 'Find the id with `list_my_payslips`.',
        });
      }
    },
  );
}
