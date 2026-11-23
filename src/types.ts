/**
 * Shapes of the Teamso REST API responses this package reads. Only the fields
 * the tools use are declared; the API returns more. Field names follow the
 * Java DTOs exactly (Lombok `boolean isX` fields serialize as `x`).
 */

/** Standard Teamso response envelope (`BaseResponseVO`). Null fields are omitted. */
export interface TeamsoEnvelope<T = unknown> {
  /** 1 = success, 0 = failure. Many failures still arrive with `code: 1`. */
  code?: number;
  message?: string;
  message_code?: string;
  result?: T;
  errors?: Array<string | { message?: string; [key: string]: unknown }>;
}

export interface TeamsoCredentials {
  /** Personal access token, `tms_pat_...` (or a hosted-server sign-in token, `tms_at_...`). */
  accessToken: string;
  /** API base URL including the context path, e.g. `https://api.teamso.com/v1`. */
  baseUrl?: string;
}

export interface TeamsoRole {
  id?: string;
  name?: string;
  description?: string;
}

export interface TeamsoPermission {
  id?: string;
  moduleId?: string;
  code?: string;
  group?: string;
}

export interface TeamsoNamedEntity {
  id?: string;
  name?: string;
}

export interface TeamsoUserPosition {
  id?: string;
  name?: string;
  department?: TeamsoNamedEntity | null;
}

export interface TeamsoUserTask {
  userPosition?: TeamsoUserPosition | null;
}

export interface TeamsoUserSummaryRef {
  id?: string;
  name?: string;
  surname?: string;
  fullname?: string;
  userTask?: TeamsoUserTask | null;
}

/** `GET /user` → `UserResponseDTO`. */
export interface TeamsoUser {
  id: string;
  personnelId?: string;
  username?: string;
  name?: string;
  secondName?: string;
  surname?: string;
  fullname?: string;
  email?: string;
  tel?: string;
  companyId?: string;
  companyName?: string;
  departmentId?: string;
  locales?: string;
  active?: boolean;
  roles?: TeamsoRole[];
  permissions?: TeamsoPermission[];
  userTask?: TeamsoUserTask | null;
  userManager?: TeamsoUserSummaryRef | null;
  branchName?: TeamsoNamedEntity | null;
  payrollManager?: boolean;
}

/** `GET /leave-policy/getListAllLeavePolicyForUser` item. */
export interface TeamsoLeavePolicyAssignment {
  activated: boolean;
  leavePolicyUserId: string;
  leavePolicy?: {
    id?: string;
    name?: string;
    description?: string;
  } | null;
}

/** `LeaveTypeRequestModel` as returned inside the policy detail. */
export interface TeamsoLeaveType {
  id: string;
  name?: string;
  description?: string;
  limitation?: string | null;
  dayLimit?: number;
  leastDayCount?: string | null;
  mostDayCount?: string | null;
  paid?: boolean;
  primary?: boolean;
  documentRequired?: boolean;
  descriptionRequired?: boolean;
  birthdayLeave?: boolean;
  overriddenHolidays?: boolean;
  genderEligibility?: string | null;
}

/** `GET /leave-policy/getDetailLeavePolicyForUser/{id}` item. */
export interface TeamsoLeaveTypeBalance {
  leaveTypeRequestModel: TeamsoLeaveType;
  /** Remaining balance in days. */
  right: number;
}

export interface TeamsoWorkingDaysDetail {
  dayName?: string;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  visible?: boolean;
}

/** `GET /working-days/getWorkingDaysByMe`. */
export interface TeamsoWorkingDays {
  id: string;
  name?: string;
  workingDaysDetailRequestModels?: TeamsoWorkingDaysDetail[];
}

/** `GET /public-holiday/getPublicHolidayByMe`. */
export interface TeamsoPublicHolidayCalendar {
  id: string;
  name?: string;
}

/** `GET /leave/dayCalculator/...`. */
export interface TeamsoDayCalculation {
  totalWorkingDays: number;
  /** `yyyy-MM-dd HH:mm`, Turkey wall clock. */
  returnToWorkDate?: string | null;
}

/** `POST /leave/controlToAddLeave`. */
export interface TeamsoLeaveControl {
  allUserError?: unknown[];
  singleUserError?: Array<{
    userResponseDto?: { id?: string } | null;
    title?: string[];
  }>;
}

/** Body of `POST /leave` (`UserLeaveRequestVO`). */
export interface TeamsoLeaveCreateRequest {
  leaveType: string;
  personnelId: string[];
  leavePolicyUserId: string;
  startDate: string;
  endDate: string;
  returnToWorkDate?: string;
  totalLeaveDay: number;
  description?: string;
  documentAttached: boolean;
  approveAndContinue: false;
}

/** `GET /leave/listAllLeavesAdvancedPagination` item (`LeaveResponseModel`). */
export interface TeamsoLeave {
  id: string;
  userId?: string;
  leaveTypeId?: string;
  leaveTypeRequestModel?: TeamsoLeaveType | null;
  totalLeaveDay?: number;
  description?: string | null;
  answer?: string | null;
  state?: number;
  approvalQueue?: number;
  startDate?: string | null;
  endDate?: string | null;
  canApprove?: boolean;
  user?: TeamsoUserSummaryRef | null;
  createdAt?: string | number | null;
}

export interface TeamsoPagination {
  currentPage?: number;
  pageSize?: number;
  totalRecords?: number;
  totalElements?: number;
  totalPages?: number;
  hasNext?: boolean;
}

export interface TeamsoLeavePage {
  items?: TeamsoLeave[];
  pagination?: TeamsoPagination;
}

