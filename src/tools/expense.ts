import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TeamsoApiError, type TeamsoClient } from '../client.js';
import type { TeamsoExpenseGroup, TeamsoExpenseType } from '../types.js';
import { toWallClock } from '../utils/dates.js';
import { markdownTable } from '../utils/format.js';
import { apiErrorResult, errorResult, toolResult, type ApiErrorHints } from '../utils/results.js';
import { compact, optionalNumber, optionalString } from '../utils/structured.js';
import { expenseCreatedOutputSchema, expenseGroupsOutputSchema, expenseTypesOutputSchema } from './schemas.js';
import { ADDITIVE_WRITE, READ_ONLY, idSchema, otpCodeSchema } from './shared.js';
import { daySchema, sendSmsCodeSchema, smsHints } from './workforce-support.js';

const EXPENSE_USER = 'Needs the expense module responsibility of an employee (EXPENSE_BASE) or manager.';

const EXPENSE_HINTS: ApiErrorHints = {
  forbidden: EXPENSE_USER,
  notFound: 'Teamso could not find that expense group among the ones you can see.',
};

/** Currencies the expense receipts accept. */
const CURRENCIES = ['TRY', 'USD', 'EUR', 'GBP', 'BGN', 'JPY', 'CHF', 'KWD'] as const;

const MAX_RECEIPT_FILE_BYTES = 10 * 1024 * 1024;

const STATUS_CODES = {
  draft: 'EXPENSE_PENDING',
  in_approval: 'EXPENSE_APPROVAL_PROCESS',
  waiting_payment: 'EXPENSE_APPROVAL_PROCESS_DONE',
  paid: 'EXPENSE_APPROVED',
  rejected: 'EXPENSE_REJECT',
  in_revision: 'EXPENSE_REVISION',
} as const;
type ExpenseStatus = keyof typeof STATUS_CODES;

function statusName(code: string | undefined): ExpenseStatus | 'other' {
  const entry = Object.entries(STATUS_CODES).find(([, value]) => value === code);
  return entry ? entry[0] as ExpenseStatus : 'other';
}

function money(value: number | null | undefined): number | undefined {
  const parsed = optionalNumber(value ?? undefined);
  return parsed === undefined ? undefined : Math.round(parsed * 100) / 100;
}

/** `-1` (or nothing) means "no limit" / "any currency" in an expense type. */
function typeCurrency(type: TeamsoExpenseType): string | undefined {
  const currency = optionalString(type.currency ?? undefined);
  return currency && currency !== '-1' ? currency.toUpperCase() : undefined;
}

function typeMax(type: TeamsoExpenseType): number | undefined {
  const max = optionalNumber(type.maxAmount ?? undefined);
  return max !== undefined && max !== -1 ? max : undefined;
}

export function registerListExpenseTypes(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_expense_types',
    {
      title: 'List expense types',
      description: 'The active expense types of the caller\'s company with their ids, the currency each one takes '
        + `and the most a single receipt may be. ${EXPENSE_USER}`,
      inputSchema: {},
      outputSchema: expenseTypesOutputSchema,
      annotations: READ_ONLY,
    },
    async (_args, extra) => {
      try {
        const types = (await client.listExpenseTypes(extra.signal)).filter(type => type.id && type.status !== false);
        const expenseTypes = types.map(type => compact({
          id: type.id,
          name: optionalString(type.name) ?? type.id,
          currency: typeCurrency(type),
          maxAmount: typeMax(type),
          description: optionalString(type.description ?? undefined),
          allowLimitOverrun: typeof type.allowLimitOverrun === 'boolean' ? type.allowLimitOverrun : undefined,
        }));
        if (expenseTypes.length === 0) {
          return toolResult('No active expense type is set up. Ask your expense manager.', { expenseTypes });
        }
        const table = markdownTable(['Expense type', 'Id', 'Currency', 'Max per receipt'],
          expenseTypes.map(type => [type.name, `\`${type.id}\``, type.currency ?? 'any', type.maxAmount ?? '-']));
        return toolResult(`## Expense types\n\n${table}`, { expenseTypes });
      } catch (error) {
        return apiErrorResult(error, EXPENSE_HINTS);
      }
    },
  );
}

