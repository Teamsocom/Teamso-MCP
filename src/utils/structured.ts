import type { z } from 'zod';
import type {
  HelpArticle,
  TeamsoAnnouncement,
  TeamsoAuthorizedEmployee,
  TeamsoGoal,
  TeamsoLeave,
  TeamsoLeavePolicyAssignment,
  TeamsoLeaveTypeBalance,
  TeamsoPayslip,
  TeamsoPerformancePeriod,
  TeamsoUser,
  TeamsoUserListItem,
  TeamsoUserSummary,
  TeamsoUserSummaryRef,
} from '../types.js';
import type {
  employeeSummarySchema,
  goalSchema,
  helpArticleSummarySchema,
  leaveSummarySchema,
  leaveTypeSchema,
  meOutputSchema,
  payslipSchema,
  pendingApprovalSchema,
  performancePeriodSchema,
} from '../tools/schemas.js';
import { toDisplayDateTime, toIsoDay } from './dates.js';
import { htmlToText } from './text.js';

/**
 * Projections from Teamso API DTOs to the tool output schemas. Every function
 * returns only schema fields, omitting empty values, so `structuredContent`
 * validates against the published JSON Schema (which forbids unknown keys).
 */

export type HelpArticleSummary = z.infer<typeof helpArticleSummarySchema>;
export type MeProjection = z.infer<typeof meOutputSchema.user>;
export type LeaveTypeProjection = z.infer<typeof leaveTypeSchema>;
export type LeaveSummary = z.infer<typeof leaveSummarySchema>;
export type PendingApproval = z.infer<typeof pendingApprovalSchema>;
export type EmployeeSummary = z.infer<typeof employeeSummarySchema>;
export type PerformancePeriodProjection = z.infer<typeof performancePeriodSchema>;
export type GoalProjection = z.infer<typeof goalSchema>;
export type PayslipProjection = z.infer<typeof payslipSchema>;

export const HELP_RESOURCE_PREFIX = 'teamso://how-to/';
export const TARGETED_PERFORMANCE_KEY = 'targetedPerformance';

/** Teamso leave `state` codes (`LeaveConstants`). */
export const LEAVE_STATUSES = {
  pending_approval: 0,
  approved: 2,
  rejected: 3,
  awaiting_usage_approval: 4,
  completed: 5,
  awaiting_document: 6,
} as const;

export type LeaveStatus = keyof typeof LEAVE_STATUSES;

export function leaveStatusName(code: number | undefined): string {
  const entry = Object.entries(LEAVE_STATUSES).find(([, value]) => value === code);
  return entry ? entry[0] : code === undefined ? 'unknown' : `unknown_${code}`;
}

// ------------------------------------------------------------------- help

export function toHelpArticleSummary(article: HelpArticle, lang: string, siteOrigin: string): HelpArticleSummary {
  return {
    id: article.id,
    title: article.title,
    summary: article.summary ?? '',
    module: article.dir,
    roles: article.roles ?? [],
    url: absoluteHelpUrl(article, siteOrigin),
    resource: `${HELP_RESOURCE_PREFIX}${article.lang ?? lang}/${article.id}`,
  };
}

