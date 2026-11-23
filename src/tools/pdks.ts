import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TeamsoClient } from '../client.js';
import type { TeamsoScanCorrection } from '../types.js';
import { toWallClock } from '../utils/dates.js';
import { markdownTable } from '../utils/format.js';
import { apiErrorResult, errorResult, toolResult, type ApiErrorHints } from '../utils/results.js';
import { compact, optionalNumber, optionalString } from '../utils/structured.js';
import {
  missedScanDecisionOutputSchema,
  missedScanListOutputSchema,
  missedScanRequestOutputSchema,
  myAttendanceOutputSchema,
  myMissedScansOutputSchema,
  teamAttendanceOutputSchema,
} from './schemas.js';
import { ADDITIVE_WRITE, DESTRUCTIVE_WRITE, READ_ONLY, idSchema } from './shared.js';
import { clockSchema, confirmSchema, daySchema, personName, refusalText } from './workforce-support.js';

/** Who may use what: the PDKS responsibilities of the Sorumluluk Yönetme screen. */
const PDKS_EMPLOYEE = 'Needs a PDKS responsibility (employee, manager or admin).';
const PDKS_MANAGER = 'Reading the team needs the PDKS manager or admin responsibility; managers see their branches.';

const PDKS_HINTS: ApiErrorHints = {
  byCode: {
    MODULE_DISABLED: 'PDKS (QR time tracking) is switched off for your company.',
  },
  forbidden: PDKS_EMPLOYEE,
};

const SCAN_REASONS = ['FORGOT', 'PHONE_ISSUE', 'NO_SIGNAL', 'QR_UNAVAILABLE', 'OTHER'] as const;

/** Refusal codes of the forgotten scan endpoints (`PdksQrCorrectionService.Refused`). */
const CORRECTION_REFUSALS: Record<string, string> = {
  MODULE_DISABLED: 'PDKS (QR time tracking) is switched off for your company.',
  INVALID_INPUT: 'Give the day, the movement, the time and a reason.',
  INVALID_TYPE: 'The movement must be CHECK_IN or CHECK_OUT.',
  INVALID_TIME: 'Give the day as yyyy-MM-dd and the time as HH:mm.',
  OUT_OF_RANGE: 'That day is outside the period a forgotten scan can be reported for (not in the future, and only '
    + 'as many days back as the company allows; see limits.maxDaysBack).',
  INVALID_REASON: 'The reason must be FORGOT, PHONE_ISSUE, NO_SIGNAL, QR_UNAVAILABLE or OTHER.',
  NOTE_REQUIRED: 'This needs a note of at least 3 characters.',
  ALREADY_PENDING: 'A request for that day and movement is already waiting for the manager.',
  MONTHLY_LIMIT: 'The monthly limit of forgotten scan requests is used up (see limits.monthlyLimit).',
  FUTURE_TIME: 'The time is in the future.',
  BEFORE_ARRIVAL: 'A check-out cannot be before that day\'s check-in.',
  AFTER_DEPARTURE: 'A check-in cannot be after that day\'s check-out.',
  PAYROLL_PERIOD_CLOSED: 'The payroll period of that day is closed; HR can correct it.',
  NOT_PENDING: 'This request was already decided or withdrawn.',
  ITEM_NOT_FOUND: 'Teamso could not find that request among the ones you can see.',
};

const CARDS = {
  late: 'late',
  no_show: 'no-show',
  not_started: 'not-started',
  came_today: 'came-today',
  at_work: 'at-work',
  on_break: 'on-break',
  early_leave: 'early-leave',
} as const;
type Card = keyof typeof CARDS;