export interface TeamsoLeaveListParams {
  page?: number;
  size?: number;
  searchKey?: string;
  searchValue?: string;
  /** ISO `yyyy-MM-dd`. */
  rangeStart?: string;
  /** ISO `yyyy-MM-dd`. */
  rangeEnd?: string;
}

/** `GET /dashboard/getPendingTransactionsByRequestOwner` item. */
export interface TeamsoPendingTransaction {
  id: string;
  type?: string;
  requestOwner?: TeamsoUserSummaryRef | null;
  detail?: string | null;
  /** `yyyy-MM-dd`. */
  date?: string | null;
  state?: number;
  status?: string | null;
  approvalQueue?: number;
}

/** `GET /user/list-pagination` item (`UserResponseDtoForUserList`). */
export interface TeamsoUserListItem {
  id: string;
  personnelId?: string;
  name?: string;
  surname?: string;
  fullname?: string;
  email?: string;
  active?: boolean;
  branch?: TeamsoNamedEntity | null;
  userTask?: TeamsoUserTask | null;
}

export interface TeamsoUserPage {
  items?: TeamsoUserListItem[];
  pagination?: TeamsoPagination;
}

/** `GET /authorized-employee/list` item (`EmployeeShortResponseModel`). */
export interface TeamsoAuthorizedEmployee {
  id: string;
  personnelId?: string;
  name?: string;
  surname?: string;
  fullName?: string;
  email?: string;
  active?: boolean;
}

/** `GET /user/getUserSummaryByUserId/{id}` (`UserSummaryResponseDTO`). */
export interface TeamsoUserSummary {
  id: string;
  fullname?: string;
  branchName?: string | null;
  departmentName?: string | null;
  positionName?: string | null;
  tel?: string | null;
  email?: string | null;
  manager?: string | null;
  managerId?: string | null;
  workLocation?: string | null;
  workPlaceName?: string | null;
}

export interface TeamsoEvaluationScaleItem {
  label?: string;
  value?: number;
  minPercentage?: number;
  maxPercentage?: number;
  displayOrder?: number;
}

/** `GET /performance-settings` → `periods[]` (`PerformancePeriodResponseDto`). */
export interface TeamsoPerformancePeriod {
  id: string;
  title: string;
  startDate?: string | number | null;
  endDate?: string | number | null;
  targetEntryStartDate?: string | number | null;
  targetEntryEndDate?: string | number | null;
  goalEntryBy?: string | null;
  successCriteriaEntryBy?: string | null;
  minimumGoalCount?: number | null;
  employeeCanSelectOther?: boolean | null;
  evaluationScale?: TeamsoEvaluationScaleItem[] | null;
  status?: string | null;
  isTargetEntryOpen?: boolean | null;
  isTargetEntryLocked?: boolean | null;
}

export interface TeamsoPerformanceSettings {
  id?: string;
  periods?: TeamsoPerformancePeriod[];
}

export interface TeamsoGoalScore {
  text?: string;
  value?: number | string | null;
  key?: string | null;
}

export interface TeamsoTargetValueDefinition {
  scaleCriterion?: string;
  currency?: string | null;
  currencyValue?: string | null;
  otherText?: string | null;
  scores?: TeamsoGoalScore[] | null;
}

/** `UserGoalResponseDto`. */
export interface TeamsoGoal {
  id: string;
  userId?: string;
  userFullName?: string | null;
  name?: string;
  description?: string | null;
  type?: string | null;
  weight?: number | null;
  targetValueDefinition?: TeamsoTargetValueDefinition | null;
  periodName?: string | null;
  status?: string;
  approvalQueue?: number | null;
  canApprove?: boolean | null;
  canApproveGoal?: boolean | null;
  canEnterActualValue?: boolean | null;
  canReviseGoal?: boolean | null;
  actualValue?: number | null;
  actualText?: string | null;
  managerActualValue?: number | null;
  managerActualText?: string | null;
  targetValue?: number | null;
  achievementPercentage?: number | null;
  /** Legacy column; the API leaves it null. The evaluation result is `scoreValue` / `weightedScore`. */
  score?: number | null;
  scoreValue?: number | null;
  weightedScore?: number | null;
  userFinalScore?: number | null;
  userFinalScoreText?: string | null;
}

export interface TeamsoGoalPage {
  goals?: TeamsoGoal[];
  canAddGoal?: boolean;
  pagination?: TeamsoPagination;
}

/** One progress check-in of a goal (TMS-5065), newest first in {@link TeamsoGoalProgressCard.entries}. */
export interface TeamsoGoalProgressEntry {
  id: string;
  value?: number | null;
  percent?: number | null;
  status?: string | null;
  comment?: string | null;
  fileName?: string | null;
  hasFile?: boolean;
  createdAt?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  byOwner?: boolean;
}

/** `GET` and `POST /user-goal-progress/goal/{goalId}` (TMS-5065): the goal's progress card. */
export interface TeamsoGoalProgressCard {
  goalId: string;
  goalName?: string | null;
  userId?: string | null;
  periodName?: string | null;
  scaleCriterion?: string | null;
  currency?: string | null;
  otherText?: string | null;
  isOther?: boolean;
  targetValue?: number | null;
  open?: boolean;
  canAddProgress?: boolean;
  /** `PERIOD_NOT_ACTIVE` or `GOAL_NOT_OPEN` when the goal takes no check-in now. */
  closedReason?: string | null;
  elapsedPercent?: number | null;
  lastProgressValue?: number | null;
  lastProgressPercent?: number | null;
  lastProgressStatus?: string | null;
  lastProgressAt?: string | null;
  entries?: TeamsoGoalProgressEntry[];
}

