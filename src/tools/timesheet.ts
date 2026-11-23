import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TeamsoApiError, type TeamsoClient } from '../client.js';
import type { TeamsoTimesheetMonth } from '../types.js';
import { toWallClock } from '../utils/dates.js';
import { markdownTable } from '../utils/format.js';
import { apiErrorResult, errorResult, toolResult, type ApiErrorHints } from '../utils/results.js';
import { compact, optionalNumber, optionalString } from '../utils/structured.js';
import {
  myTimesheetsOutputSchema,
  timesheetApprovalOutputSchema,
  timesheetDisputeOutputSchema,
  timesheetRoundsOutputSchema,
} from './schemas.js';
import { ADDITIVE_WRITE, DESTRUCTIVE_WRITE, READ_ONLY, idSchema, otpCodeSchema } from './shared.js';
import { confirmSchema, daySchema, hoursOf, refusalText, sendSmsCodeSchema, smsHints } from './workforce-support.js';

const EMPLOYEE_NOTE = 'Only the caller\'s own monthly timesheet summaries, which HR sends after a month ends.';
const HR_NOTE = 'Needs TIMESHEET_READ_ALL or TIMESHEET_UPDATE; only the employees of the caller\'s branches.';

const TIMESHEET_HINTS: ApiErrorHints = {
  notFound: 'Teamso could not find that monthly timesheet among yours. List them again for the current ids.',
};

/** Refusal codes of the attestation endpoints (`TimesheetAttestationService.Refused`). */
const ATTESTATION_REFUSALS: Record<string, string> = {
  NOT_PENDING: 'This monthly timesheet is not waiting for an answer any more (already approved, disputed or replaced '
    + 'by a newer version).',
  DAYS_REQUIRED: 'Name at least one day that is wrong.',
  TOO_MANY_DAYS: 'At most 31 days can be disputed at once.',
  INVALID_DAY: 'Every disputed day must be a yyyy-MM-dd day of that month.',
  NOTE_REQUIRED: 'Every disputed day needs a note of at least 3 characters.',
  INVALID_MONTH: 'Give a valid year and month.',
  APPROVE_FAILED: 'Teamso could not complete the approval. Try again later.',
};

function period(row: TeamsoTimesheetMonth): string {
  const month = optionalNumber(row.month);
  return row.year && month ? `${row.year}-${String(month).padStart(2, '0')}` : '-';
}

function totalsOf(totals: TeamsoTimesheetMonth['totals']) {
  const t = totals ?? {};
  const n = (key: string) => optionalNumber(t[key] ?? undefined);
  return compact({
    workedDays: n('workedDays'),
    missingDays: n('missingDays'),
    leaveDays: n('leaveDays'),
    unpaidLeaveDays: n('unpaidLeaveDays'),
    sickLeaveDays: n('sickLeaveDays'),
    restDays: n('restDays'),
    holidayDays: n('holidayDays'),
    workedHours: hoursOf(n('workedMinutes')),
    plannedHours: hoursOf(n('plannedMinutes')),
    overtimeHours: hoursOf(n('overtimeMinutes')),
    waitingOvertimeHours: hoursOf(n('waitingOvertimeMinutes')),
  });
}

function toMonth(row: TeamsoTimesheetMonth) {
  return compact({
    id: row.id ?? '',
    period: period(row),
    status: row.status ?? '-',
    reapproval: row.reapproval === true,
    version: optionalNumber(row.version),
    sentAt: toWallClock(row.sentAt),
    respondedAt: toWallClock(row.respondedAt),
    openDisputes: optionalNumber(row.openDisputes) ?? 0,
    disputedDays: (row.disputedDays ?? []).filter(Boolean),
    totals: totalsOf(row.totals),
  });
}

type Month = ReturnType<typeof toMonth>;

function monthLine(month: Month): string {
  const t = month.totals;
  return `${month.period}: worked ${t.workedDays ?? 0} days (${t.workedHours ?? 0} h), missing ${t.missingDays ?? 0}, `
    + `leave ${t.leaveDays ?? 0}, overtime ${t.overtimeHours ?? 0} h`;
}

async function findOwnMonth(client: TeamsoClient, id: string, signal?: AbortSignal): Promise<Month | undefined> {
  const rows = await client.listMyTimesheets(signal);
  const row = rows.find(item => item.id === id);
  return row ? toMonth(row) : undefined;
}