function count(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toCorrection(row: TeamsoScanCorrection) {
  return compact({
    id: row.id ?? '',
    employee: row.user ? compact({ id: optionalString(row.user.id), fullName: personName(row.user) }) : undefined,
    day: optionalString(row.day),
    type: row.type ?? '-',
    requestedAt: toWallClock(row.requestedAt),
    reason: optionalString(row.reason),
    note: optionalString(row.note),
    status: row.status ?? 'PENDING',
    canDecide: typeof row.canDecide === 'boolean' ? row.canDecide : undefined,
    decisionNote: optionalString(row.decisionNote),
    decidedAt: toWallClock(row.decidedAt),
  });
}

export function registerGetMyAttendanceToday(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'get_my_attendance_today',
    {
      title: 'Get my attendance today',
      description: 'The caller\'s own PDKS (QR time tracking) day: planned shift window, check-in and check-out '
        + 'times, break, whether the check-in was late, the next expected scan and discrepancies waiting for an '
        + `excuse. Only the caller's own data. ${PDKS_EMPLOYEE}`,
      inputSchema: {},
      outputSchema: myAttendanceOutputSchema,
      annotations: READ_ONLY,
    },
    async (_args, extra) => {
      try {
        const status = await client.getMyAttendanceStatus(extra.signal);
        const today = status.today ?? {};
        const shift = status.shift ?? {};
        const excuses = (status.pendingExcuses ?? []).filter(item => item.anomalyId).map(item => compact({
          anomalyId: item.anomalyId!,
          type: item.type ?? '-',
          date: optionalString(item.date),
          minutes: optionalNumber(item.minutes),
        }));
        const structured = {
          moduleActive: status.moduleActive !== false,
          serverTime: optionalString(status.serverTime),
          timezone: optionalString(status.timezone),
          shift: compact({
            planned: shift.hasPlan === true,
            start: optionalString(shift.start),
            end: optionalString(shift.end),
          }),
          today: compact({
            checkedInAt: optionalString(today.checkIn),
            checkedOutAt: optionalString(today.checkOut),
            onBreak: today.onBreak === true,
            breakStartedAt: optionalString(today.breakStartedAt),
            late: today.late === true,
            nextScan: optionalString(today.next),
          }),
          excusesToSend: excuses,
        };
        if (!structured.moduleActive) {
          return toolResult('PDKS (QR time tracking) is switched off for your company.', structured);
        }
        const lines = [
          '## My attendance today',
          '',
          `- **Shift:** ${structured.shift.planned ? `${structured.shift.start ?? '-'} - ${structured.shift.end ?? '-'}` : 'no shift planned'}`,
          `- **Check-in:** ${structured.today.checkedInAt ?? 'not yet'}${structured.today.late ? ' (late)' : ''}`,
          `- **Check-out:** ${structured.today.checkedOutAt ?? 'not yet'}`,
          ...(structured.today.onBreak ? [`- **On a break since:** ${structured.today.breakStartedAt ?? '-'}`] : []),
          ...(excuses.length ? [`- **Discrepancies waiting for an excuse:** ${excuses.length}`] : []),
        ];
        return toolResult(lines.join('\n'), {
          ...structured,
          nextAction: {
            tool: 'list_my_missed_scans',
            arguments: {},
            reason: 'If the user forgot to scan on a past day, list the movements without a scan.',
          },
        });
      } catch (error) {
        return apiErrorResult(error, PDKS_HINTS);
      }
    },
  );
}