/** Body of `POST /user-goal-progress/goal/{goalId}`. */
export interface TeamsoGoalProgressRequest {
  value?: number;
  percent?: number;
  status: string;
  comment?: string;
  withFile?: boolean;
}

/** Body of `POST /user-goal` and `PUT /user-goal/revise-and-approve/{id}` (`UserGoalRequestVo`). */
export interface TeamsoGoalRequest {
  userId?: string;
  name?: string;
  description?: string;
  type?: string;
  goalGroupId?: string;
  weight?: number;
  targetValueDefinition?: TeamsoTargetValueDefinition;
  /** `yyyy-MM-dd`. */
  periodStartDate?: string;
  /** `yyyy-MM-dd`. */
  periodEndDate?: string;
  periodName?: string;
}

export interface TeamsoEvaluationApproval {
  goals?: TeamsoGoal[];
  newStatus?: string;
  finalScore?: number | null;
  finalScoreText?: string | null;
}

/** `GET /dashboard/getAnnouncements` item. */
export interface TeamsoAnnouncement {
  id: string;
  announcementType?: string;
  announcement?: string | null;
  coverPhotoUrl?: string | null;
  sharedUser?: TeamsoUserSummaryRef | null;
  relatingTo?: string[] | null;
  /** `yyyy-MM-dd`. */
  date?: string | null;
}

export interface TeamsoAnnouncementFeed {
  canAdd?: boolean;
  announcementListResponseDto?: TeamsoAnnouncement[];
}

/** `GET /payroll/getPayrollsByMe-pagination` → `content[]` (`PayrollMultiResponseModel`). */
export interface TeamsoPayslip {
  id: string;
  /** `yyyy-MM`. */
  term?: string | null;
  createdAt?: string | null;
  status?: string | null;
  canAnswer?: boolean;
  sentToEmployeeAt?: string | null;
  userAnswer?: string | null;
  managerAnswer?: string | null;
  fileName?: string | null;
}

export interface TeamsoPayslipPage {
  content?: TeamsoPayslip[];
  pagination?: TeamsoPagination;
}

export interface TeamsoPayslipListParams {
  page?: number;
  size?: number;
  searchKey?: 'term' | 'status';
  searchValue?: string;
}

/** One line of the interactive payslip (TMS-5021). */
export interface TeamsoPayslipViewLine {
  key?: string;
  code?: string | null;
  /** EARNING, TOTAL, DEDUCTION, ADDITION or NET. */
  kind?: string;
  label?: string | null;
  amount?: number | null;
  explainKey?: string | null;
  text?: string | null;
  previous?: number | null;
  change?: number | null;
  /** SAME, UP, DOWN, NEW, ENDED; null without an earlier payslip. */
  status?: string | null;
  /** DAYS_WORKED, SALARY, OVERTIME, NEW_ITEM, ENDED_ITEM, AMOUNT_CHANGED, TAX_BRACKET, ... */
  reason?: string | null;
  reasonText?: string | null;
}

/** `GET /payroll/me/payslip-view` and `GET /payroll/payslip-view/{id}` (TMS-5021). */
export interface TeamsoPayslipView {
  payrollId?: string;
  /** `yyyy-MM`. */
  period?: string;
  periodName?: string | null;
  previousPeriod?: string | null;
  previousPeriodName?: string | null;
  firstPayroll?: boolean;
  lines?: TeamsoPayslipViewLine[];
  net?: {
    after?: number | null;
    before?: number | null;
    delta?: number | null;
    reasonsAvailable?: boolean;
    reasons?: Array<{ code?: string; category?: string; label?: string | null; itemCode?: string | null; amount?: number | null }>;
  };
  summary?: string | null;
  yearToDate?: {
    year?: number;
    months?: string[];
    gross?: number | null;
    net?: number | null;
    incomeTax?: number | null;
    stampTax?: number | null;
    sgkEmployee?: number | null;
    unemploymentEmployee?: number | null;
    sgkTotal?: number | null;
  } | null;
  taxBracket?: {
    band?: number;
    rate?: number | null;
    cumulativeBase?: number | null;
    limit?: number | null;
    remaining?: number | null;
    nextBand?: number | null;
    nextRate?: number | null;
    nextPeriod?: string | null;
    crossesNextMonth?: boolean;
    /** crossing, safe, top or yearEnd. */
    state?: string;
    text?: string | null;
  } | null;
}

/** `GET /payroll/download-file/{id}`: raw PDF bytes. */
export interface TeamsoFileDownload {
  data: Uint8Array;
  contentType: string;
  fileName?: string;
}

/** Public how-to bundle (`<site>/how-to/bundle.<lang>.json`). */
export interface HelpArticle {
  id: string;
  lang?: string;
  module?: string;
  dir: string;
  title: string;
  summary?: string;
  roles?: string[];
  permissions?: string[];
  routes?: string[];
  related?: string[];
  order?: number;
  verified?: string;
  url?: string;
  body?: string;
}

export interface HelpModule {
  dir: string;
  code?: string;
  title: string;
  description?: string;
  articles: string[];
}

export interface HelpBundle {
  lang: string;
  helpCenter?: string;
  modules: HelpModule[];
  articles: HelpArticle[];
}

export type HelpLanguage = 'tr' | 'en';

// ----------------------------------------------------------------- badges

