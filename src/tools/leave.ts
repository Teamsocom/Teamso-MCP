import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TeamsoClient } from '../client.js';
import type { TeamsoLeave } from '../types.js';
import { parseWallClock } from '../utils/dates.js';
import {
  escapeCell,
  formatDateRange,
  formatDays,
  markdownTable,
} from '../utils/format.js';
import {
  apiErrorResult,
  errorResult,
  toolResult,
  type ApiErrorHints,
} from '../utils/results.js';
import {
  LEAVE_STATUSES,
  closedPayrollPeriodsOf,
  roundDays,
  toLeavePolicy,
  toLeaveSummary,
  toLeaveType,
  type LeaveStatus,
  type LeaveSummary,
} from '../utils/structured.js';
import {
  explainLeaveReason,
  leaveOwnerId,
  leaveTypeIdOf,
  loadLeavePolicy,
  prepareLeaveRequest,
  scanLeaves,
  type PreparedLeaveRequest,
} from './leave-support.js';
import {
  leaveBalanceOutputSchema,
  leaveCalculationOutputSchema,
  leaveCancelledOutputSchema,
  leaveChangeOutputSchema,
  leaveCreatedOutputSchema,
  leaveListOutputSchema,
  leaveTypesOutputSchema,
  otpOutputSchema,
} from './schemas.js';
import {
  ADDITIVE_WRITE,
  DESTRUCTIVE_WRITE,
  READ_ONLY,
  idSchema,
  leaveDateSchema,
  otpCodeSchema,
} from './shared.js';

const OTP_VALIDITY_SECONDS = 180;

const LEAVE_POLICY_HINTS: ApiErrorHints = {
  notFound: 'No leave types are set up in your leave policy. Ask your HR administrator.',
};

const OTP_HINTS: ApiErrorHints = {
  byCode: {
    OTP_NOT_DONE: 'The SMS verification is missing or was already used. Call `request_leave_otp`, '
      + 'ask the user for the new code, and retry with `otp_code`.',
    'validation error.The token is not correct.': 'The SMS code is wrong. Ask the user to check the '
      + 'code, or call `request_leave_otp` for a new one.',
    'validation error.token is expired.': 'The SMS code has expired (codes are valid for 3 minutes). '
      + 'Call `request_leave_otp` for a new code.',
    'Token Not Found': 'No SMS code is waiting for verification. Call `request_leave_otp` first.',
    'validation error.too many attempts.': 'Too many wrong SMS codes: this code is cancelled. Call '
      + '`request_leave_otp` for a new one and ask the user for it.',
    'validation error.a newer code was sent.': 'That code is from an older SMS; a newer code was sent since. Ask the '
      + 'user for the code in the latest SMS.',
  },
};

const leaveRequestInput = {
  leave_type_id: idSchema('Leave type id (the `id` of a leave type in the caller\'s policy).'),
  start: leaveDateSchema('start'),
  end: leaveDateSchema('end'),
};

export function registerListLeaveTypes(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_leave_types',
    {
      title: 'List the leave types I can request',
      description: 'List the leave types in the caller\'s leave policy with their ids, the remaining '
        + 'balance (`remainingDays`) and the rules of each type (per-request limits, document or '
        + 'description requirements).',
      inputSchema: {},
      outputSchema: leaveTypesOutputSchema,
      annotations: READ_ONLY,
    },
    async (_args, extra) => {
      try {
        const context = await loadLeavePolicy(client, extra.signal);
        const policy = toLeavePolicy(context.assignment);
        const leaveTypes = context.balances.map(toLeaveType);
        const table = markdownTable(
          ['Leave type', 'Id', 'Remaining', 'Rules'],
          leaveTypes.map(type => [
            type.isDefault ? `${type.name} (default)` : type.name,
            `\`${type.id}\``,
            formatDays(type.remainingDays),
            leaveTypeRules(type).join('; '),
          ]),
        );
        return toolResult(`## Leave types: ${policy.name ?? 'your policy'}\n\n${table}`, { policy, leaveTypes });
      } catch (error) {
        return apiErrorResult(error, LEAVE_POLICY_HINTS);
      }
    },
  );
}

