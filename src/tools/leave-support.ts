import { TeamsoApiError, type TeamsoClient } from '../client.js';
import type {
  TeamsoLeave,
  TeamsoLeaveListParams,
  TeamsoLeavePolicyAssignment,
  TeamsoLeaveTypeBalance,
  TeamsoUser,
  TeamsoWorkingDays,
} from '../types.js';
import {
  DEFAULT_WORKDAY_END,
  DEFAULT_WORKDAY_START,
  formatWallClock,
  parseWallClock,
  toClockTime,
} from '../utils/dates.js';
import { ToolInputError } from '../utils/results.js';
import { toLeaveType, type LeaveTypeProjection } from '../utils/structured.js';

/** Machine reasons the leave endpoints return, explained for the assistant. */
const LEAVE_REASONS: Record<string, string> = {
  least_day_count: 'The request is shorter than the minimum number of days per request for this leave type.',
  most_day_count: 'The request is longer than the maximum number of days per request for this leave type.',
  limited_for_each_request: 'The request exceeds the per-request day limit of this leave type.',
  leave_available_for_dates: 'You already have leave on some of these dates.',
  balance_cannot_go_negative: 'Your remaining balance for this leave type is not enough.',
  limited_overdrawn: 'The request exceeds the overdraft allowed for this leave type.',
  waiting_period: 'You are still in the waiting period for this leave type.',
  BIRTHDAY_NOT_DEFINED: 'Your birthday is not recorded in Teamso, so birthday leave cannot be used.',
  BIRTHDAY_LEAVE_DATE_OUT_OF_RANGE: 'Birthday leave must fall within the allowed range around your birthday.',
  BIRTHDAY_LEAVE_MAX_ONE_DAY: 'Birthday leave can be at most one day.',
  BIRTHDAY_LEAVE_BALANCE_ZERO: 'You have no birthday leave left.',
  LEAVE_TYPE_GENDER_NOT_ELIGIBLE: 'This leave type is not available for you.',
  DESCRIPTION_REQUIRED: 'This leave type requires a description.',
};

export function explainLeaveReason(reason: string): string {
  const text = LEAVE_REASONS[reason];
  return text ? `${text} (\`${reason}\`)` : reason;
}

export interface LeavePolicyContext {
  assignment: TeamsoLeavePolicyAssignment;
  balances: TeamsoLeaveTypeBalance[];
}

/** The caller's active leave policy and the leave types (with balances) it allows. */
export async function loadLeavePolicy(client: TeamsoClient, signal?: AbortSignal): Promise<LeavePolicyContext> {
  const policies = await client.listLeavePolicies(signal);
  const assignment = policies.find(policy => policy.activated) ?? policies[0];
  if (!assignment) {
    throw new ToolInputError('No leave policy is assigned to you in Teamso, so you cannot request leave yet. '
      + 'Ask your HR administrator to assign one.');
  }
  const balances = await client.getLeavePolicyBalances(assignment.leavePolicyUserId, signal);
  return { assignment, balances };
}

export function findLeaveType(context: LeavePolicyContext, leaveTypeId: string): TeamsoLeaveTypeBalance {
  const balance = context.balances.find(item => item.leaveTypeRequestModel?.id === leaveTypeId);
  if (!balance) {
    const available = context.balances
      .map(item => `\`${item.leaveTypeRequestModel.id}\` (${item.leaveTypeRequestModel.name ?? 'unnamed'})`)
      .join(', ');
    throw new ToolInputError(`Leave type \`${leaveTypeId}\` is not in your leave policy. `
      + `Available types: ${available || 'none'}. Call \`list_leave_types\` to choose one.`);
  }
  return balance;
}

/** Shift start/end of the caller's working-day calendar, falling back to 09:00-18:00. */
export function shiftWindow(workingDays: TeamsoWorkingDays | undefined): { start: string; end: string } {
  const details = workingDays?.workingDaysDetailRequestModels ?? [];
  const day = details.find(detail => detail.visible !== false && detail.shiftStart && detail.shiftEnd);
  return {
    start: toClockTime(day?.shiftStart) ?? DEFAULT_WORKDAY_START,
    end: toClockTime(day?.shiftEnd) ?? DEFAULT_WORKDAY_END,
  };
}

export interface PreparedLeaveRequest {
  me: TeamsoUser;
  context: LeavePolicyContext;
  balance: TeamsoLeaveTypeBalance;
  leaveType: LeaveTypeProjection;
  /** `yyyy-MM-dd HH:mm`. */
  startDate: string;
  /** `yyyy-MM-dd HH:mm`. */
  endDate: string;
  workingDays: number;
  returnToWorkDate?: string;
  /** Reasons Teamso would refuse the request; empty when it can be created. */
  problems: string[];
}

/**
 * Everything the web app checks before creating a leave request: resolves the
 * leave type in the caller's policy, applies the shift times, lets Teamso
 * count the working days, then runs Teamso's own pre-check.
 */