/** A badge the caller may give (`BadgeOptionDto`, `GET /badge-award/awardable`). */
export interface TeamsoBadgeOption {
  id: string;
  code?: string | null;
  name: string;
  description?: string | null;
  category?: string | null;
  tier?: string | null;
  /** Only when the company shows points. */
  points?: number | null;
  awardMode?: string | null;
  givers?: string[] | null;
  requiresApproval?: boolean;
  requireMessage?: boolean;
  defaultVisibility?: string | null;
  maxPerRecipient?: number | null;
  cooldownDays?: number | null;
}

export interface TeamsoBadgePeerQuota {
  monthlyQuota: number;
  used: number;
  remaining: number;
  resetsOn?: string | null;
  daysUntilReset?: number;
  allowCrossDepartment?: boolean;
  departmentName?: string | null;
}

/** `GET /badge-award/awardable`: what the caller may give. */
export interface TeamsoBadgeAwardable {
  /** ADMIN, MANAGER, PEER or NONE. */
  role: string;
  canAward: boolean;
  managerCanAward?: boolean;
  teamSize?: number;
  peerEnabled?: boolean;
  peerQuota?: TeamsoBadgePeerQuota | null;
  badges?: TeamsoBadgeOption[] | null;
}

/** `POST /badge-award` body. */
export interface TeamsoBadgeAwardRequest {
  badgeId: string;
  recipientUserIds: string[];
  message?: string;
  visibility?: 'PUBLIC' | 'PRIVATE';
}

export interface TeamsoBadgeAwardRecipient {
  userId: string;
  fullName?: string | null;
  awardId?: string | null;
  /** Failure code: SELF, RECIPIENT_NOT_FOUND, RECIPIENT_INACTIVE, LIMIT_REACHED, COOLDOWN, OTHER_DEPARTMENT, ALREADY_AWARDED. */
  code?: string | null;
  limit?: number | null;
  availableOn?: string | null;
}

/** `POST /badge-award` result (`BadgeAwardResultDto`). */
export interface TeamsoBadgeAwardResult {
  badgeId: string;
  badgeName?: string | null;
  status: string;
  pendingApproval: boolean;
  source: string;
  peerQuota?: TeamsoBadgePeerQuota | null;
  awardedCount: number;
  failedCount: number;
  awarded?: TeamsoBadgeAwardRecipient[] | null;
  failed?: TeamsoBadgeAwardRecipient[] | null;
}

export interface TeamsoBadgePerson {
  id: string;
  fullName?: string | null;
}

/** One award (`BadgeAwardDto`). */
export interface TeamsoBadgeAward {
  id: string;
  badge?: TeamsoBadgeOption | null;
  recipient?: TeamsoBadgePerson | null;
  giver?: TeamsoBadgePerson | null;
  source?: string | null;
  message?: string | null;
  visibility?: string | null;
  status?: string | null;
  points?: number | null;
  createdAt?: string | null;
}

/** `GET /badge-award/my`. */
export interface TeamsoBadgeAwardPage {
  items?: TeamsoBadgeAward[] | null;
  total?: number;
  page?: number;
  size?: number;
  totalAwards?: number;
  distinctBadges?: number;
  totalPoints?: number | null;
  showPoints?: boolean;
}

// ------------------------------------------------------------- simulation

/** One assignment of the caller (`GET /simulation/assignments/mine`). */
export interface TeamsoSimulationAssignment {
  assignmentUserId: string;
  assignmentId?: string | null;
  /** SCENARIO or TRACK. */
  contentType?: string | null;
  scenarioId?: string | null;
  trackId?: string | null;
  trackItemId?: string | null;
  title?: string | null;
  /** `yyyy-MM-dd`. */
  dueDate?: string | null;
  /** NOT_STARTED, IN_PROGRESS, PASSED, FAILED, OVERDUE or CANCELLED. */
  status?: string | null;
  bestScore?: number | null;
  attempts?: number | null;
  /** 0 means unlimited. */
  maxAttempts?: number | null;
  passScore?: number | null;
  examMode?: boolean | null;
  /** TEXT, VOICE or BOTH. */
  allowedModes?: string | null;
  difficulty?: string | null;
  note?: string | null;
  overdue?: boolean | null;
}

/** One attempt (`GET /simulation/attempts/mine`, `GET /simulation/attempts`). */
export interface TeamsoSimulationAttempt {
  id: string;
  scenarioId?: string | null;
  scenarioTitle?: string | null;
  /** Only in the team list. */
  userId?: string | null;
  userName?: string | null;
  /** TEXT or VOICE. */
  mode?: string | null;
  /** EASY, MEDIUM or HARD. */
  difficulty?: string | null;
  kind?: string | null;
  /** CREATED, ACTIVE, ENDED, SCORING, SCORED, SCORING_FAILED or NOT_SCORABLE. */
  status?: string | null;
  totalScore?: number | null;
  passed?: boolean | null;
  /** ISO instant (`2026-11-02T09:15:00Z`). */
  startedAt?: string | null;
  durationSec?: number | null;
  reviewState?: string | null;
  overridden?: boolean | null;
}

export interface TeamsoSimulationAttemptPage {
  items?: TeamsoSimulationAttempt[] | null;
  total?: number;
  page?: number;
  size?: number;
}

export interface TeamsoSimulationEvidence {
  turn?: number | null;
  quote?: string | null;
}

export interface TeamsoSimulationCriterion {
  key: string;
  name?: string | null;
  skillTag?: string | null;
  weight?: number | null;
  /** 0-4. */
  level?: number | null;
  score?: number | null;
  rationale?: string | null;
  evidence?: TeamsoSimulationEvidence[] | null;
  overridden?: boolean | null;
}

/**
 * `GET /simulation/attempts/{id}/result`. `attempt.turns` (the transcript) is never passed on by the tools.
 */
