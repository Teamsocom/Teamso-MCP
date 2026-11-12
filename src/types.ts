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
  overnightShift?: boolean | null;
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