function toGroup(group: TeamsoExpenseGroup) {
  return compact({
    id: group.id,
    title: optionalString(group.title ?? undefined) ?? '-',
    status: statusName(group.status),
    statusCode: group.status ?? '-',
    owner: optionalString(group.owner?.fullName ?? undefined),
    receiptCount: optionalNumber(group.receiptCount) ?? 0,
    totals: (group.totals ?? []).map(total => compact({
      currency: total.currency ?? 'TRY',
      amount: money(total.amount) ?? 0,
      payable: money(total.payable),
    })),
    createdAt: toWallClock(group.createdAt),
    submittedAt: toWallClock(group.submittedAt),
    step: optionalString(group.currentStepLabel ?? undefined),
    revisionNo: optionalNumber(group.revisionNo ?? undefined),
    limitOverrun: group.limitOverrun === true,
    answer: optionalString(group.answer ?? undefined),
  });
}

export function registerListMyExpenses(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_my_expenses',
    {
      title: 'List my expenses',
      description: 'Expense groups, newest first, with their status (draft, in_approval, waiting_payment, paid, '
        + 'rejected, in_revision), totals per currency, receipt count, approval step and the approver\'s answer. '
        + 'Scope `mine` (default) lists the caller\'s own groups; `approval` lists the groups in the caller\'s '
        + `approval steps. ${EXPENSE_USER}`,
      inputSchema: {
        scope: z.enum(['mine', 'approval']).default('mine').describe('mine (default) or approval.'),
        status: z.enum(Object.keys(STATUS_CODES) as [ExpenseStatus, ...ExpenseStatus[]]).optional()
          .describe('Only groups in this status.'),
        limit: z.number().int().min(1).max(50).default(20).describe('Maximum groups (1-50, default 20).'),
      },
      outputSchema: expenseGroupsOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ scope, status, limit }, extra) => {
      try {
        const page = await client.listExpenseGroups({
          scope,
          status: status ? STATUS_CODES[status as ExpenseStatus] : undefined,
          size: limit,
        }, extra.signal);
        const groups = (page.items ?? []).filter(group => group.id).map(toGroup);
        const total = optionalNumber(page.pagination?.totalRecords) ?? groups.length;
        if (groups.length === 0) {
          return toolResult(scope === 'mine' ? 'You have no expense groups for these filters.'
            : 'No expense group is in your approval steps for these filters.', { scope, groups, total: 0 });
        }
        const table = markdownTable(['Title', 'Id', 'Status', 'Total', 'Receipts', ...(scope === 'approval' ? ['Owner'] : [])],
          groups.map(group => [
            group.title,
            `\`${group.id}\``,
            group.step ? `${group.status} (${group.step})` : group.status,
            group.totals.map(t => `${t.amount} ${t.currency}`).join(', '),
            group.receiptCount,
            ...(scope === 'approval' ? [group.owner] : []),
          ]));
        return toolResult(`## ${scope === 'mine' ? 'My expenses' : 'Expenses in my approval'} (${total})\n\n${table}`, {
          scope, groups, total,
        });
      } catch (error) {
        return apiErrorResult(error, {
          ...EXPENSE_HINTS,
          byCode: { ACCESS_DENIED: 'This list is not open to your account.' },
        });
      }
    },
  );
}

const fileSchema = z.object({
  filename: z.string().trim().min(1).max(200).describe('File name with extension (e.g. fis.jpg, fatura.pdf).'),
  content_type: z.string().trim().min(3).max(100).describe('MIME type, e.g. image/jpeg, image/png or application/pdf.'),
  base64: z.string().min(4).describe('File content, base64.'),
});

const receiptSchema = z.object({
  expense_type_id: idSchema('Expense type id (from the company\'s active expense types).'),
  amount: z.number().positive().max(100_000_000).describe('Receipt amount including tax.'),
  currency: z.enum(CURRENCIES).optional().describe('Currency (default: the expense type\'s, else TRY).'),
  date: daySchema('Receipt date (yyyy-MM-dd).'),
  description: z.string().trim().min(1).max(500).describe('What the expense was for.'),
  tax_rate: z.number().min(0).max(100).default(0).describe('VAT rate in percent (default 0).'),
  paid_by: z.enum(['employee', 'company_card']).default('employee')
    .describe('employee (default; paid back to the employee) or company_card.'),
  file: fileSchema.optional().describe('The receipt photo or PDF (at most 10 MB).'),
});

type ReceiptInput = z.infer<typeof receiptSchema>;