export interface TeamsoSimulationAttemptResult {
  totalScore?: number | null;
  passed?: boolean | null;
  /** SUCCESS or FAIL. */
  outcome?: string | null;
  criticalFailed?: boolean | null;
  passScore?: number | null;
  criteria?: TeamsoSimulationCriterion[] | null;
  strengths?: string[] | null;
  priorities?: string[] | null;
  betterReplies?: Array<{ turn?: number | null; text?: string | null }> | null;
  nextPracticeSkill?: string | null;
  scenario?: { id?: string | null; title?: string | null } | null;
  user?: { id?: string | null; name?: string | null } | null;
  durationSec?: number | null;
  attempt?: (Partial<TeamsoSimulationAttempt> & { turns?: unknown[] | null }) | null;
}

export interface TeamsoSimulationPersona {
  name?: string | null;
  age?: number | null;
  occupation?: string | null;
  city?: string | null;
}

/** One scenario on a catalog shelf. */
export interface TeamsoSimulationCatalogItem {
  scenarioId: string;
  title?: string | null;
  description?: string | null;
  sector?: string | null;
  language?: string | null;
  direction?: string | null;
  modes?: string[] | string | null;
  difficulties?: string[] | string | null;
  estMinutes?: number | null;
  persona?: TeamsoSimulationPersona | null;
  myBestScore?: number | null;
  myAttempts?: number | null;
  assignment?: Partial<TeamsoSimulationAssignment> | null;
}

/** `GET /simulation/catalog`. */
export interface TeamsoSimulationCatalog {
  shelves?: Array<{ key: string; items?: TeamsoSimulationCatalogItem[] | null }> | null;
}

// --------------------------------------------------------- cost forecast

/**
 * Amounts arrive as JSON numbers (BigDecimal, two decimals) and timestamps as ISO instants. Every total is over the
 * employees the caller may see in the report; no employee, name or salary row is ever part of these answers.
 */
export interface TeamsoCostForecastListItem {
  id: string;
  name?: string | null;
  startPeriod?: string | null;
  endPeriod?: string | null;
  monthCount?: number | null;
  approvalStatus?: string | null;
  activeBudget?: boolean | null;
  owned?: boolean | null;
  /** `NOT_CALCULATED`, `CALCULATING`, `CURRENT` or `OUTDATED`. */
  status?: string | null;
  lastCalculatedAt?: string | null;
  /** `DONE` or `PARTIAL` (some employees could not be calculated). */
  runStatus?: string | null;
  employees?: number | null;
  limited?: boolean | null;
  amountsHidden?: boolean | null;
  totalCost?: number | string | null;
  totalCostWithExpenses?: number | string | null;
}

/** `GET /cost-forecast/mcp/studies`. */
export interface TeamsoCostForecastList {
  studies?: TeamsoCostForecastListItem[] | null;
  total?: number | null;
  returned?: number | null;
  limit?: number | null;
}

export interface TeamsoCostForecastStudyHead {
  id: string;
  name?: string | null;
  startPeriod?: string | null;
  endPeriod?: string | null;
  monthCount?: number | null;
  approvalStatus?: string | null;
  headcount?: boolean | null;
}

export interface TeamsoCostForecastRun {
  id?: string | null;
  status?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  current?: boolean | null;
  failedEmployees?: number | null;
}

/** Fields both study answers share. */
export interface TeamsoCostForecastResultHead {
  study?: TeamsoCostForecastStudyHead | null;
  status?: string | null;
  calculated?: boolean | null;
  run?: TeamsoCostForecastRun | null;
  scope?: { limited?: boolean | null; employees?: number | null } | null;
  amountsHidden?: boolean | null;
  hasExpenses?: boolean | null;
}

export type TeamsoCostForecastAmounts = Partial<Record<
  'gross' | 'net' | 'totalCost' | 'expenses' | 'totalCostWithExpenses' | 'grossSalary' | 'grossBenefits',
  number | string | null
>> & { employees?: number | null; payrolls?: number | null };

/** `GET /cost-forecast/mcp/studies/{id}/summary`. */
export interface TeamsoCostForecastSummary extends TeamsoCostForecastResultHead {
  kpis?: TeamsoCostForecastAmounts | null;
  months?: Array<TeamsoCostForecastAmounts & { period?: string | null }> | null;
  rolling?: {
    actualsThrough?: string | null;
    yearEnd?: number | string | null;
    approved?: { id?: string | null; name?: string | null; total?: number | string | null } | null;
    difference?: number | string | null;
    differencePct?: number | string | null;
  } | null;
}

/** `GET /cost-forecast/mcp/studies/{id}/breakdown`. */
export interface TeamsoCostForecastBreakdown extends TeamsoCostForecastResultHead {
  by?: string | null;
  groups?: Array<TeamsoCostForecastAmounts & { name?: string | null; share?: number | string | null }> | null;
  groupCount?: number | null;
  truncated?: boolean | null;
  totals?: TeamsoCostForecastAmounts | null;
}

// ----------------------------------------------------------- provisioning

/**
 * Preparation and return flows (`/provisioning/...`, TMS-5285). The API answers with the caller's own rights: HR of
 * the branch sees the flows of their branches, a manager the flows of their team, everyone their own tasks. Task
 * outputs, notes, the flow log, asset values, licence data and exit reasons are in some answers; the tools never
 * copy them.
 */