export async function prepareLeaveRequest(
  client: TeamsoClient,
  input: { leaveTypeId: string; start: string; end: string },
  signal?: AbortSignal,
): Promise<PreparedLeaveRequest> {
  const start = parseWallClock(input.start, 'start');
  const end = parseWallClock(input.end, 'end');

  const [me, context, workingDays, holidays] = await Promise.all([
    client.getMe(signal),
    loadLeavePolicy(client, signal),
    client.getMyWorkingDays(signal),
    client.getMyPublicHolidays(signal),
  ]);

  const balance = findLeaveType(context, input.leaveTypeId);
  const leaveType = toLeaveType(balance);

  // Calendar-day types ignore times; the web app sends 00:00 for both ends.
  const shift = shiftWindow(workingDays);
  const startDate = formatWallClock(start.date, leaveType.countsCalendarDays ? '00:00' : start.time ?? shift.start);
  const endDate = formatWallClock(end.date, leaveType.countsCalendarDays ? '00:00' : end.time ?? shift.end);
  if (endDate < startDate) {
    throw new ToolInputError(`The leave ends (${endDate}) before it starts (${startDate}).`);
  }

  let calculation;
  try {
    calculation = await client.calculateLeaveDays({
      workingDaysId: workingDays.id,
      publicHolidayId: holidays.id,
      leaveTypeId: leaveType.id,
      startDate,
      endDate,
    }, signal);
  } catch (error) {
    throw explainDayLimitError(error, leaveType);
  }

  const workingDayCount = Number(calculation?.totalWorkingDays ?? 0);
  const problems: string[] = [];
  if (!(workingDayCount > 0)) {
    problems.push('The selected dates contain no working days.');
  }
  if (leaveType.documentRequired) {
    problems.push('This leave type requires a supporting document, which can only be uploaded in the '
      + 'Teamso web or mobile app. Create this request there.');
  }

  if (workingDayCount > 0) {
    try {
      const check = await client.checkLeaveRequest({
        leaveTypeId: leaveType.id,
        addedDay: workingDayCount,
        startDate,
        endDate,
        leavePolicyUserId: context.assignment.leavePolicyUserId,
        userId: me.id,
      }, signal);
      for (const reason of check.allUserError ?? []) problems.push(explainLeaveReason(String(reason)));
      for (const entry of check.singleUserError ?? []) {
        for (const reason of entry.title ?? []) problems.push(explainLeaveReason(reason));
      }
    } catch (error) {
      if (error instanceof TeamsoApiError && error.status === 401) throw error;
      problems.push(`Teamso's pre-check could not run: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    me,
    context,
    balance,
    leaveType,
    startDate,
    endDate,
    workingDays: workingDayCount,
    returnToWorkDate: calculation?.returnToWorkDate ?? undefined,
    problems: [...new Set(problems)],
  };
}

function explainDayLimitError(error: unknown, leaveType: LeaveTypeProjection): unknown {
  if (!(error instanceof TeamsoApiError) || error.messageCode !== 'GET_ERROR') return error;
  const reason = typeof error.result === 'string' ? error.result : undefined;
  switch (reason) {
    case 'least_day_count':
      return new ToolInputError(`"${leaveType.name}" needs at least ${leaveType.minDaysPerRequest ?? 'more'} `
        + 'working days per request. Choose a longer range.');
    case 'most_day_count':
      return new ToolInputError(`"${leaveType.name}" allows at most ${leaveType.maxDaysPerRequest ?? 'fewer'} `
        + 'working days per request. Choose a shorter range or split the request.');
    case 'limited_for_each_request':
      return new ToolInputError(`"${leaveType.name}" allows at most ${leaveType.dayLimit ?? 'fewer'} `
        + 'days per request. Choose a shorter range.');
    default:
      return new ToolInputError(`Teamso could not count the working days for these dates${reason ? ` (${reason})` : ''}.`);
  }
}

export interface LeaveScanOptions {
  /** Stop after this many matching leaves. */
  limit: number;
  pageSize?: number;
  maxPages?: number;
}

export interface LeaveScanResult {
  leaves: TeamsoLeave[];
  /** True when more matching leaves may exist beyond what was collected. */
  truncated: boolean;
}

/**
 * Pages through the leave list (which also contains subordinates' and
 * approval-queue leaves) and keeps the ones `predicate` accepts.
 */
export async function scanLeaves(
  client: TeamsoClient,
  params: TeamsoLeaveListParams,
  predicate: (leave: TeamsoLeave) => boolean,
  options: LeaveScanOptions,
  signal?: AbortSignal,
): Promise<LeaveScanResult> {
  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages ?? 10;
  const leaves: TeamsoLeave[] = [];

  for (let page = 0; page < maxPages; page++) {
    const result = await client.listLeaves({ ...params, page, size: pageSize }, signal);
    const items = result?.items ?? [];
    for (const leave of items) {
      if (!predicate(leave)) continue;
      if (leaves.length === options.limit) return { leaves, truncated: true };
      leaves.push(leave);
    }
    const hasNext = result?.pagination?.hasNext ?? items.length === pageSize;
    if (!hasNext) return { leaves, truncated: false };
  }
  return { leaves, truncated: true };
}

export function leaveTypeIdOf(leave: TeamsoLeave): string | undefined {
  return leave.leaveTypeRequestModel?.id ?? leave.leaveTypeId;
}

/** Owner of a leave: the list endpoints fill `user` and leave the flat `userId` null. */
export function leaveOwnerId(leave: TeamsoLeave): string | undefined {
  return leave.user?.id ?? leave.userId ?? undefined;
}
