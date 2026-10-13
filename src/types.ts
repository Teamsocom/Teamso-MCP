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
  /** Personal access token, `tms_pat_...`. */
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