export interface TeamsoProvisioningFlowRow {
  id: string;
  kind?: string | null;
  pending?: boolean | null;
  name?: string | null;
  position?: string | null;
  department?: string | null;
  date?: string | null;
  daysLeft?: number | null;
  total?: number | null;
  done?: number | null;
  late?: number | null;
  urgent?: number | null;
  critical?: number | null;
  noAssignee?: number | null;
  requestMissing?: number | null;
  returnsOpen?: number | null;
  returnsLate?: boolean | null;
  missing?: string[] | null;
  status?: string | null;
  source?: string | null;
  restarted?: boolean | null;
  readiness?: string | null;
}

/** `GET /provisioning/flows`. */
export interface TeamsoProvisioningFlowList {
  rows?: TeamsoProvisioningFlowRow[] | null;
  total?: number | null;
  page?: number | null;
  size?: number | null;
  counts?: Record<string, number> | null;
  cards?: Record<string, number> | null;
  canManage?: boolean | null;
  teamOnly?: boolean | null;
  enabled?: boolean | null;
  setupDone?: boolean | null;
}

export interface TeamsoProvisioningFlowListParams {
  tab?: string;
  kind?: string;
  card?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  size?: number;
}

export interface TeamsoProvisioningPerson {
  type?: string | null;
  userId?: string | null;
  name?: string | null;
}

export interface TeamsoProvisioningFlowTask {
  id: string;
  title?: string | null;
  source?: string | null;
  category?: string | null;
  status?: string | null;
  dueDate?: string | null;
  late?: boolean | null;
  lateDays?: number | null;
  urgent?: boolean | null;
  critical?: boolean | null;
  escalated?: boolean | null;
  noAssigneeReason?: string | null;
  requestMissing?: boolean | null;
  completedAt?: string | null;
  completedByName?: string | null;
  people?: TeamsoProvisioningPerson[] | null;
  mine?: boolean | null;
}

/** `GET /provisioning/flows/{id}`: the flow row plus its tasks (and HR-only parts the tools leave out). */
export interface TeamsoProvisioningFlow extends TeamsoProvisioningFlowRow {
  managerName?: string | null;
  templateName?: string | null;
  immediate?: boolean | null;
  canManage?: boolean | null;
  hr?: boolean | null;
  tasks?: TeamsoProvisioningFlowTask[] | null;
}

export interface TeamsoProvisioningMyTask {
  id: string;
  planId?: string | null;
  kind?: string | null;
  source?: string | null;
  title?: string | null;
  itemId?: string | null;
  employeeName?: string | null;
  position?: string | null;
  date?: string | null;
  status?: string | null;
  dueDate?: string | null;
  openAt?: string | null;
  urgent?: boolean | null;
  critical?: boolean | null;
  late?: boolean | null;
  requestMissing?: boolean | null;
  claimedByName?: string | null;
  quickComplete?: boolean | null;
  completedAt?: string | null;
  group?: string | null;
}

/** `GET /provisioning/tasks/me`. */
export interface TeamsoProvisioningMyTasks {
  todo?: TeamsoProvisioningMyTask[] | null;
  upcoming?: TeamsoProvisioningMyTask[] | null;
  done?: TeamsoProvisioningMyTask[] | null;
  late?: number | null;
  enabled?: boolean | null;
}

/** What closing a task writes (`ProvisionOutputService.Values`); a new asset with a price is not offered. */
export interface TeamsoProvisioningValues {
  fields?: Record<string, string>;
  inventoryIds?: string[];
  carId?: string;
  km?: string;
  returnState?: string;
  lineOutcome?: string;
  handedTo?: string;
  overwrite?: boolean;
}

/** `POST /provisioning/preview` body. */
export interface TeamsoProvisioningPreviewRequest {
  positionId?: string;
  departmentId?: string;
  branchId?: string;
  managerId?: string;
  startDate?: string;
}

export interface TeamsoProvisioningPreviewTask {
  itemId?: string | null;
  name?: string | null;
  categoryName?: string | null;
  quantity?: number | null;
  status?: string | null;
  openAt?: string | null;
  dueDate?: string | null;
  urgent?: boolean | null;
  waitsFor?: string | null;
  assignees?: Array<{ type?: string | null; name?: string | null; count?: number | null }> | null;
  noAssigneeReason?: string | null;
  requestMissing?: boolean | null;
}

/** `POST /provisioning/preview` answer (nothing is saved). */
export interface TeamsoProvisioningPreview {
  enabled?: boolean | null;
  setupDone?: boolean | null;
  refusal?: string | null;
  tasks?: TeamsoProvisioningPreviewTask[] | null;
  excluded?: Array<{ itemId?: string | null; name?: string | null; categoryName?: string | null; reason?: string | null }> | null;
  urgentCount?: number | null;
  noAssigneeCount?: number | null;
  daysToStart?: number | null;
  startDate?: string | null;
}

// ------------------------------------------------------------- API catalog

/**
 * One row of `GET /mcp-catalog/endpoints` (and the head of `GET /mcp-catalog/endpoint`).
 * Every field is optional: the catalog is read defensively.
 */
export interface TeamsoApiEndpointItem {
  /** `"METHOD /path/{var}"`, e.g. `POST /leave`. */
  id?: string;
  method?: string;
  path?: string;
  module?: string | null;
  moduleTitle?: string | null;
  summary?: string | null;
  /** `read` | `write` | `delete` | `read_with_writes`. */
  sideEffect?: string;
  /** `always` | `conditional` | `never` (older builds: boolean). */
  smsCodeRequired?: string | boolean | null;
  fileResponse?: boolean;
  multipart?: boolean;
  /** Raw `@PreAuthorize` expression. */
  permission?: string | null;
  /** `allowed` | `conditional` | `authenticated`. */
  access?: string;
  conditional?: boolean;
}