export function registerListMyTimesheets(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_my_timesheets',
    {
      title: 'List my monthly timesheets',
      description: 'The caller\'s monthly timesheet summaries (puantaj mutabakatı) with their status (PENDING waits '
        + 'for the caller\'s answer, APPROVED, DISPUTED), the totals of each month (worked, missing, leave, rest and '
        + `holiday days, worked and overtime hours) and the disputed days. ${EMPLOYEE_NOTE}`,
      inputSchema: {},
      outputSchema: myTimesheetsOutputSchema,
      annotations: READ_ONLY,
    },
    async (_args, extra) => {
      try {
        const months = (await client.listMyTimesheets(extra.signal)).filter(row => row.id).map(toMonth);
        if (months.length === 0) {
          return toolResult('No monthly timesheet was sent to you yet.', { months, total: 0 });
        }
        const table = markdownTable(['Month', 'Id', 'Status', 'Worked days', 'Missing days', 'Overtime h'],
          months.map(m => [m.period, `\`${m.id}\``, m.status, m.totals.workedDays, m.totals.missingDays, m.totals.overtimeHours]));
        const waiting = months.find(m => m.status === 'PENDING');
        return toolResult(`## My monthly timesheets\n\n${table}`, {
          months,
          total: months.length,
          ...(waiting ? {
            nextAction: {
              tool: 'approve_my_timesheet',
              arguments: { timesheet_id: waiting.id },
              reason: `${waiting.period} waits for the user's answer: show the totals, then approve it (SMS code) or `
                + 'dispute the wrong days.',
            },
          } : {}),
        });
      } catch (error) {
        return apiErrorResult(error, TIMESHEET_HINTS);
      }
    },
  );
}

export function registerApproveMyTimesheet(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'approve_my_timesheet',
    {
      title: 'Approve my monthly timesheet',
      description: 'Approve one of the caller\'s monthly timesheet summaries waiting for an answer ("correct, I '
        + 'approve"). It is signed as a timestamped e-document, so it needs the SMS code: without `otp_code` it only '
        + 'shows the month (and sends the code with `send_sms_code: true`); with `otp_code` it approves. If the month '
        + `changed since it was sent, nothing is approved and the new version's id comes back. ${EMPLOYEE_NOTE}`,
      inputSchema: {
        timesheet_id: idSchema('Id of one of the caller\'s monthly timesheets waiting for an answer.'),
        otp_code: otpCodeSchema.optional(),
        send_sms_code: sendSmsCodeSchema,
      },
      outputSchema: timesheetApprovalOutputSchema,
      annotations: DESTRUCTIVE_WRITE,
    },
    async ({ timesheet_id, otp_code, send_sms_code }, extra) => {
      try {
        const month = await findOwnMonth(client, timesheet_id, extra.signal);
        if (!month) {
          return errorResult(`\`${timesheet_id}\` is not one of your monthly timesheets. Call \`list_my_timesheets\` `
            + 'for the ids.');
        }
        if (month.status !== 'PENDING') {
          return errorResult(`The ${month.period} timesheet is ${month.status}; only a waiting one can be approved.`);
        }
        if (!otp_code) {
          if (send_sms_code) await client.requestOtp(extra.signal);
          const message = send_sms_code
            ? 'An SMS code was sent to your phone (valid for 3 minutes). Nothing is approved yet.'
            : 'Approving signs the month as a timestamped e-document and needs an SMS code. Nothing is approved yet.';
          return toolResult(`## ${month.period} timesheet\n\n${monthLine(month)}\n\n${message}`, {
            approved: false,
            timesheetId: timesheet_id,
            month,
            status: month.status,
            smsSent: send_sms_code === true,
            message,
            nextAction: send_sms_code
              ? {
                tool: 'approve_my_timesheet',
                arguments: { timesheet_id, otp_code: '<code from the SMS>' },
                reason: 'Ask the user for the code in the SMS and approve within 3 minutes.',
              }
              : {
                tool: 'approve_my_timesheet',
                arguments: { timesheet_id, send_sms_code: true },
                reason: 'After the user confirms the totals are right, send the SMS code.',
              },
          });
        }
        await client.verifyOtp(otp_code, extra.signal);
        const response = await client.approveMyTimesheet(timesheet_id, extra.signal);
        const status = optionalString(response.result?.status) ?? 'APPROVED';
        const message = `The ${month.period} timesheet is approved and signed with a timestamp.`;
        return toolResult(`## Timesheet approved\n\n${message}`, {
          approved: true,
          timesheetId: timesheet_id,
          month: { ...month, status },
          status,
          smsSent: false,
          message,
        });
      } catch (error) {
        if (error instanceof TeamsoApiError && error.apiMessage === 'CHANGED') {
          const next = (error.result as { id?: unknown } | undefined)?.id;
          const newId = typeof next === 'string' ? next : undefined;
          const message = 'The month changed after it was sent, so nothing was approved. A new version waits: show it '
            + 'to the user before approving.';
          return toolResult(`## Timesheet changed\n\n${message}`, {
            approved: false,
            timesheetId: timesheet_id,
            status: 'SUPERSEDED',
            smsSent: false,
            ...(newId ? { newTimesheetId: newId } : {}),
            message,
            nextAction: {
              tool: 'list_my_timesheets',
              arguments: {},
              reason: 'Read the new version, confirm it with the user and approve that one.',
            },
          });
        }
        const refusal = refusalText(error, ATTESTATION_REFUSALS);
        if (refusal) return errorResult(refusal);
        return apiErrorResult(error, { ...smsHints('approve_my_timesheet'), notFound: TIMESHEET_HINTS.notFound });
      }
    },
  );
}