export function registerGetTeamAttendanceToday(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'get_team_attendance_today',
    {
      title: 'Get team attendance today',
      description: 'Today\'s PDKS (QR time tracking) picture of the employees the caller may see: how many came, '
        + 'are at work, are late, have not come, have not started, left early or are on a break, plus the people '
        + `behind one of these counts (\`list\`, default late) with the time and minutes. ${PDKS_MANAGER}`,
      inputSchema: {
        list: z.enum(Object.keys(CARDS) as [Card, ...Card[]]).default('late')
          .describe('Whose names to list: late (default), no_show, not_started, came_today, at_work, on_break or '
            + 'early_leave.'),
        limit: z.number().int().min(1).max(200).default(50).describe('Maximum people to list (1-200, default 50).'),
      },
      outputSchema: teamAttendanceOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ list, limit }, extra) => {
      try {
        const dashboard = await client.getAttendanceDashboard(extra.signal);
        const card = await client.getAttendanceCard(CARDS[list as Card], extra.signal);
        const rows = card.rows ?? [];
        const people = rows.slice(0, limit).map(row => compact({
          userId: optionalString(row.userId),
          name: optionalString(row.userName) ?? '-',
          at: toWallClock(row.dateTime),
          minutes: optionalNumber(row.minutes),
          location: optionalString(row.locationName ?? undefined) === '-' ? undefined : optionalString(row.locationName ?? undefined),
          plannedWindow: optionalString(row.plannedWindow),
          detail: optionalString(row.detail),
        }));
        const counts = {
          cameToday: count(dashboard.cameToday),
          atWork: count(dashboard.atWork),
          late: count(dashboard.late),
          noShow: count(dashboard.noShow),
          notStarted: count(dashboard.notStarted),
          earlyLeave: count(dashboard.earlyLeave),
          onBreak: count(dashboard.onBreak),
          openDiscrepancies: count(dashboard.openAnomalies),
          pendingExcuses: count(dashboard.pendingExcuses),
        };
        const summary = `Came ${counts.cameToday} · at work ${counts.atWork} · late ${counts.late} · not come `
          + `${counts.noShow} · not started ${counts.notStarted} · left early ${counts.earlyLeave} · on a break ${counts.onBreak}`;
        const table = people.length
          ? markdownTable(['Employee', 'Time', 'Minutes', 'Location', 'Planned'],
            people.map(p => [p.name, p.at, p.minutes, p.location, p.plannedWindow]))
          : `Nobody in the ${list.replace('_', ' ')} list right now.`;
        const noLocation = count(dashboard.locationCount) === 0
          ? '\n\nNo PDKS location is set up yet, so nobody can scan.'
          : '';
        return toolResult(`## Attendance today\n\n${summary}${noLocation}\n\n### ${list.replace('_', ' ')}\n\n${table}`, {
          counts,
          locationCount: count(dashboard.locationCount),
          list,
          people,
          total: rows.length,
          truncated: rows.length > people.length,
        });
      } catch (error) {
        return apiErrorResult(error, { ...PDKS_HINTS, forbidden: PDKS_MANAGER });
      }
    },
  );
}

export function registerListMyMissedScans(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_my_missed_scans',
    {
      title: 'List my missed scans',
      description: 'The caller\'s own PDKS movements that have no scan (a check-in or check-out forgotten on a past '
        + 'day, with the suggested time), their forgotten scan requests with the manager\'s decision, and the '
        + `company limits (days back, requests per month). ${PDKS_EMPLOYEE}`,
      inputSchema: {},
      outputSchema: myMissedScansOutputSchema,
      annotations: READ_ONLY,
    },
    async (_args, extra) => {
      try {
        const mine = await client.getMyScanCorrections(extra.signal);
        const missing = (mine.missing ?? []).filter(item => item.day).map(item => compact({
          day: item.day!,
          type: item.type ?? '-',
          suggestedAt: toWallClock(item.suggestedAt),
          otherMovementAt: toWallClock(item.otherMovementAt),
        }));
        const requests = (mine.requests ?? []).filter(row => row.id).map(toCorrection);
        const limits = compact({
          maxDaysBack: optionalNumber(mine.limits?.maxDaysBack),
          monthlyLimit: optionalNumber(mine.limits?.monthlyLimit),
          usedThisMonth: optionalNumber(mine.limits?.usedThisMonth),
        });
        const reasons = (mine.reasons ?? [...SCAN_REASONS]).filter(Boolean);
        const parts = ['## My missed scans', ''];
        parts.push(missing.length
          ? markdownTable(['Day', 'Movement', 'Suggested time'], missing.map(m => [m.day, m.type, m.suggestedAt]))
          : 'No movement without a scan.');
        if (requests.length) {
          parts.push('', '### My requests', '', markdownTable(['Day', 'Movement', 'Time', 'Status', 'Note'],
            requests.map(r => [r.day, r.type, r.requestedAt, r.status, r.decisionNote ?? r.note])));
        }
        if (limits.monthlyLimit !== undefined) {
          parts.push('', `Used ${limits.usedThisMonth ?? 0} of ${limits.monthlyLimit} requests this month.`);
        }
        const first = missing[0];
        return toolResult(parts.join('\n'), {
          missing,
          requests,
          limits,
          reasons,
          ...(first ? {
            nextAction: {
              tool: 'request_missed_scan',
              arguments: {
                day: first.day,
                type: first.type,
                time: first.suggestedAt?.slice(11, 16) ?? '<HH:mm>',
                reason: 'FORGOT',
              },
              reason: 'Ask the user for the real time and the reason, preview the request, then send it with '
                + 'confirm: true once they agree.',
            },
          } : {}),
        });
      } catch (error) {
        const refusal = refusalText(error, CORRECTION_REFUSALS);
        if (refusal) return errorResult(refusal);
        return apiErrorResult(error, PDKS_HINTS);
      }
    },
  );
}