export interface TeamsoApiEndpointPage {
  items?: TeamsoApiEndpointItem[];
  page?: number;
  size?: number;
  total?: number;
  totalPages?: number;
}

export interface TeamsoApiSmsCode {
  /** `always` | `conditional`. */
  mode?: string;
  when?: string;
  preVerify?: boolean;
  /** `1` | `perPerson` | `perItem` | `none`. */
  credits?: string;
}

export interface TeamsoApiParameter {
  name?: string;
  /** `path` | `query` | `header`. */
  in?: string;
  required?: boolean;
  schema?: Record<string, unknown>;
}

export interface TeamsoApiRequestBody {
  required?: boolean;
  validated?: boolean;
  contentType?: string;
  schema?: Record<string, unknown>;
}

/** `GET /mcp-catalog/endpoint` result. */
export interface TeamsoApiEndpointDescription extends TeamsoApiEndpointItem {
  controller?: string;
  handler?: string;
  accessReason?: string | null;
  moduleDescription?: string | null;
  summarySource?: string;
  doc?: string | null;
  webScreens?: string[];
  getSideEffectClass?: string | null;
  responseKind?: string;
  smsCode?: TeamsoApiSmsCode | null;
  parameters?: TeamsoApiParameter[];
  requestBody?: TeamsoApiRequestBody | null;
  $defs?: Record<string, unknown>;
  notes?: string[];
  related?: string[];
}

/** `GET /mcp-catalog/modules` row. */
export interface TeamsoApiModule {
  code?: string;
  title?: string | null;
  description?: string | null;
  endpointCount?: number;
  allowedCount?: number;
}

export type ApiHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ApiQueryValue = string | number | boolean | Array<string | number | boolean>;

export interface ApiUploadFile {
  /** Multipart field name. */
  field: string;
  filename: string;
  contentType: string;
  data: Uint8Array;
}

export type ApiRequestBody =
  | { kind: 'json'; value: unknown }
  | { kind: 'text'; value: string; contentType: string }
  | { kind: 'multipart'; fields: Record<string, string[]>; files: ApiUploadFile[] };

/** A request to a catalog endpoint (`TeamsoClient.callApi`). */
export interface ApiCallRequest {
  method: ApiHttpMethod;
  /** Resolved path below the API base URL, every segment already encoded (`/leave/abc`). */
  path: string;
  query?: Record<string, ApiQueryValue>;
  body?: ApiRequestBody;
  /** Send `X-Teamso-Mcp-Intent: read`: the API then refuses anything that writes. */
  readIntent?: boolean;
  /** Largest response body accepted, in bytes. */
  maxResponseBytes?: number;
}

export type ApiCallResponse =
  | {
    kind: 'json';
    status: number;
    /** True when the body is a Teamso envelope (`{code, message, message_code, result}`). */
    envelope: boolean;
    messageCode?: string;
    message?: string;
    /** `result` of the envelope, or the whole body for plain JSON. */
    result: unknown;
  }
  | {
    kind: 'file';
    status: number;
    data: Uint8Array;
    contentType: string;
    fileName?: string;
  };

/** POST /leave/decision-insights item (TMS-4989). */
export interface TeamsoLeaveInsight {
  id: string;
  balanceAfter?: number | null;
  teamSize?: number;
  shiftDays?: string[];
  clean?: boolean;
  overlaps?: Array<{
    userId?: string;
    name?: string;
    startDate?: string;
    endDate?: string;
    pending?: boolean;
    typeName?: string | null;
  }>;
}

// ------------------------------------------------- TMS-5154: workforce modules

/** An API time: ISO text (with or without an offset), epoch millis or a Jackson `[y, M, d, H, m]` array. */
export type TeamsoTime = string | number | number[] | null;

/** `avatarUser` of the PDKS answers. */
export interface TeamsoPdksPerson {
  id?: string;
  name?: string | null;
  secondName?: string | null;
  surname?: string | null;
}

/** GET /pdks-qr/my-status. */
export interface TeamsoAttendanceStatus {
  moduleActive?: boolean;
  userName?: string;
  serverTime?: string;
  timezone?: string;
  shift?: { hasPlan?: boolean; start?: string | null; end?: string | null };
  today?: {
    checkIn?: string | null;
    checkOut?: string | null;
    onBreak?: boolean;
    late?: boolean;
    next?: string | null;
    breakStartedAt?: string | null;
  };
  locations?: Array<{ id?: string; name?: string }>;
  pendingExcuses?: Array<{ anomalyId?: string; type?: string; date?: string; minutes?: number | null; requested?: boolean }>;
}

/** GET /pdks-qr/dashboard. */
export interface TeamsoAttendanceDashboard {
  cameToday?: number;
  atWork?: number;
  noShow?: number;
  notStarted?: number;
  late?: number;
  earlyLeave?: number;
  onBreak?: number;
  activeNow?: number;
  openAnomalies?: number;
  pendingExcuses?: number;
  locationCount?: number;
}

/** GET /pdks-qr/dashboard/detail/{card}. */
export interface TeamsoAttendanceCard {
  rows?: Array<{
    userId?: string;
    userName?: string;
    dateTime?: TeamsoTime;
    minutes?: number | null;
    locationName?: string | null;
    plannedWindow?: string | null;
    detail?: string | null;
  }>;
  movements?: unknown[];
}