export function registerDisputeMyTimesheet(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'dispute_my_timesheet',
    {
      title: 'Dispute days of my monthly timesheet',
      description: 'Mark days of one of the caller\'s waiting monthly timesheet summaries as wrong ("something is '
        + 'wrong"), with a note for each day. HR answers each day and sends the corrected month again. Without '
        + `\`confirm: true\` it only previews. ${EMPLOYEE_NOTE}`,
      inputSchema: {
        timesheet_id: idSchema('Id of one of the caller\'s monthly timesheets waiting for an answer.'),
        days: z.array(z.object({
          day: daySchema('A day of that month (yyyy-MM-dd).'),
          note: z.string().trim().min(3).max(500).describe('What is wrong on that day (at least 3 characters).'),
        })).min(1).max(31).describe('The wrong days, each with a note (1-31).'),
        note: z.string().trim().max(1000).optional().describe('General note for HR.'),
        confirm: confirmSchema,
      },
      outputSchema: timesheetDisputeOutputSchema,
      annotations: ADDITIVE_WRITE,
    },
    async ({ timesheet_id, days, note, confirm }, extra) => {
      try {
        const month = await findOwnMonth(client, timesheet_id, extra.signal);
        if (!month) {
          return errorResult(`\`${timesheet_id}\` is not one of your monthly timesheets. Call \`list_my_timesheets\` `
            + 'for the ids.');
        }
        if (month.status !== 'PENDING') {
          return errorResult(`The ${month.period} timesheet is ${month.status}; only a waiting one can be disputed.`);
        }
        const outside = days.filter(d => !d.day.startsWith(`${month.period}-`));
        if (outside.length) {
          return errorResult(`These days are not in ${month.period}: ${outside.map(d => d.day).join(', ')}.`);
        }
        const cleanNote = optionalString(note);
        const list = days.map(d => `- **${d.day}:** ${d.note}`).join('\n');
        if (!confirm) {
          const message = `${days.length} day(s) of ${month.period} would be sent to HR as wrong. Nothing was sent yet.`;
          return toolResult(`## Dispute preview\n\n${list}\n\n${message}`, {
            disputed: false,
            timesheetId: timesheet_id,
            month,
            days,
            ...(cleanNote ? { note: cleanNote } : {}),
            status: month.status,
            message,
            nextAction: {
              tool: 'dispute_my_timesheet',
              arguments: { timesheet_id, days, ...(cleanNote ? { note: cleanNote } : {}), confirm: true },
              reason: 'Send the dispute only after the user confirms the days and notes.',
            },
          });
        }
        const result = await client.disputeMyTimesheet(timesheet_id, { days, ...(cleanNote ? { note: cleanNote } : {}) },
          extra.signal);
        const status = optionalString(result?.status) ?? 'DISPUTED';
        const message = `The disputed days were sent to HR. They answer each day and send ${month.period} again.`;
        return toolResult(`## Timesheet disputed\n\n${list}\n\n${message}`, {
          disputed: true,
          timesheetId: timesheet_id,
          month: { ...month, status },
          days,
          ...(cleanNote ? { note: cleanNote } : {}),
          status,
          message,
        });
      } catch (error) {
        const refusal = refusalText(error, ATTESTATION_REFUSALS);
        if (refusal) return errorResult(refusal);
        return apiErrorResult(error, TIMESHEET_HINTS);
      }
    },
  );
}