export function registerGetMyLeaveBalance(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'get_my_leave_balance',
    {
      title: 'Get my leave balance',
      description: 'Return the caller\'s remaining leave days for every leave type in their policy.',
      inputSchema: {},
      outputSchema: leaveBalanceOutputSchema,
      annotations: READ_ONLY,
    },
    async (_args, extra) => {
      try {
        const context = await loadLeavePolicy(client, extra.signal);
        const balances = context.balances.map(toLeaveType).map(type => ({
          leaveTypeId: type.id,
          leaveTypeName: type.name,
          remainingDays: type.remainingDays,
          isDefault: type.isDefault,
        }));
        const lines = balances.map(balance => `- **${balance.leaveTypeName}:** ${formatDays(balance.remainingDays)}`);
        return toolResult(`## My leave balance\n\n${lines.join('\n') || 'No leave types.'}`, {
          policy: toLeavePolicy(context.assignment),
          balances,
        });
      } catch (error) {
        return apiErrorResult(error, LEAVE_POLICY_HINTS);
      }
    },
  );
}

export function registerCalculateLeaveDays(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'calculate_leave_days',
    {
      title: 'Calculate leave days',
      description: 'Count the working days a leave request would use (weekends, holidays and the caller\'s '
        + 'shift are applied by Teamso), with the return-to-work date and the result of Teamso\'s '
        + 'pre-check. Creates nothing. Dates are Turkey local time.',
      inputSchema: leaveRequestInput,
      outputSchema: leaveCalculationOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ leave_type_id, start, end }, extra) => {
      try {
        const prepared = await prepareLeaveRequest(
          client,
          { leaveTypeId: leave_type_id, start, end },
          extra.signal,
        );
        const request = draftOf(prepared);
        const remainingDays = prepared.leaveType.remainingDays;
        const canRequest = prepared.problems.length === 0;
        const lines = [
          `## ${prepared.leaveType.name}: ${formatDays(prepared.workingDays)}`,
          '',
          `- **Dates:** ${formatDateRange(prepared.startDate, prepared.endDate)}`,
          `- **Back at work:** ${prepared.returnToWorkDate ?? '-'}`,
          `- **Balance:** ${formatDays(remainingDays)} → ${formatDays(remainingDays - prepared.workingDays)} after this request`,
        ];
        if (!canRequest) {
          lines.push('', '**Teamso would refuse this request:**', ...prepared.problems.map(problem => `- ${problem}`));
        } else {
          lines.push('', 'Confirm with the user, then call `request_leave_otp` to send the SMS code.');
        }
        return toolResult(lines.join('\n'), {
          request,
          remainingDays,
          remainingAfterRequest: roundDays(remainingDays - prepared.workingDays),
          canRequest,
          problems: prepared.problems,
          ...(canRequest
            ? {
              nextAction: {
                tool: 'request_leave_otp',
                arguments: {},
                reason: 'Creating the request needs an SMS code. After the user confirms these days, send '
                  + 'the code, then call create_leave_request with the same leave_type_id, start, end and the otp_code.',
              },
            }
            : {}),
        });
      } catch (error) {
        return apiErrorResult(error, LEAVE_POLICY_HINTS);
      }
    },
  );
}