export function registerRequestMissedScan(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'request_missed_scan',
    {
      title: 'Report a missed scan',
      description: 'Ask the caller\'s manager to add a PDKS check-in or check-out the caller forgot to scan. Without '
        + '`confirm: true` it only previews the request; with it the request goes to the manager, who approves or '
        + `rejects it. The day must be within the company's limits. ${PDKS_EMPLOYEE}`,
      inputSchema: {
        day: daySchema('Day of the movement, Turkey local time (yyyy-MM-dd).'),
        type: z.enum(['CHECK_IN', 'CHECK_OUT']).describe('CHECK_IN (arrival) or CHECK_OUT (leaving).'),
        time: clockSchema('Time of the movement (HH:mm). A check-out before that day\'s check-in counts as the '
          + 'next day (night shift).'),
        reason: z.enum(SCAN_REASONS).describe('FORGOT, PHONE_ISSUE, NO_SIGNAL, QR_UNAVAILABLE or OTHER.'),
        note: z.string().trim().max(500).optional().describe('Note for the manager; required with OTHER (at least 3 '
          + 'characters).'),
        confirm: confirmSchema,
      },
      outputSchema: missedScanRequestOutputSchema,
      annotations: ADDITIVE_WRITE,
    },
    async ({ day, type, time, reason, note, confirm }, extra) => {
      const request = compact({ day, type, time, reason, note: optionalString(note) });
      if (reason === 'OTHER' && (request.note ?? '').length < 3) {
        return errorResult('With reason OTHER the manager needs a `note` of at least 3 characters.');
      }
      try {
        if (!confirm) {
          const message = `A ${type === 'CHECK_IN' ? 'check-in' : 'check-out'} at ${time} on ${day} would be sent to `
            + 'your manager for approval. Nothing was sent yet.';
          return toolResult(`## Missed scan preview\n\n${message}`, {
            submitted: false,
            request,
            message,
            nextAction: {
              tool: 'request_missed_scan',
              arguments: { ...request, confirm: true },
              reason: 'Send it only after the user agrees to these details.',
            },
          });
        }
        const saved = await client.submitScanCorrection(request, extra.signal);
        const message = 'The request was sent to your manager. The movement is added when they approve it.';
        return toolResult(`## Missed scan reported\n\n${message}`, {
          submitted: true,
          request,
          ...(saved?.id ? { correction: toCorrection(saved) } : {}),
          message,
        });
      } catch (error) {
        const refusal = refusalText(error, CORRECTION_REFUSALS);
        if (refusal) return errorResult(refusal);
        return apiErrorResult(error, PDKS_HINTS);
      }
    },
  );
}

export function registerListMissedScanRequests(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_missed_scan_requests',
    {
      title: 'List missed scan requests to decide',
      description: 'Forgotten scan requests of the employees the caller manages in PDKS: the day, the movement, the '
        + 'time asked, the reason and whether the caller may decide it (`canDecide`). PENDING (default) lists the '
        + `ones waiting; ALL adds the decided ones of the last two months. ${PDKS_MANAGER}`,
      inputSchema: {
        status: z.enum(['PENDING', 'ALL']).default('PENDING').describe('PENDING (default) or ALL.'),
        limit: z.number().int().min(1).max(200).default(50).describe('Maximum requests (1-200, default 50).'),
      },
      outputSchema: missedScanListOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ status, limit }, extra) => {
      try {
        const rows = (await client.listScanCorrections(status, extra.signal)).filter(row => row.id);
        const requests = rows.slice(0, limit).map(toCorrection);
        if (requests.length === 0) {
          return toolResult(status === 'PENDING' ? 'No missed scan request is waiting.' : 'No missed scan requests.', {
            status, requests, total: 0, truncated: false,
          });
        }
        const table = markdownTable(['Request id', 'Employee', 'Day', 'Movement', 'Time', 'Reason', 'Status'],
          requests.map(r => [`\`${r.id}\``, r.employee?.fullName, r.day, r.type, r.requestedAt, r.note ?? r.reason, r.status]));
        const decidable = requests.find(r => r.canDecide);
        return toolResult(`## Missed scan requests (${rows.length})\n\n${table}`, {
          status,
          requests,
          total: rows.length,
          truncated: rows.length > requests.length,
          ...(decidable ? {
            nextAction: {
              tool: 'decide_missed_scan_request',
              arguments: { request_id: decidable.id },
              reason: 'Ask the user to approve or reject each request (a rejection needs a note).',
            },
          } : {}),
        });
      } catch (error) {
        const refusal = refusalText(error, CORRECTION_REFUSALS);
        if (refusal) return errorResult(refusal);
        return apiErrorResult(error, { ...PDKS_HINTS, forbidden: PDKS_MANAGER });
      }
    },
  );
}