/** The month before today (Turkey time): HR sends a month once it is over. */
function previousMonth(now = new Date()): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit' })
    .formatToParts(now);
  const year = Number(parts.find(p => p.type === 'year')?.value);
  const month = Number(parts.find(p => p.type === 'month')?.value);
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function registerGetTimesheetApprovalStatus(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'get_timesheet_approval_status',
    {
      title: 'Get the monthly timesheet approval status',
      description: 'For HR: who approved, who still waits and who disputed the monthly timesheet summary of a month '
        + '(default the previous month), with the counts, the employees not sent the month yet, the disputed days '
        + `and the missing days of each employee. ${HR_NOTE}`,
      inputSchema: {
        year: z.number().int().min(2000).max(2100).optional().describe('Year (default: the previous month\'s).'),
        month: z.number().int().min(1).max(12).optional().describe('Month 1-12 (default: the previous month).'),
        status: z.enum(['PENDING', 'APPROVED', 'DISPUTED', 'REAPPROVAL']).optional()
          .describe('Only employees in this status; REAPPROVAL is a corrected month waiting again.'),
        limit: z.number().int().min(1).max(500).default(100).describe('Maximum employees (1-500, default 100).'),
      },
      outputSchema: timesheetRoundsOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ year, month, status, limit }, extra) => {
      try {
        const fallback = previousMonth();
        const target = { year: year ?? fallback.year, month: month ?? fallback.month };
        const rounds = await client.getTimesheetRounds({ ...target, status }, extra.signal);
        const rows = (rounds.rows ?? []).filter(row => row.id);
        const employees = rows.slice(0, limit).map(row => compact({
          timesheetId: row.id!,
          userId: optionalString(row.userId),
          name: optionalString(row.name) ?? '-',
          personnelId: optionalString(row.personnelId),
          branchName: optionalString(row.branchName),
          departmentName: optionalString(row.departmentName),
          status: row.status ?? '-',
          reapproval: row.reapproval === true,
          sentAt: toWallClock(row.sentAt),
          respondedAt: toWallClock(row.respondedAt),
          openDisputes: optionalNumber(row.openDisputes) ?? 0,
          disputedDays: (row.disputedDays ?? []).filter(Boolean),
          missingDays: optionalNumber(row.totals?.['missingDays'] ?? undefined),
        }));
        const c = rounds.counts ?? {};
        const counts = {
          total: optionalNumber(c['total']) ?? 0,
          approved: optionalNumber(c['APPROVED']) ?? 0,
          pending: optionalNumber(c['PENDING']) ?? 0,
          disputed: optionalNumber(c['DISPUTED']) ?? 0,
        };
        const label = `${target.year}-${String(target.month).padStart(2, '0')}`;
        const notSent = optionalNumber(rounds.notSent) ?? 0;
        const head = `Sent ${counts.total} · approved ${counts.approved} · waiting ${counts.pending} · disputed `
          + `${counts.disputed} · not sent yet ${notSent}`;
        const table = employees.length
          ? markdownTable(['Employee', 'Branch', 'Status', 'Missing days', 'Disputed days'],
            employees.map(e => [e.name, e.branchName, e.reapproval ? `${e.status} (again)` : e.status, e.missingDays,
              e.disputedDays.join(', ')]))
          : 'No employee in this list.';
        return toolResult(`## Timesheet approvals ${label}\n\n${head}\n\n${table}`, {
          period: label,
          counts,
          notSent,
          monthOver: rounds.monthOver === true,
          canSend: rounds.canSend === true,
          employees,
          total: rows.length,
          truncated: rows.length > employees.length,
        });
      } catch (error) {
        const refusal = refusalText(error, ATTESTATION_REFUSALS);
        if (refusal) return errorResult(refusal);
        return apiErrorResult(error, { forbidden: HR_NOTE });
      }
    },
  );
}
