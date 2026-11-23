import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TeamsoClient } from '../client.js';
import { markdownTable } from '../utils/format.js';
import { apiErrorResult, errorResult, toolResult } from '../utils/results.js';
import { compact, optionalNumber, optionalString, toPayslip } from '../utils/structured.js';
import { payslipExplanationOutputSchema, payslipListOutputSchema, payslipPdfOutputSchema } from './schemas.js';
import { READ_ONLY, idSchema } from './shared.js';

export function registerListMyPayslips(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_my_payslips',
    {
      title: 'List my payslips',
      description: 'List the caller\'s own e-payslips (newest term first) with their ids, status and any '
        + 'objection answers.',
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
      description: 'Download one of the caller\'s own payslips as a PDF, returned as an embedded '
        + '`application/pdf` resource. Payslips contain salary data.',
      inputSchema: {
        payslip_id: idSchema('Id of one of the caller\'s own payslips.'),
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

/** Amount as `1.234,56`-free plain text with two decimals (`1234.56`), signed when asked. */
function money(value: number | undefined, signed = false): string {
  if (value === undefined) return '-';
  const text = Math.abs(value).toFixed(2);
  if (!signed) return value < 0 ? `-${text}` : text;
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : text;
}

export function registerExplainMyPayslip(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'explain_my_payslip',
    {
      title: 'Explain my payslip',
      description: 'Why the caller\'s pay went down or up ("maaşım neden düştü"), from their own closed payslip: '
        + 'net pay against the previous payslip with its reasons (days worked, overtime, a new or ended payment or '
        + 'deduction, tax band change, minimum wage exemption, social security ceiling), every line with a plain '
        + 'explanation, year to date totals of closed periods and a warning when next month\'s income tax band may '
        + 'change. Free, no AI credit. Default: the latest payslip; `month` (yyyy-MM) or `payslip_id` picks another.',
      inputSchema: {
        month: z.string().trim().regex(/^\d{4}-\d{2}$/, 'month must be `yyyy-MM`').optional()
          .describe('Payroll month `yyyy-MM` (default the latest payslip).'),
        payslip_id: idSchema('Id of one of the caller\'s own payslips.').optional(),
      },
      outputSchema: payslipExplanationOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ month, payslip_id }, extra) => {
      try {
        const view = await client.getPayslipView({ payslipId: payslip_id, month }, extra.signal);
        const lines = (view.lines ?? []).filter(l => l.key && l.kind);
        const structured = compact({
          payslipId: view.payrollId ?? payslip_id ?? '',
          period: view.period ?? month ?? '',
          previousPeriod: optionalString(view.previousPeriod),
          netPay: optionalNumber(view.net?.after) ?? 0,
          previousNetPay: optionalNumber(view.net?.before),
          netChange: optionalNumber(view.net?.delta),
          summary: optionalString(view.summary),
          reasons: (view.net?.reasons ?? []).filter(r => optionalNumber(r.amount)).map(r => ({
            category: r.category ?? r.code ?? 'OTHER',
            label: optionalString(r.label) ?? r.code ?? '-',
            amount: optionalNumber(r.amount)!,
          })),
          changedLines: lines.filter(l => l.status && l.status !== 'SAME').map(l => compact({
            key: l.key!,
            label: optionalString(l.label) ?? l.key!,
            kind: l.kind!,
            amount: optionalNumber(l.amount) ?? 0,
            previous: optionalNumber(l.previous),
            change: optionalNumber(l.change),
            status: l.status!,
            reason: optionalString(l.reason),
            reasonText: optionalString(l.reasonText),
          })),
          lines: lines.map(l => compact({
            key: l.key!,
            label: optionalString(l.label) ?? l.key!,
            kind: l.kind!,
            amount: optionalNumber(l.amount) ?? 0,
            explanation: optionalString(l.text),
          })),
          yearToDate: view.yearToDate && typeof view.yearToDate.year === 'number' ? {
            year: view.yearToDate.year,
            months: view.yearToDate.months ?? [],
            gross: optionalNumber(view.yearToDate.gross) ?? 0,
            net: optionalNumber(view.yearToDate.net) ?? 0,
            incomeTax: optionalNumber(view.yearToDate.incomeTax) ?? 0,
            stampTax: optionalNumber(view.yearToDate.stampTax) ?? 0,
            socialSecurity: optionalNumber(view.yearToDate.sgkTotal) ?? 0,
          } : undefined,
          taxBracket: view.taxBracket && typeof view.taxBracket.band === 'number' ? compact({
            band: view.taxBracket.band,
            rate: optionalNumber(view.taxBracket.rate),
            state: view.taxBracket.state ?? 'safe',
            crossesNextMonth: view.taxBracket.crossesNextMonth === true,
            nextPeriod: optionalString(view.taxBracket.nextPeriod),
            remaining: optionalNumber(view.taxBracket.remaining),
            text: optionalString(view.taxBracket.text),
          }) : undefined,
        });
        const parts = [`## Payslip ${structured.period}`];
        if (structured.summary) parts.push(structured.summary);
        if (structured.reasons.length) {
          parts.push(`### Why the net pay changed since ${structured.previousPeriod ?? 'last month'}\n\n`
            + markdownTable(['Reason', 'Effect on net'], structured.reasons.map(r => [r.label, money(r.amount, true)])));
        }
        if (structured.changedLines.length) {
          parts.push('### Changed lines\n\n' + markdownTable(['Line', 'Now', 'Last month', 'Why'],
            structured.changedLines.map(l => [l.label, money(l.amount), money(l.previous), l.reasonText ?? l.reason ?? ''])));
        }
        if (structured.taxBracket?.text) {
          parts.push(`${structured.taxBracket.crossesNextMonth ? '**Tax band warning:** ' : ''}${structured.taxBracket.text}`);
        }
        if (structured.yearToDate) {
          const y = structured.yearToDate;
          parts.push(`Year ${y.year} so far (${y.months.length} closed months): gross ${money(y.gross)}, net `
            + `${money(y.net)}, income tax ${money(y.incomeTax)}, stamp tax ${money(y.stampTax)}, social security `
            + `${money(y.socialSecurity)} TRY.`);
        }
        return toolResult(parts.join('\n\n'), structured);
      } catch (error) {
        return apiErrorResult(error, {
          byCode: {
            PAYSLIP_VIEW_NOT_AVAILABLE: 'There is no closed payslip calculated in Teamso for that month (uploaded '
              + 'PDF payslips and open payroll periods cannot be explained). Check the months with '
              + '`list_my_payslips` and open the PDF with `get_payslip_pdf`.',
            PERMISSION_DENIED: 'That payslip is not yours. Only the caller\'s own payslips can be explained; take the '
              + 'id from `list_my_payslips`.',
            INVALID_INPUT_PARAMETERS: 'Give `month` as `yyyy-MM`.',
          },
          notFound: 'Teamso has no interactive payslip endpoint yet (older Teamso version). Use `get_payslip_pdf`.',
        });
      }
    },
  );
}