export function absoluteHelpUrl(article: HelpArticle, siteOrigin: string): string {
  const url = article.url ?? '';
  if (/^https?:\/\//.test(url)) return url;
  return `${siteOrigin}${url.startsWith('/') ? '' : '/'}${url}`;
}

// ---------------------------------------------------------------- account

export function fullNameOf(person: {
  fullname?: string | null;
  fullName?: string | null;
  name?: string | null;
  secondName?: string | null;
  surname?: string | null;
} | null | undefined): string {
  if (!person) return '';
  const full = person.fullname || person.fullName;
  if (full && full.trim()) return full.trim();
  return [person.name, person.secondName, person.surname]
    .filter(part => part && part.trim())
    .join(' ')
    .trim();
}

export function personRef(person: TeamsoUserSummaryRef | null | undefined): { id: string; fullName: string } | null {
  if (!person?.id) return null;
  return { id: person.id, fullName: fullNameOf(person) || person.id };
}

export function toMe(user: TeamsoUser): MeProjection {
  const position = user.userTask?.userPosition;
  const permissions = [...new Set((user.permissions ?? [])
    .map(permission => permission.code)
    .filter((code): code is string => Boolean(code)))].sort();
  return compact({
    id: user.id,
    fullName: fullNameOf(user) || user.id,
    name: optionalString(user.name),
    surname: optionalString(user.surname),
    email: optionalString(user.email),
    personnelId: optionalString(user.personnelId),
    company: compact({
      id: optionalString(user.companyId),
      name: optionalString(user.companyName),
    }),
    department: optionalString(position?.department?.name),
    position: optionalString(position?.name),
    branch: optionalString(user.branchName?.name),
    manager: personRef(user.userManager),
    roles: (user.roles ?? []).map(role => role.name).filter((name): name is string => Boolean(name)),
    permissions,
    payrollManager: user.payrollManager === true,
  }) as MeProjection;
}

// ------------------------------------------------------------------ leave

export function toLeavePolicy(assignment: TeamsoLeavePolicyAssignment) {
  return compact({
    leavePolicyUserId: assignment.leavePolicyUserId,
    id: optionalString(assignment.leavePolicy?.id),
    name: optionalString(assignment.leavePolicy?.name),
  }) as { leavePolicyUserId: string; id?: string; name?: string };
}

export function toLeaveType(balance: TeamsoLeaveTypeBalance): LeaveTypeProjection {
  const type = balance.leaveTypeRequestModel;
  return compact({
    id: type.id,
    name: type.name || type.id,
    remainingDays: roundDays(balance.right ?? 0),
    isDefault: type.primary === true,
    paid: type.paid === true,
    limitation: optionalString(type.limitation),
    dayLimit: typeof type.dayLimit === 'number' && type.dayLimit > 0 ? type.dayLimit : undefined,
    minDaysPerRequest: optionalNumber(type.leastDayCount),
    maxDaysPerRequest: optionalNumber(type.mostDayCount),
    documentRequired: type.documentRequired === true,
    descriptionRequired: type.descriptionRequired === true,
    birthdayLeave: type.birthdayLeave === true,
    countsCalendarDays: type.overriddenHolidays === true,
  }) as LeaveTypeProjection;
}

export function toLeaveSummary(leave: TeamsoLeave): LeaveSummary {
  return compact({
    id: leave.id,
    leaveTypeId: optionalString(leave.leaveTypeRequestModel?.id ?? leave.leaveTypeId),
    leaveTypeName: optionalString(leave.leaveTypeRequestModel?.name),
    start: optionalString(leave.startDate),
    end: optionalString(leave.endDate),
    workingDays: typeof leave.totalLeaveDay === 'number' ? roundDays(leave.totalLeaveDay) : undefined,
    status: leaveStatusName(leave.state),
    statusCode: leave.state,
    description: optionalString(leave.description),
    answer: optionalString(leave.answer),
    createdAt: toDisplayDateTime(leave.createdAt ?? undefined),
  }) as LeaveSummary;
}

export function toPendingApproval(leave: TeamsoLeave): PendingApproval {
  return compact({
    leaveId: leave.id,
    requester: leave.user?.id
      ? personRef(leave.user)
      : leave.userId ? { id: leave.userId, fullName: leave.userId } : null,
    leaveTypeName: optionalString(leave.leaveTypeRequestModel?.name),
    start: optionalString(leave.startDate),
    end: optionalString(leave.endDate),
    workingDays: typeof leave.totalLeaveDay === 'number' ? roundDays(leave.totalLeaveDay) : undefined,
    description: optionalString(leave.description),
    approvalStep: leave.approvalQueue,
    createdAt: toDisplayDateTime(leave.createdAt ?? undefined),
  }) as PendingApproval;
}

/** `closedPayrollPeriods` from a leave mutation result, as display strings. */
export function closedPayrollPeriodsOf(result: unknown): string[] {
  if (!isRecord(result) || !Array.isArray(result.closedPayrollPeriods)) return [];
  return result.closedPayrollPeriods
    .map(period => {
      if (typeof period === 'string') return period;
      if (isRecord(period)) {
        const label = period.term ?? period.period ?? period.name ?? period.id;
        return typeof label === 'string' ? label : JSON.stringify(period);
      }
      return String(period);
    })
    .filter(Boolean);
}

// -------------------------------------------------------------- employees

export function toEmployeeFromList(user: TeamsoUserListItem): EmployeeSummary {
  const position = user.userTask?.userPosition;
  return compact({
    id: user.id,
    fullName: fullNameOf(user) || user.id,
    email: optionalString(user.email),
    personnelId: optionalString(user.personnelId),
    department: optionalString(position?.department?.name),
    position: optionalString(position?.name),
    branch: optionalString(user.branch?.name),
  }) as EmployeeSummary;
}

export function toEmployeeFromAuthorized(employee: TeamsoAuthorizedEmployee): EmployeeSummary {
  return compact({
    id: employee.id,
    fullName: fullNameOf(employee) || employee.id,
    email: optionalString(employee.email),
    personnelId: optionalString(employee.personnelId),
  }) as EmployeeSummary;
}

export function toEmployeeProfile(summary: TeamsoUserSummary) {
  return compact({
    id: summary.id,
    fullName: optionalString(summary.fullname) ?? summary.id,
    email: optionalString(summary.email),
    phone: optionalString(summary.tel),
    branch: optionalString(summary.branchName),
    department: optionalString(summary.departmentName),
    position: optionalString(summary.positionName),
    manager: summary.manager || summary.managerId
      ? compact({
        id: optionalString(summary.managerId),
        fullName: optionalString(summary.manager) ?? summary.managerId ?? '',
      }) as { id?: string; fullName: string }
      : null,
    workLocation: optionalString(summary.workLocation),
    workplace: optionalString(summary.workPlaceName),
  }) as {
    id: string;
    fullName: string;
    email?: string;
    phone?: string;
    branch?: string;
    department?: string;
    position?: string;
    manager: { id?: string; fullName: string } | null;
    workLocation?: string;
    workplace?: string;
  };
}

// ------------------------------------------------------------ performance

export function toPerformancePeriod(period: TeamsoPerformancePeriod): PerformancePeriodProjection {
  const scale = [...(period.evaluationScale ?? [])]
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map(item => compact({
      label: item.label ?? '',
      value: optionalNumber(item.value),
      minPercentage: optionalNumber(item.minPercentage),
      maxPercentage: optionalNumber(item.maxPercentage),
    }) as { label: string; value?: number; minPercentage?: number; maxPercentage?: number });
  return compact({
    id: period.id,
    title: period.title,
    status: optionalString(period.status),
    startDate: toIsoDay(period.startDate),
    endDate: toIsoDay(period.endDate),
    targetEntryStartDate: toIsoDay(period.targetEntryStartDate),
    targetEntryEndDate: toIsoDay(period.targetEntryEndDate),
    targetEntryOpen: period.isTargetEntryOpen === true,
    targetEntryLocked: period.isTargetEntryLocked === true,
    goalEntryBy: optionalString(period.goalEntryBy),
    successCriteriaEntryBy: optionalString(period.successCriteriaEntryBy),
    minimumGoalCount: optionalNumber(period.minimumGoalCount),
    employeeCanSelectOther: period.employeeCanSelectOther === true,
    evaluationScale: scale,
  }) as PerformancePeriodProjection;
}

export function targetValueOf(goal: TeamsoGoal): number | undefined {
  if (typeof goal.targetValue === 'number') return goal.targetValue;
  const scores = goal.targetValueDefinition?.scores ?? [];
  const target = scores.find(score => score.key === TARGETED_PERFORMANCE_KEY) ?? scores[0];
  return optionalNumber(target?.value);
}

export function toGoal(goal: TeamsoGoal): GoalProjection {
  const definition = goal.targetValueDefinition;
  return compact({
    id: goal.id,
    userId: optionalString(goal.userId),
    userFullName: optionalString(goal.userFullName),
    name: goal.name ?? '',
    description: optionalString(goal.description),
    type: optionalString(goal.type),
    period: optionalString(goal.periodName),
    status: goal.status ?? 'UNKNOWN',
    weight: optionalNumber(goal.weight),
    scaleCriterion: optionalString(definition?.scaleCriterion),
    currency: optionalString(definition?.currency),
    otherText: optionalString(definition?.otherText),
    targetValue: targetValueOf(goal),
    actualValue: optionalNumber(goal.actualValue),
    actualText: optionalString(goal.actualText),
    managerActualValue: optionalNumber(goal.managerActualValue),
    managerActualText: optionalString(goal.managerActualText),
    achievementPercentage: optionalNumber(goal.achievementPercentage),
    score: optionalNumber(goal.score),
    canApproveGoal: goal.canApproveGoal === true,
    canReviseGoal: goal.canReviseGoal === true,
    canEnterActualValue: goal.canEnterActualValue === true,
    canApproveEvaluation: goal.canApprove === true,
  }) as GoalProjection;
}

// ---------------------------------------------------------- communication

export function toAnnouncement(announcement: TeamsoAnnouncement) {
  return compact({
    id: announcement.id,
    type: optionalString(announcement.announcementType),
    text: htmlToText(announcement.announcement),
    date: optionalString(announcement.date),
    sharedBy: optionalString(fullNameOf(announcement.sharedUser)),
    coverPhotoUrl: optionalString(announcement.coverPhotoUrl),
  }) as {
    id: string;
    type?: string;
    text: string;
    date?: string;
    sharedBy?: string;
    coverPhotoUrl?: string;
  };
}

// ---------------------------------------------------------------- payroll

export function toPayslip(payslip: TeamsoPayslip): PayslipProjection {
  return compact({
    id: payslip.id,
    term: optionalString(payslip.term),
    status: optionalString(payslip.status),
    sentToEmployeeAt: optionalString(payslip.sentToEmployeeAt),
    createdAt: optionalString(payslip.createdAt),
    canAnswer: payslip.canAnswer === true,
    userAnswer: optionalString(payslip.userAnswer),
    managerAnswer: optionalString(payslip.managerAnswer),
  }) as PayslipProjection;
}

// ---------------------------------------------------------------- helpers

export function roundDays(value: number): number {
  return Math.round(value * 100) / 100;
}

export function optionalString(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function optionalNumber(value: number | string | null | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** Drops `undefined` fields so optional schema keys are omitted, not `undefined`. */
export function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
