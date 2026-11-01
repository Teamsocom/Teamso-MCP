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
  leave_type_id: idSchema('Leave type id from `list_leave_types`.'),
  start: leaveDateSchema('start'),
  end: leaveDateSchema('end'),
};

export function registerListLeaveTypes(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_leave_types',
    {
      title: 'List the leave types I can request',
      description: 'List the leave types in the caller\'s leave policy with the remaining balance '
        + '(`remainingDays`) and the rules of each type (per-request limits, document or '
        + 'description requirements). Use the `id` as `leave_type_id` in the other leave tools.',
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
      description: 'Count the working days a leave request would use (weekends, holidays and the '
        + 'caller\'s shift are applied by Teamso), show the return-to-work date and run Teamso\'s '
        + 'pre-check. Call it before `request_leave_otp` and confirm the numbers with the user. '
        + 'Dates are Turkey local time.',
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
        + 'create or cancel a leave request. The code is valid for 3 minutes, a new code invalidates '
        + 'the previous one, and each SMS uses company digital credit, so only call it once the user '
        + 'has confirmed the request. Then ask the user for the code.',
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
      description: 'Create a leave request for the caller and send it into the approval chain. Requires '
        + 'the SMS code from `request_leave_otp`. Teamso recounts the working days and runs its '
        + 'pre-check before the code is used. Only call this after the user confirmed the type, '
        + 'dates and day count (see `calculate_leave_days`).',
      inputSchema: {
        ...leaveRequestInput,
        description: z.string().trim().max(1000).optional()
          .describe('Reason or note for the approver. Required by some leave types (`descriptionRequired`).'),
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

export function registerCancelLeaveRequest(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'cancel_leave_request',
    {
      title: 'Cancel my leave request',
      description: 'Cancel (delete) one of the caller\'s own leave requests. This cannot be undone. '
        + 'Requires the SMS code from `request_leave_otp` and the `LEAVE_DELETE` permission. '
        + 'Confirm the leave with the user first (`list_my_leaves`).',
      inputSchema: {
        leave_id: idSchema('Leave request id from `list_my_leaves`.'),
        otp_code: otpCodeSchema,
      },
      outputSchema: leaveCancelledOutputSchema,
      annotations: DESTRUCTIVE_WRITE,
    },
    async ({ leave_id, otp_code }, extra) => {
      try {
        const me = await client.getMe(extra.signal);
        const { leaves } = await scanLeaves(
          client,
          {},
          leave => leave.id === leave_id && leaveOwnerId(leave) === me.id,
          { limit: 1 },
          extra.signal,
        );
        const target = leaves[0];
        if (!target) {
          return errorResult(`Leave request \`${leave_id}\` is not one of your leave requests. `
            + 'Find the id with `list_my_leaves`. Use `approve_or_reject_leave` for leaves you approve.');
        }

        await client.verifyOtp(otp_code, extra.signal);
        const response = await client.deleteLeave(leave_id, extra.signal);
        const leave = toLeaveSummary(target);
        const closedPayrollPeriods = closedPayrollPeriodsOf(response.result);
        const message = closedPayrollPeriods.length
          ? `The leave request was cancelled. It overlapped closed payroll periods (${closedPayrollPeriods.join(', ')}); `
            + 'tell HR so payroll can be corrected.'
          : 'The leave request was cancelled.';
        return toolResult(
          `## Leave request cancelled\n\n- **Type:** ${leave.leaveTypeName ?? '-'}\n`
            + `- **Dates:** ${formatDateRange(leave.start, leave.end)}\n\n${message}`,
          { cancelled: true, leave, closedPayrollPeriods, message },
        );
      } catch (error) {
        return apiErrorResult(error, {
          ...OTP_HINTS,
          forbidden: 'Cancelling a leave request needs the `LEAVE_DELETE` permission.',
          notFound: 'Teamso could not find that leave request.',
        });
      }
    },
  );
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