export function registerDecideMissedScanRequest(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'decide_missed_scan_request',
    {
      title: 'Approve or reject a missed scan request',
      description: 'Record the caller\'s decision on a forgotten scan request of an employee they manage. Approving '
        + 'adds the movement to the employee\'s PDKS records; rejecting needs a `note`, which the employee sees. '
        + 'Without `confirm: true` it only shows the request and the decision. The decision cannot be undone. '
        + PDKS_MANAGER,
      inputSchema: {
        request_id: idSchema('Id of a missed scan request waiting for a decision.'),
        approve: z.boolean().describe('`true` to approve, `false` to reject.'),
        note: z.string().trim().max(500).optional().describe('Required when rejecting: the reason shown to the employee.'),
        confirm: confirmSchema,
      },
      outputSchema: missedScanDecisionOutputSchema,
      annotations: DESTRUCTIVE_WRITE,
    },
    async ({ request_id, approve, note, confirm }, extra) => {
      const decision = approve ? 'approved' as const : 'rejected' as const;
      const cleanNote = optionalString(note);
      if (!approve && (cleanNote ?? '').length < 3) {
        return errorResult('Rejecting needs a `note` of at least 3 characters: the reason the employee sees.');
      }
      try {
        const waiting = (await client.listScanCorrections('PENDING', extra.signal)).find(row => row.id === request_id);
        if (!waiting) {
          return errorResult(`Missed scan request \`${request_id}\` is not waiting for a decision among the requests you `
            + 'can see. Call `list_missed_scan_requests` for the current ones.');
        }
        const request = toCorrection(waiting);
        if (waiting.canDecide === false) {
          return errorResult(`You cannot decide the request of ${request.employee?.fullName ?? 'this employee'}: `
            + 'another manager decides it.');
        }
        const what = `${request.employee?.fullName ?? 'The employee'}: ${request.type} at ${request.requestedAt ?? '-'}`;
        if (!confirm) {
          const message = `${what} would be ${decision}. Nothing was sent yet.`;
          return toolResult(`## Decision preview\n\n${message}`, {
            decided: false,
            requestId: request_id,
            decision,
            request,
            ...(cleanNote ? { note: cleanNote } : {}),
            message,
            nextAction: {
              tool: 'decide_missed_scan_request',
              arguments: { request_id, approve, ...(cleanNote ? { note: cleanNote } : {}), confirm: true },
              reason: 'Send the decision only after the user confirms it.',
            },
          });
        }
        const updated = await client.decideScanCorrection(request_id, approve, cleanNote, extra.signal);
        const message = approve
          ? `${what} was approved and added to the PDKS records.`
          : `${what} was rejected; the employee sees the note.`;
        return toolResult(`## Missed scan request ${decision}\n\n${message}`, {
          decided: true,
          requestId: request_id,
          decision,
          request: updated?.id ? toCorrection({ ...waiting, ...updated }) : request,
          ...(cleanNote ? { note: cleanNote } : {}),
          message,
        });
      } catch (error) {
        const refusal = refusalText(error, {
          ...CORRECTION_REFUSALS,
          PERMISSION_DENIED: 'Another manager decides this request.',
        });
        if (refusal) return errorResult(refusal);
        return apiErrorResult(error, { ...PDKS_HINTS, forbidden: PDKS_MANAGER });
      }
    },
  );
}