/** A forgotten scan request (PDKS corrections). */
export interface TeamsoScanCorrection {
  id?: string;
  day?: string | null;
  type?: string;
  requestedAt?: TeamsoTime;
  suggestedAt?: TeamsoTime;
  reason?: string | null;
  note?: string | null;
  status?: string;
  decisionNote?: string | null;
  decidedAt?: TeamsoTime;
  createdAt?: TeamsoTime;
  user?: TeamsoPdksPerson | null;
  canDecide?: boolean;
}

/** GET /pdks-qr/corrections/me. */
export interface TeamsoMyScanCorrections {
  missing?: Array<{ day?: string; type?: string; suggestedAt?: TeamsoTime; otherMovementAt?: TeamsoTime }>;
  requests?: TeamsoScanCorrection[];
  limits?: { maxDaysBack?: number; monthlyLimit?: number; usedThisMonth?: number };
  reasons?: string[];
}

/** A monthly timesheet summary row (timesheet attestation). */
export interface TeamsoTimesheetMonth {
  id?: string;
  userId?: string;
  name?: string;
  personnelId?: string | null;
  branchName?: string | null;
  departmentName?: string | null;
  year?: number;
  month?: number;
  status?: string;
  reapproval?: boolean;
  version?: number;
  sentAt?: TeamsoTime;
  respondedAt?: TeamsoTime;
  remindedAt?: TeamsoTime;
  openDisputes?: number;
  disputedDays?: string[];
  totals?: Record<string, number | null> | null;
}

/** GET /timesheet-attestation/mcp/rounds. */
export interface TeamsoTimesheetRounds {
  year?: number;
  month?: number;
  counts?: Record<string, number>;
  rows?: TeamsoTimesheetMonth[];
  notSent?: number;
  monthOver?: boolean;
  canSend?: boolean;
}

/** GET /shift/mcp/my-shifts. */
export interface TeamsoMyShifts {
  from?: string;
  to?: string;
  total?: number;
  shifts?: Array<{
    id?: string;
    date?: string;
    dayName?: string | null;
    working?: boolean;
    start?: string | null;
    end?: string | null;
    overnight?: boolean;
    workingType?: string | null;
    branchId?: string | null;
    branchName?: string | null;
    note?: string | null;
    breaks?: Array<{ start?: string | null; end?: string | null }>;
  }>;
}

/** GET /expense-type/listAllByActive item. */
export interface TeamsoExpenseType {
  id: string;
  name?: string;
  abbreviation?: string | null;
  status?: boolean;
  maxAmount?: number | null;
  currency?: string | null;
  description?: string | null;
  allowLimitOverrun?: boolean | null;
}

/** GET /expense-management/groups item. */
export interface TeamsoExpenseGroup {
  id: string;
  title?: string | null;
  description?: string | null;
  status?: string;
  owner?: { id?: string; fullName?: string | null } | null;
  departmentName?: string | null;
  receiptCount?: number;
  totals?: Array<{ currency?: string; amount?: number; payable?: number }>;
  createdAt?: TeamsoTime;
  submittedAt?: TeamsoTime;
  receiptDate?: string | null;
  approvalQueue?: number | null;
  currentStepLabel?: string | null;
  revisionNo?: number | null;
  limitOverrun?: boolean;
  answer?: string | null;
}

export interface TeamsoExpenseGroupPage {
  items?: TeamsoExpenseGroup[];
  pagination?: { page?: number; size?: number; totalRecords?: number; totalPages?: number };
}

/** POST /expense-form-detail body. */
export interface TeamsoExpenseReceiptRequest {
  expenseFormId: string;
  expenseTypeId: string;
  receiptAmount: number;
  currencyType: string;
  taxRate: number;
  receiptDate: string;
  expenseDescription: string;
  paidAmountToEmployee: number;
  paidAmountByCompanyCard: number;
  advancePaymentAmount: number;
}

/** GET /expense-form/{id}/limit-check. */
export interface TeamsoExpenseLimitCheck {
  overrun?: boolean;
  blocked?: boolean;
  warnings?: Array<Record<string, unknown>>;
}

/** GET /job-posting/list-with-candidate-counts item. */
export interface TeamsoJobPosting {
  id: string;
  positionName?: string | null;
  location?: string | null;
  status?: string | null;
  candidateCount?: number;
  sharedDate?: TeamsoTime;
  daysSinceShared?: number | null;
  workModel?: string | null;
  workingType?: string | null;
  experienceYear?: string | null;
  departmentNames?: string[] | null;
}

/** GET /job-posting/list-candidate/{id}/pagination item. */
export interface TeamsoJobCandidate {
  id: string;
  name?: string | null;
  surname?: string | null;
  status?: string | null;
  subStatus?: string | null;
  cvScore?: string | number | null;
  criteriaFit?: number | null;
  aiReview?: string | null;
  location?: string | null;
  experience?: string | null;
  isFavorite?: boolean;
  createdAt?: TeamsoTime;
}

export interface TeamsoStandardPage<T> {
  items?: T[];
  pagination?: { currentPage?: number; pageSize?: number; totalRecords?: number; totalPages?: number; hasNext?: boolean };
  filters?: { statusCounts?: Record<string, number> | null } | null;
}

/** GET /onboarding/pagination item. */
export interface TeamsoOnboarding {
  id: string;
  name?: string | null;
  secondName?: string | null;
  surname?: string | null;
  branchId?: string | null;
  branch?: { id?: string; name?: string | null } | null;
  status?: string | null;
  active?: boolean;
  isConfirmed?: boolean;
  isConfirmedPhoneNumber?: boolean;
  approvalQueue?: number;
  rejectReason?: string | null;
  hasTransferFailure?: boolean;
  startDateHistory?: Array<{ id?: string; startDate?: string | null }> | null;
}