export function registerRequestLeaveOtp(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'request_leave_otp',
    {
      title: 'Send a leave SMS verification code',
      description: 'Send a 6-digit SMS verification code to the caller\'s phone. Teamso requires it to '
        + 'create or cancel a leave request. The code is valid for 3 minutes, a new code invalidates the '
        + 'previous one, and each SMS uses company digital credit.',
      inputSchema: {},
      outputSchema: otpOutputSchema,
      annotations: ADDITIVE_WRITE,
    },
    async (_args, extra) => {
      try {
        await client.requestOtp(extra.signal);
        const message = 'An SMS code was sent to your phone number registered in Teamso. It is valid for 3 minutes.';
        return toolResult(`${message}\n\nAsk the user for the code, then call \`create_leave_request\` `
          + '(or `cancel_leave_request`) with `otp_code`.', {
          sent: true,
          validForSeconds: OTP_VALIDITY_SECONDS,
          message,
          nextAction: {
            tool: 'create_leave_request',
            arguments: { otp_code: '<code from the SMS>' },
            reason: 'Ask the user for the SMS code and pass it with the confirmed leave details '
              + '(or to cancel_leave_request when cancelling) within 3 minutes.',
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

export function registerCreateLeaveRequest(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'create_leave_request',
    {
      title: 'Create a leave request',
      description: 'Create a leave request for the caller and send it into the approval chain. Requires the '
        + 'SMS verification code sent to the caller\'s phone. Teamso recounts the working days and runs its '
        + 'pre-check before the code is used.',
      inputSchema: {
        ...leaveRequestInput,
        description: z.string().trim().max(1000).optional()
          .describe('Reason or note for the approver. Required by some leave types.'),
        otp_code: otpCodeSchema,
      },
      outputSchema: leaveCreatedOutputSchema,
      annotations: ADDITIVE_WRITE,
    },
    async ({ leave_type_id, start, end, description, otp_code }, extra) => {
      try {
        const prepared = await prepareLeaveRequest(
          client,
          { leaveTypeId: leave_type_id, start, end },
          extra.signal,
        );
        if (prepared.leaveType.descriptionRequired && !description) {
          prepared.problems.push(explainLeaveReason('DESCRIPTION_REQUIRED'));
        }
        if (prepared.problems.length > 0) {
          return errorResult('Teamso would refuse this leave request, so the SMS code was not used:\n\n'
            + prepared.problems.map(problem => `- ${problem}`).join('\n'));
        }

        await client.verifyOtp(otp_code, extra.signal);
        const response = await client.createLeave({
          leaveType: prepared.leaveType.id,
          personnelId: [prepared.me.id],
          leavePolicyUserId: prepared.context.assignment.leavePolicyUserId,
          startDate: prepared.startDate,
          endDate: prepared.endDate,
          ...(prepared.returnToWorkDate ? { returnToWorkDate: prepared.returnToWorkDate } : {}),
          totalLeaveDay: prepared.workingDays,
          ...(description ? { description } : {}),
          documentAttached: false,
          approveAndContinue: false,
        }, extra.signal);

        const leave = await findCreatedLeave(client, prepared, extra.signal);
        const request = draftOf(prepared);
        const message = createdLeaveMessage(leave);
        const lines = [
          `## Leave request created`,
          '',
          `- **Type:** ${request.leaveTypeName}`,
          `- **Dates:** ${formatDateRange(request.start, request.end)} (${formatDays(request.workingDays)})`,
          `- **Status:** ${leave?.status ?? response.message_code ?? 'submitted'}`,
          '',
          message,
        ];
        return toolResult(lines.join('\n'), { created: true, request, leave, message });
      } catch (error) {
        return apiErrorResult(error, {
          ...OTP_HINTS,
          byCode: {
            ...OTP_HINTS.byCode,
            ITEM_EXIST: 'You already have a leave request on these dates.',
            balance_cannot_go_negative: explainLeaveReason('balance_cannot_go_negative'),
            leave_available_for_dates: explainLeaveReason('leave_available_for_dates'),
            DESCRIPTION_REQUIRED: explainLeaveReason('DESCRIPTION_REQUIRED'),
          },
          forbidden: 'Requesting leave needs the `LEAVE_ADD` permission.',
        });
      }
    },
  );
}

export function registerListMyLeaves(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_my_leaves',
    {
      title: 'List my leave requests',
      description: 'List the caller\'s own leave requests, newest first, with their approval status. '
        + 'Optionally filter by date range and status.',
      inputSchema: {
        from: z.string().trim().optional().describe('Only leaves from this day on (`yyyy-MM-dd`).'),
        to: z.string().trim().optional().describe('Only leaves up to this day (`yyyy-MM-dd`).'),
        status: z.enum(Object.keys(LEAVE_STATUSES) as [LeaveStatus, ...LeaveStatus[]]).optional()
          .describe('Only leaves in this status.'),
        limit: z.number().int().min(1).max(100).default(20).describe('Maximum leaves to return (1-100, default 20).'),
      },
      outputSchema: leaveListOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ from, to, status, limit }, extra) => {
      try {
        const rangeStart = from ? parseWallClock(from, 'from').date : undefined;
        const rangeEnd = to ? parseWallClock(to, 'to').date : undefined;
        const statusCode = status ? LEAVE_STATUSES[status] : undefined;
        const me = await client.getMe(extra.signal);
        const { leaves, truncated } = await scanLeaves(
          client,
          {
            rangeStart,
            rangeEnd,
            ...(statusCode !== undefined ? { searchKey: 'state', searchValue: String(statusCode) } : {}),
          },
          leave => leaveOwnerId(leave) === me.id && (statusCode === undefined || leave.state === statusCode),
          { limit },
          extra.signal,
        );
        const summaries = leaves.map(toLeaveSummary);
        const text = summaries.length
          ? `## My leave requests\n\n${leaveTable(summaries)}`
          : 'No leave requests found for these filters.';
        return toolResult(text, { leaves: summaries, total: summaries.length, truncated });
      } catch (error) {
        return apiErrorResult(error, {
          forbidden: 'Listing leave requests needs the `LEAVE_ADD`, `LEAVE_ADD_ALL` or `LEAVE_READ_ALL` permission.',
        });
      }
    },
  );
}

const CHANGE_REFUSALS: Record<string, string> = {
  REASON_REQUIRED: 'Give a reason of at least 3 characters.',
  NOT_APPROVED: 'Only an approved leave can be changed.',
  CHANGE_PENDING: 'This leave already has a change waiting for approval.',
  LEAVE_ENDED: 'A leave that has ended cannot be changed by the employee; HR can correct it.',
  ALREADY_STARTED: 'A leave that has started cannot be cancelled; use change_leave_request with kind EARLY_RETURN.',
  START_IN_PAST: 'The new start cannot be before today.',
  OVERLAP: 'The new dates overlap another leave of the caller.',
  BALANCE: 'The balance is not enough for the new dates.',
  NO_CHANGE: 'The new dates are the same as the current ones.',
  USE_CANCEL: 'Coming back on the first day is a cancellation: use cancel_leave_request.',
  NOT_EARLIER: 'The return day must be before the end of the leave.',
  INVALID_DATES: 'Give a valid start_date and end_date (end not before start).',
  INVALID_RETURN_DATE: 'Give the return_date (the day back at work).',
  LEAST_DAY_COUNT: 'This leave type has a minimum number of days.',
  MOST_DAY_COUNT: 'This leave type has a maximum number of days.',
  NO_WORKING_DAY: 'There is no working day in the chosen range.',
};

/** The refusal code the leave change endpoints put in `message` (HTTP 400), or null. */
function changeRefusal(error: unknown): string | null {
  const body = (error as { body?: { message?: unknown } } | undefined)?.body;
  const code = typeof body?.message === 'string' ? body.message : null;
  return code && CHANGE_REFUSALS[code] ? CHANGE_REFUSALS[code] : null;
}

async function findOwnLeave(client: TeamsoClient, leaveId: string, signal?: AbortSignal) {
  const me = await client.getMe(signal);
  const { leaves } = await scanLeaves(
    client,
    {},
    leave => leave.id === leaveId && leaveOwnerId(leave) === me.id,
    { limit: 1 },
    signal,
  );
  return leaves[0];
}

export function registerCancelLeaveRequest(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'cancel_leave_request',
    {
      title: 'Cancel my leave request',
      description: 'Cancel one of the caller\'s own leaves. A request still waiting for a decision is withdrawn '
        + '(no SMS code). An approved leave that has not started is cancelled without being deleted: it stays '
        + 'as Cancelled with the reason and its days return to the balance; this needs `reason` and the SMS code '
        + 'and goes through the leave approval process unless the company applies it at once. A leave that has '
        + 'started cannot be cancelled here: shorten it as an early return.',
      inputSchema: {
        leave_id: idSchema('Id of one of the caller\'s own leaves.'),
        reason: z.string().trim().max(1000).optional()
          .describe('Why the approved leave is cancelled (at least 3 characters). Not needed to withdraw a pending request.'),
        otp_code: otpCodeSchema.optional(),
      },
      outputSchema: leaveCancelledOutputSchema,
      annotations: DESTRUCTIVE_WRITE,
    },
    async ({ leave_id, reason, otp_code }, extra) => {
      try {
        const target = await findOwnLeave(client, leave_id, extra.signal);
        if (!target) {
          return errorResult(`Leave \`${leave_id}\` is not one of your leaves. `
            + 'Find the id with `list_my_leaves`. Use `approve_or_reject_leave` for leaves you approve.');
        }
        const leave = toLeaveSummary(target);
        if (target.state === LEAVE_STATUSES.pending_approval || target.state === LEAVE_STATUSES.awaiting_document) {
          await client.withdrawLeave(leave_id, extra.signal);
          const message = 'The leave request was withdrawn; its days are back on the balance.';
          return toolResult(
            `## Leave request withdrawn\n\n- **Type:** ${leave.leaveTypeName ?? '-'}\n`
              + `- **Dates:** ${formatDateRange(leave.start, leave.end)}\n\n${message}`,
            { cancelled: true, outcome: 'WITHDRAWN', leave, closedPayrollPeriods: [], message },
          );
        }
        if (target.state !== LEAVE_STATUSES.approved && target.state !== LEAVE_STATUSES.completed) {
          return errorResult(`This leave is ${leave.status}; only a pending request or an approved leave can be cancelled.`);
        }
        if (!reason || reason.trim().length < 3) {
          return errorResult('Cancelling an approved leave needs `reason` (at least 3 characters).');
        }
        if (!otp_code) {
          return errorResult('Cancelling an approved leave needs the SMS code: call `request_leave_otp`, '
            + 'then call cancel_leave_request again with `otp_code` and `reason`.');
        }
        await client.verifyOtp(otp_code, extra.signal);
        const response = await client.submitLeaveChange(leave_id, { kind: 'CANCEL', reason }, extra.signal);
        const result = (response.result ?? {}) as { id?: string; applied?: boolean; closedPayrollPeriods?: string[] };
        const closedPayrollPeriods = Array.isArray(result.closedPayrollPeriods) ? result.closedPayrollPeriods : [];
        const applied = result.applied === true;
        const message = (applied
          ? 'The leave is cancelled (status Cancelled, kept with the reason); its days are back on the balance.'
          : 'The cancellation was sent for approval; the leave stays approved until it is decided.')
          + (closedPayrollPeriods.length
            ? ` It touches closed payroll periods (${closedPayrollPeriods.join(', ')}); tell HR so payroll can be corrected.`
            : '');
        return toolResult(
          `## ${applied ? 'Leave cancelled' : 'Cancellation sent for approval'}\n\n- **Type:** ${leave.leaveTypeName ?? '-'}\n`
            + `- **Dates:** ${formatDateRange(leave.start, leave.end)}\n\n${message}`,
          {
            cancelled: applied,
            outcome: applied ? 'CANCELLED' : 'SENT_FOR_APPROVAL',
            ...(result.id ? { changeId: result.id } : {}),
            leave,
            closedPayrollPeriods,
            message,
          },
        );
      } catch (error) {
        const refusal = changeRefusal(error);
        if (refusal) return errorResult(refusal);
        return apiErrorResult(error, {
          ...OTP_HINTS,
          forbidden: 'Teamso did not allow cancelling this leave.',
          notFound: 'Teamso could not find that leave.',
        });
      }
    },
  );
}

export function registerChangeLeaveRequest(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'change_leave_request',
    {
      title: 'Change my approved leave',
      description: 'Change the dates of one of the caller\'s approved leaves without deleting it (kind RESCHEDULE '
        + 'with start_date and end_date), or shorten it after coming back early (kind EARLY_RETURN with '
        + 'return_date, the day back at work). Without `otp_code` it only previews the change: new dates and '
        + 'working days, days back to the balance, closed payroll periods and whether it goes for approval. '
        + 'With `otp_code` (the SMS code) and `reason` it sends the change; it goes through the leave '
        + 'approval process unless the company applies it at once.',
      inputSchema: {
        leave_id: idSchema('Id of one of the caller\'s approved leaves.'),
        kind: z.enum(['RESCHEDULE', 'EARLY_RETURN']).describe('RESCHEDULE: new dates. EARLY_RETURN: came back early.'),
        start_date: leaveDateSchema('start').optional().describe('RESCHEDULE: the new first day (yyyy-MM-dd).'),
        end_date: leaveDateSchema('end').optional().describe('RESCHEDULE: the new last day (yyyy-MM-dd).'),
        return_date: leaveDateSchema('start').optional().describe('EARLY_RETURN: the day back at work (yyyy-MM-dd).'),
        reason: z.string().trim().max(1000).optional().describe('Why the leave changes (needed to send).'),
        otp_code: otpCodeSchema.optional(),
      },
      outputSchema: leaveChangeOutputSchema,
      annotations: ADDITIVE_WRITE,
    },
    async ({ leave_id, kind, start_date, end_date, return_date, reason, otp_code }, extra) => {
      try {
        const target = await findOwnLeave(client, leave_id, extra.signal);
        if (!target) {
          return errorResult(`Leave \`${leave_id}\` is not one of your leaves. Find the id with \`list_my_leaves\`.`);
        }
        const leave = toLeaveSummary(target);
        const change = kind === 'RESCHEDULE'
          ? { kind, startDate: start_date?.slice(0, 10), endDate: end_date?.slice(0, 10) }
          : { kind, returnDate: return_date?.slice(0, 10) };
        const previewEnvelope = await client.previewLeaveChange(leave_id, change, extra.signal);
        const p = (previewEnvelope.result ?? {}) as {
          new?: { startDate?: string; endDate?: string; returnToWorkDate?: string; days?: number };
          daysBack?: number; closedPayrollPeriods?: string[]; applyAtOnce?: boolean;
        };
        const preview = compactPreview({
          newStart: p.new?.startDate,
          newEnd: p.new?.endDate,
          newReturnToWork: p.new?.returnToWorkDate,
          newWorkingDays: typeof p.new?.days === 'number' ? roundDays(p.new.days) : undefined,
          daysBackToBalance: roundDays(Number(p.daysBack ?? 0)),
          closedPayrollPeriods: Array.isArray(p.closedPayrollPeriods) ? p.closedPayrollPeriods : [],
          appliesAtOnce: p.applyAtOnce === true,
        });
        const summary = `- **Now:** ${formatDateRange(leave.start, leave.end)} (${leave.workingDays ?? '-'} days)\n`
          + `- **After:** ${formatDateRange(preview.newStart, preview.newEnd)} (${preview.newWorkingDays ?? '-'} days)\n`
          + `- **Back to the balance:** ${preview.daysBackToBalance} days\n`
          + (preview.closedPayrollPeriods.length ? `- **Closed payroll periods:** ${preview.closedPayrollPeriods.join(', ')}\n` : '');
        if (!otp_code) {
          const message = preview.appliesAtOnce ? 'The change would apply at once.' : 'The change would go for approval.';
          return toolResult(`## Leave change preview\n\n${summary}\n${message} Confirm with the user, then send the SMS code.`, {
            submitted: false, kind, leave, preview, status: 'PREVIEW', message,
            nextAction: {
              tool: 'request_leave_otp',
              arguments: {},
              reason: 'Sending the change needs an SMS code. After the user confirms, send the code, then call '
                + 'change_leave_request with the same arguments, `reason` and the otp_code.',
            },
          });
        }
        if (!reason || reason.trim().length < 3) {
          return errorResult('Sending the change needs `reason` (at least 3 characters).');
        }
        await client.verifyOtp(otp_code, extra.signal);
        const response = await client.submitLeaveChange(leave_id, { ...change, reason }, extra.signal);
        const result = (response.result ?? {}) as { id?: string; applied?: boolean };
        const applied = result.applied === true;
        const message = applied ? 'The leave is updated in place; the balance follows.'
          : 'The change was sent for approval; the leave keeps its dates until it is decided.';
        return toolResult(`## ${applied ? 'Leave changed' : 'Change sent for approval'}\n\n${summary}\n${message}`, {
          submitted: true, kind, leave, preview, status: applied ? 'APPROVED' : 'PENDING',
          ...(result.id ? { changeId: result.id } : {}), message,
        });
      } catch (error) {
        const refusal = changeRefusal(error);
        if (refusal) return errorResult(refusal);
        return apiErrorResult(error, {
          ...OTP_HINTS,
          forbidden: 'Teamso did not allow changing this leave.',
          notFound: 'Teamso could not find that leave.',
        });
      }
    },
  );
}

function compactPreview<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function draftOf(prepared: PreparedLeaveRequest) {
  return {
    leaveTypeId: prepared.leaveType.id,
    leaveTypeName: prepared.leaveType.name,
    start: prepared.startDate,
    end: prepared.endDate,
    workingDays: roundDays(prepared.workingDays),
    ...(prepared.returnToWorkDate ? { returnToWorkDate: prepared.returnToWorkDate } : {}),
  };
}

/** `POST /leave` returns no id, so the new leave is looked up in the caller's list. */
async function findCreatedLeave(
  client: TeamsoClient,
  prepared: PreparedLeaveRequest,
  signal?: AbortSignal,
): Promise<LeaveSummary | null> {
  try {
    const { leaves } = await scanLeaves(
      client,
      {},
      (leave: TeamsoLeave) => leaveOwnerId(leave) === prepared.me.id
        && leaveTypeIdOf(leave) === prepared.leaveType.id
        && leave.startDate === prepared.startDate,
      { limit: 1, pageSize: 50, maxPages: 1 },
      signal,
    );
    return leaves[0] ? toLeaveSummary(leaves[0]) : null;
  } catch {
    return null;
  }
}

function leaveTypeRules(type: ReturnType<typeof toLeaveType>): string[] {
  const rules: string[] = [];
  if (type.minDaysPerRequest) rules.push(`min ${type.minDaysPerRequest} days/request`);
  if (type.maxDaysPerRequest) rules.push(`max ${type.maxDaysPerRequest} days/request`);
  if (type.countsCalendarDays) rules.push('calendar days');
  if (type.documentRequired) rules.push('document required (web/mobile only)');
  if (type.descriptionRequired) rules.push('description required');
  if (type.birthdayLeave) rules.push('birthday leave');
  if (!type.paid) rules.push('unpaid');
  return rules;
}

function leaveTable(leaves: LeaveSummary[]): string {
  return markdownTable(
    ['Id', 'Type', 'Dates', 'Days', 'Status'],
    leaves.map(leave => [
      `\`${leave.id}\``,
      leave.leaveTypeName,
      formatDateRange(leave.start, leave.end),
      leave.workingDays,
      escapeCell(leave.status),
    ]),
  );
}

/** What happened to a new leave, from its status: approval chains can approve it on the spot. */
export function createdLeaveMessage(leave: { status?: string } | null | undefined): string {
  if (!leave) {
    return 'Teamso accepted the leave request, but it is not visible in your leave list yet. '
      + 'Check it later with `list_my_leaves`.';
  }
  switch (leave.status) {
    case 'approved':
    case 'completed':
      return 'The leave request was created and approved right away (no approval step applies to it).';
    case 'awaiting_document':
      return 'The leave request was created and waits for its document; upload it in Teamso to start the approval.';
    case 'rejected':
      return 'The leave request was created but rejected by an automatic rule; see the request in Teamso.';
    default:
      return 'The leave request was created and sent for approval.';
  }
}