export function registerCreateExpense(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'create_expense',
    {
      title: 'Create an expense',
      description: 'Create an expense group for the caller with one or more receipts and send it into the expense '
        + 'approval process. Sending is signed with a timestamp, so it needs the SMS code: without `otp_code` it only '
        + 'checks the receipts against the expense types (currency, most per receipt) and previews the group (with '
        + '`send_sms_code: true` it also sends the code); with `otp_code` it creates and sends the group. A group over '
        + 'a department limit is sent only with `acknowledge_limit_overrun: true`; a blocked one is not created. '
        + EXPENSE_USER,
      inputSchema: {
        title: z.string().trim().min(1).max(200).describe('Group title, e.g. "İzmir müşteri ziyareti".'),
        description: z.string().trim().max(500).optional().describe('Note for the approvers.'),
        receipts: z.array(receiptSchema).min(1).max(20).describe('The receipts (1-20).'),
        acknowledge_limit_overrun: z.boolean().default(false)
          .describe('true: send even when the group is over a department limit (the approver sees the warning).'),
        otp_code: otpCodeSchema.optional(),
        send_sms_code: sendSmsCodeSchema,
      },
      outputSchema: expenseCreatedOutputSchema,
      annotations: ADDITIVE_WRITE,
    },
    async ({ title, description, receipts, acknowledge_limit_overrun, otp_code, send_sms_code }, extra) => {
      let groupId: string | undefined;
      try {
        const types = new Map((await client.listExpenseTypes(extra.signal))
          .filter(type => type.id && type.status !== false).map(type => [type.id, type]));
        const problems: string[] = [];
        const files: Array<{ filename: string; contentType: string; data: Uint8Array } | undefined> = [];
        const planned = (receipts as ReceiptInput[]).map((receipt, index) => {
          const n = index + 1;
          const type = types.get(receipt.expense_type_id);
          if (!type) problems.push(`Receipt ${n}: \`${receipt.expense_type_id}\` is not an active expense type.`);
          const fixed = type ? typeCurrency(type) : undefined;
          const currency = receipt.currency ?? fixed ?? 'TRY';
          if (fixed && fixed !== currency) {
            problems.push(`Receipt ${n}: ${type?.name ?? 'this type'} takes ${fixed}, not ${currency}.`);
          }
          const max = type ? typeMax(type) : undefined;
          if (max !== undefined && receipt.amount > max) {
            problems.push(`Receipt ${n}: ${type?.name ?? 'this type'} allows at most ${max} ${currency} per receipt.`);
          }
          let file: { filename: string; contentType: string; data: Uint8Array } | undefined;
          if (receipt.file) {
            const data = Buffer.from(receipt.file.base64, 'base64');
            if (data.byteLength === 0) problems.push(`Receipt ${n}: the file is not valid base64.`);
            else if (data.byteLength > MAX_RECEIPT_FILE_BYTES) problems.push(`Receipt ${n}: the file is larger than 10 MB.`);
            else file = { filename: receipt.file.filename, contentType: receipt.file.content_type, data: new Uint8Array(data) };
          }
          files.push(file);
          return compact({
            expenseTypeId: receipt.expense_type_id,
            expenseTypeName: optionalString(type?.name),
            amount: Math.round(receipt.amount * 100) / 100,
            currency,
            date: receipt.date,
            description: receipt.description,
            taxRate: receipt.tax_rate ?? 0,
            paidBy: receipt.paid_by ?? 'employee',
            file: file ? receipt.file!.filename : undefined,
          });
        });
        // A receipt takes every receipt file the caller uploaded and has not used yet (an open web form);
        // creating one now would attach those files too.
        const leftovers = await client.listPendingExpenseUploads(extra.signal).catch(() => []);
        if (leftovers.length) {
          problems.push(`You have ${leftovers.length} receipt file(s) uploaded in Teamso and not saved to a receipt `
            + 'yet (an unfinished expense form). Finish or clear that form in the Teamso app first.');
        }
        const totals = [...planned.reduce((sum, r) => sum.set(r.currency, (sum.get(r.currency) ?? 0) + r.amount),
          new Map<string, number>())].map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }));
        const summary = markdownTable(['Type', 'Date', 'Amount', 'Paid by', 'File', 'Description'],
          planned.map(r => [r.expenseTypeName ?? r.expenseTypeId, r.date, `${r.amount} ${r.currency}`, r.paidBy, r.file,
            r.description]));
        const base = { title, receipts: planned, totals, problems };

        if (!otp_code) {
          if (problems.length === 0 && send_sms_code) await client.requestOtp(extra.signal);
          const smsSent = problems.length === 0 && send_sms_code === true;
          const message = problems.length
            ? 'Teamso would refuse this group; nothing was created.'
            : smsSent
              ? 'An SMS code was sent to your phone (valid for 3 minutes). Nothing was created yet.'
              : 'Sending the group needs an SMS code. Nothing was created yet.';
          return toolResult(`## Expense preview: ${title}\n\n${summary}\n\n`
            + `${problems.length ? `${problems.map(p => `- ${p}`).join('\n')}\n\n` : ''}${message}`, {
            submitted: false,
            smsSent,
            ...base,
            message,
            ...(problems.length ? {} : {
              nextAction: smsSent
                ? {
                  tool: 'create_expense',
                  arguments: { otp_code: '<code from the SMS>' },
                  reason: 'Call again with the same title, description and receipts plus the code within 3 minutes.',
                }
                : {
                  tool: 'create_expense',
                  arguments: { send_sms_code: true },
                  reason: 'After the user confirms the receipts, call again with the same arguments and send_sms_code '
                    + 'to send the SMS code.',
                },
            }),
          });
        }
        if (problems.length) {
          return errorResult(`Teamso would refuse this group, so the SMS code was not used:\n\n`
            + problems.map(p => `- ${p}`).join('\n'));
        }

        const group = await client.createExpenseGroup({ title, description: description ?? '' }, extra.signal);
        groupId = optionalString(group?.id);
        if (!groupId) return errorResult('Teamso did not return the new expense group. Check your expenses in the app.');
        for (const [index, receipt] of planned.entries()) {
          const file = files[index];
          if (file) await client.uploadExpenseReceiptFile(file, extra.signal);
          const paid = receipt.paidBy === 'employee' ? receipt.amount : 0;
          await client.addExpenseReceipt({
            expenseFormId: groupId,
            expenseTypeId: receipt.expenseTypeId,
            receiptAmount: receipt.amount,
            currencyType: receipt.currency,
            taxRate: receipt.taxRate,
            receiptDate: receipt.date,
            expenseDescription: receipt.description,
            paidAmountToEmployee: paid,
            paidAmountByCompanyCard: receipt.amount - paid,
            advancePaymentAmount: 0,
          }, extra.signal);
        }
        const limits = await client.checkExpenseLimits(groupId, extra.signal);
        const warnings = (limits.warnings ?? []).length;
        if (limits.blocked) {
          await discard(client, groupId);
          groupId = undefined;
          return errorResult('This group is over a department limit that cannot be exceeded, so it was not created. '
            + 'Change the receipts or ask your expense manager.');
        }
        if (limits.overrun && !acknowledge_limit_overrun) {
          await discard(client, groupId);
          groupId = undefined;
          return errorResult(`This group is over ${warnings || 'a'} department limit(s). Nothing was created and the `
            + 'SMS code was not used. If the user still wants to send it (the approver sees the warning), call '
            + '`create_expense` again with the same arguments, `acknowledge_limit_overrun: true` and the same `otp_code`.');
        }
        await client.verifyOtp(otp_code, extra.signal);
        await client.submitExpenseGroup(groupId, acknowledge_limit_overrun === true, extra.signal);
        const message = 'The expense group was created and sent for approval.'
          + (limits.overrun ? ' It is over a department limit; the approver sees the warning.' : '');
        return toolResult(`## Expense sent: ${title}\n\n${summary}\n\n${message}`, {
          submitted: true,
          smsSent: false,
          groupId,
          ...base,
          ...(warnings ? { limitWarnings: warnings } : {}),
          message,
        });
      } catch (error) {
        // A group that could not be sent is removed again, so no half-made draft is left behind.
        if (groupId) await discard(client, groupId);
        if (error instanceof TeamsoApiError && error.messageCode === 'EXPENSE_DEPARTMENT_LIMIT_BLOCKED') {
          return errorResult('This group is over a department limit that cannot be exceeded, so it was not created.');
        }
        if (error instanceof TeamsoApiError && error.messageCode === 'EXPENSE_DEPARTMENT_LIMIT_CONFIRM') {
          return errorResult('This group is over a department limit. Call again with `acknowledge_limit_overrun: true` '
            + 'if the user still wants to send it.');
        }
        return apiErrorResult(error, {
          ...smsHints('create_expense'),
          byCode: {
            ...smsHints('create_expense').byCode,
            EXPENSE_TYPE_NOT_FOUND: 'One of the expense types is not active any more. List the expense types again.',
            INVALID_DATA: 'A receipt is over the most its expense type allows per receipt.',
            INVALID_FORMAT: 'A receipt\'s currency does not match its expense type.',
            TEXT_LIMIT_ERROR: 'The description can be at most 500 characters.',
          },
          forbidden: EXPENSE_USER,
        });
      }
    },
  );
}

async function discard(client: TeamsoClient, groupId: string): Promise<void> {
  try {
    await client.deleteExpenseGroup(groupId);
  } catch {
    // best effort: the draft stays in the caller's list, where they can delete it
  }
}
