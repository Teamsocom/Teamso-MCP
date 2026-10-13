import crypto from 'node:crypto';
import net from 'node:net';
import type {
  ApiCallRequest,
  ApiCallResponse,
  ApiQueryValue,
  HelpBundle,
  HelpLanguage,
  TeamsoAnnouncementFeed,
  TeamsoApiEndpointDescription,
  TeamsoApiEndpointPage,
  TeamsoApiModule,
  TeamsoAuthorizedEmployee,
  TeamsoDayCalculation,
  TeamsoEnvelope,
  TeamsoEvaluationApproval,
  TeamsoFileDownload,
  TeamsoGoal,
  TeamsoGoalPage,
  TeamsoGoalRequest,
  TeamsoLeaveControl,
  TeamsoLeaveCreateRequest,
  TeamsoLeaveListParams,
  TeamsoLeavePage,
  TeamsoLeavePolicyAssignment,
  TeamsoLeaveTypeBalance,
  TeamsoPayslipListParams,
  TeamsoPayslipPage,
  TeamsoPendingTransaction,
  TeamsoPerformanceSettings,
  TeamsoPublicHolidayCalendar,
  TeamsoUser,
  TeamsoUserPage,
  TeamsoUserSummary,
  TeamsoWorkingDays,
} from './types.js';
import { VERSION } from './version.js';

export type * from './types.js';

const DEFAULT_BASE_URL = 'https://api.teamso.com/v1';
const DEFAULT_HELP_BASE_URL = 'https://teamso.com';
const DEFAULT_TIMEOUT_MS = 30_000;
const HELP_CACHE_TTL_MS = 10 * 60_000;
const HELP_RETRY_AFTER_MS = 60_000;
const ACCESS_TOKEN_PREFIX = 'tms_pat_';
const MIN_PROXY_SECRET_LENGTH = 32;
const LEAVE_ANSWER_PLACEHOLDER = '-';

export const CLIENT_HEADER = 'X-Teamso-Client';
export const PROXY_CLIENT_IP_HEADER = 'X-Teamso-Proxy-Client-Ip';
export const PROXY_TIMESTAMP_HEADER = 'X-Teamso-Proxy-Timestamp';
export const PROXY_SIGNATURE_HEADER = 'X-Teamso-Proxy-Signature';
/** With value `read`, the API lets the request reach only handlers that do not write (403 otherwise). */
export const MCP_INTENT_HEADER = 'X-Teamso-Mcp-Intent';

const CATALOG_PATH = '/mcp-catalog';
const ENDPOINT_CACHE_TTL_MS = 60_000;
const ENDPOINT_CACHE_MAX = 200;
const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

/**
 * `message_code` values that mean failure even when the API answers HTTP 200
 * with `code: 1`. Anything ending in `_ERROR` or `NOT_FOUND` is a failure too.
 */
const FAILURE_MESSAGE_CODES = new Set([
  'ACCOUNT_LOCKED',
  'ALREADY_ASSIGNED',
  'ALREADY_EXISTS',
  'AUTHENTICATION_FAILED',
  'CAPACITY_FULL',
  'CONTENT_TOO_LONG',
  'CREDIT_INSUFFICIENT',
  'DATE_RANGE_MISMATCH',
  'INSUFFICIENT_WALLET_BALANCE',
  'INVALID_CREDENTIALS',
  'INVALID_DATA',
  'INVALID_FORMAT',
  'INVALID_INPUT_PARAMETERS',
  'ITEM_EXIST',
  'LICENSE_EXPIRED',
  'LICENSE_EXPIRED_FOR_MANAGER',
  'MANDATORY_ENTER_DETAIL',
  'NO_RESPONSIBLE_POSITION',
  'NOT_REQUESTED',
  'NOT_SUITABLE_FOR_ADD',
  'OTP_NOT_DONE',
  'PERMISSION_DENIED',
  'RANGE_NOT_SUITABLE',
  'RECORD_BUSY',
  'STATUS_NOT_VALID',
  'SUPPORT_ACCESS_NOT_GRANTED',
  'TOKEN_INVALID',
  'USER_EXIST',
  'USER_IS_PASSIVE',
  'YOU_CAN_ADD_ONLY_YOURSELF',
  'YOU_CAN_DELETE_ONLY_YOURSELF',
]);

const FAILURE_MESSAGE_CODE_PATTERN = /(^|_)(ERROR|NOT_FOUND)$/;

export function isFailureMessageCode(messageCode: string | undefined): boolean {
  if (!messageCode) return false;
  return FAILURE_MESSAGE_CODES.has(messageCode)
    || FAILURE_MESSAGE_CODE_PATTERN.test(messageCode);
}

export interface TrustedProxyContext {
  /** The end user's IP address (IPv4 or IPv6 literal). */
  clientIp: string;
  /** Shared secret configured as `security.mcp-proxy.shared-secret` on the API (≥ 32 chars). */
  sharedSecret: string;
}

export interface TeamsoClientOptions {
  /** Sign the caller IP so the API applies its IP allowlist and audit to the real caller. */
  trustedProxy?: TrustedProxyContext;
  /** Site the help bundle is downloaded from (default `https://teamso.com`). */
  helpBaseUrl?: string;
  /**
   * Public site used for every help link and image shown to users (default: `helpBaseUrl`).
   * Set it when `helpBaseUrl` is an internal address (e.g. a loopback mirror), so that address
   * never reaches tool output.
   */
  helpPublicUrl?: string;
  /** Custom fetch implementation (tests, instrumentation). Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Per-request timeout in milliseconds (default 30 000). */
  timeoutMs?: number;
  /** How long a downloaded help bundle stays fresh, in milliseconds (default 10 minutes). */
  helpCacheTtlMs?: number;
  /**
   * Shared help bundle cache (see createHelpCache). A long-running server that creates a client per
   * request passes one cache so the bundle is downloaded once per TTL instead of on every call.
   */
  helpCache?: HelpCache;
  /** Clock used for proxy timestamps and the help cache (tests). */
  now?: () => number;
}

export interface ProxySignatureInput {
  sharedSecret: string;
  timestamp: string;
  clientIp: string;
  method: string;
  /** Request path including the context path (`/v1/...`), without the query string. */
  pathname: string;
  accessToken: string;
}

/**
 * HMAC-SHA256 over `timestamp\nclientIp\nMETHOD\npathname\nsha256hex(token)`,
 * lowercase hex. The API verifies the same message within ±60 seconds.
 */
export function signProxyRequest(input: ProxySignatureInput): string {
  const tokenHash = crypto.createHash('sha256').update(input.accessToken).digest('hex');
  const message = [
    input.timestamp,
    input.clientIp,
    input.method.toUpperCase(),
    input.pathname,
    tokenHash,
  ].join('\n');
  return crypto
    .createHmac('sha256', input.sharedSecret)
    .update(message)
    .digest('hex');
}

/**
 * A failed Teamso API call. Teamso reports many failures with HTTP 200 and
 * `code: 1`, so `status` alone does not tell success from failure: check
 * `messageCode` (e.g. `OTP_NOT_DONE`, `ITEM_NOT_FOUND`, `PERMISSION_DENIED`).
 */
export class TeamsoApiError extends Error {
  readonly status: number;
  readonly messageCode?: string;
  readonly apiMessage?: string;
  readonly body: unknown;

  constructor(status: number, messageCode: string | undefined, message: string | undefined, body: unknown) {
    const label = [`HTTP ${status}`, messageCode].filter(Boolean).join(', ');
    super(`Teamso API error (${label})${message ? `: ${message}` : ''}`);
    this.name = 'TeamsoApiError';
    this.status = status;
    this.messageCode = messageCode;
    this.apiMessage = message;
    this.body = body;
  }

  /** `result` of the response envelope, when the API sent one. */
  get result(): unknown {
    return isRecord(this.body) ? this.body.result : undefined;
  }
}

/** A response body larger than the caller accepts; nothing of it is returned. */
export class TeamsoResponseTooLargeError extends Error {
  readonly limitBytes: number;
  /** Size announced by `Content-Length`, when known. */
  readonly sizeBytes?: number;

  constructor(limitBytes: number, sizeBytes?: number) {
    super(`The Teamso response is larger than ${formatMegabytes(limitBytes)}`
      + `${sizeBytes ? ` (${formatMegabytes(sizeBytes)})` : ''}.`);
    this.name = 'TeamsoResponseTooLargeError';
    this.limitBytes = limitBytes;
    this.sizeBytes = sizeBytes;
  }
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type QueryValue = ApiQueryValue | undefined | null;

interface RequestOptions {
  query?: Record<string, QueryValue>;
  /** JSON body. */
  body?: unknown;
  /** Pre-encoded body (text or multipart); `contentType` is set unless the body is FormData. */
  rawBody?: string | FormData;
  contentType?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  accept?: string;
  /** `manual` returns 3xx answers instead of following them (generic API calls). */
  redirect?: 'follow' | 'manual' | 'error';
}

/** Help bundle cache shared between clients; keys are `<helpBaseUrl>\n<lang>`. */
export type HelpCache = Map<string, HelpCacheEntry>;

export function createHelpCache(): HelpCache {
  return new Map();
}

export interface HelpCacheEntry {
  bundle?: HelpBundle;
  expiresAt: number;
  pending?: Promise<HelpBundle>;
}

export class TeamsoClient {
  readonly baseUrl: string;
  readonly helpBaseUrl: string;
  /** Origin of the help links and images in tool output. */
  readonly helpPublicUrl: string;
  // ES private fields: unlike TypeScript `private`, they stay out of
  // console.log, util.inspect and JSON.stringify, so the credentials never
  // reach a log line through the client object.
  readonly #accessToken: string;
  readonly #trustedProxy?: TrustedProxyContext;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly helpCacheTtlMs: number;
  private readonly now: () => number;
  private readonly helpCache: HelpCache;
  private readonly endpointCache = new Map<string, { value: TeamsoApiEndpointDescription; expiresAt: number }>();

  constructor(accessToken: string, baseUrl?: string, options: TeamsoClientOptions = {}) {
    if (!accessToken) throw new Error('TEAMSO_ACCESS_TOKEN is required');
    if (!accessToken.startsWith(ACCESS_TOKEN_PREFIX)) {
      throw new Error(`TEAMSO_ACCESS_TOKEN must be a Teamso personal access token (${ACCESS_TOKEN_PREFIX}...)`);
    }
    let trustedProxy: TrustedProxyContext | undefined;
    if (options.trustedProxy) {
      const clientIp = normalizeClientIp(options.trustedProxy.clientIp ?? '');
      if (net.isIP(clientIp) === 0) {
        throw new Error('trustedProxy.clientIp must be a valid IPv4 or IPv6 address');
      }
      if ((options.trustedProxy.sharedSecret ?? '').length < MIN_PROXY_SECRET_LENGTH) {
        throw new Error(`trustedProxy.sharedSecret must be at least ${MIN_PROXY_SECRET_LENGTH} characters`);
      }
      trustedProxy = { clientIp, sharedSecret: options.trustedProxy.sharedSecret };
    }
    this.#accessToken = accessToken;
    this.baseUrl = trimTrailingSlashes(baseUrl || DEFAULT_BASE_URL);
    this.helpBaseUrl = trimTrailingSlashes(options.helpBaseUrl || DEFAULT_HELP_BASE_URL);
    this.helpPublicUrl = trimTrailingSlashes(options.helpPublicUrl || this.helpBaseUrl);
    this.#trustedProxy = trustedProxy;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.helpCacheTtlMs = options.helpCacheTtlMs ?? HELP_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
    this.helpCache = options.helpCache ?? createHelpCache();
  }

  // ---------------------------------------------------------------- account

  async getMe(signal?: AbortSignal): Promise<TeamsoUser> {
    return this.call<TeamsoUser>('GET', '/user', { signal });
  }

  // ------------------------------------------------------------------ leave

  async listLeavePolicies(signal?: AbortSignal): Promise<TeamsoLeavePolicyAssignment[]> {
    return asArray(await this.call<TeamsoLeavePolicyAssignment[]>(
      'GET',
      '/leave-policy/getListAllLeavePolicyForUser',
      { signal },
    ));
  }

  async getLeavePolicyBalances(
    leavePolicyUserId: string,
    signal?: AbortSignal,
  ): Promise<TeamsoLeaveTypeBalance[]> {
    return asArray(await this.call<TeamsoLeaveTypeBalance[]>(
      'GET',
      `/leave-policy/getDetailLeavePolicyForUser/${segment(leavePolicyUserId)}`,
      { signal },
    ));
  }

  async getMyWorkingDays(signal?: AbortSignal): Promise<TeamsoWorkingDays> {
    return this.call<TeamsoWorkingDays>('GET', '/working-days/getWorkingDaysByMe', { signal });
  }

  async getMyPublicHolidays(signal?: AbortSignal): Promise<TeamsoPublicHolidayCalendar> {
    return this.call<TeamsoPublicHolidayCalendar>('GET', '/public-holiday/getPublicHolidayByMe', { signal });
  }

  /** Dates are `yyyy-MM-dd HH:mm` Turkey wall clock. */
  async calculateLeaveDays(
    params: {
      workingDaysId: string;
      publicHolidayId: string;
      leaveTypeId: string;
      startDate: string;
      endDate: string;
    },
    signal?: AbortSignal,
  ): Promise<TeamsoDayCalculation> {
    const path = [
      '/leave/dayCalculator',
      segment(params.workingDaysId),
      segment(params.publicHolidayId),
      segment(params.leaveTypeId),
      segment(params.startDate),
      segment(params.endDate),
    ].join('/');
    return this.call<TeamsoDayCalculation>('GET', path, { signal });
  }

  async checkLeaveRequest(
    params: {
      leaveTypeId: string;
      addedDay: number;
      startDate: string;
      endDate: string;
      leavePolicyUserId: string;
      userId: string;
    },
    signal?: AbortSignal,
  ): Promise<TeamsoLeaveControl> {
    return this.call<TeamsoLeaveControl>('POST', '/leave/controlToAddLeave', {
      query: {
        leaveTypeId: params.leaveTypeId,
        addedDay: params.addedDay,
        startDate: params.startDate,
        endDate: params.endDate,
        leavePolicyUserId: params.leavePolicyUserId,
      },
      body: [params.userId],
      signal,
    });
  }

  async createLeave(request: TeamsoLeaveCreateRequest, signal?: AbortSignal): Promise<TeamsoEnvelope> {
    return this.requestEnvelope('POST', '/leave', { body: request, signal });
  }

  async listLeaves(params: TeamsoLeaveListParams = {}, signal?: AbortSignal): Promise<TeamsoLeavePage> {
    return this.call<TeamsoLeavePage>('GET', '/leave/listAllLeavesAdvancedPagination', {
      query: {
        page: params.page ?? 0,
        size: params.size ?? 50,
        sortKey: 'createdAt',
        sortDirection: 'desc',
        searchKey: params.searchKey,
        searchValue: params.searchValue,
        rangeStart: params.rangeStart,
        rangeEnd: params.rangeEnd,
      },
      signal,
    });
  }

  async deleteLeave(leaveId: string, signal?: AbortSignal): Promise<TeamsoEnvelope> {
    return this.requestEnvelope('DELETE', `/leave/${segment(leaveId)}`, { signal });
  }

  /**
   * Records an approval decision. `answer` is stored as the decision note (the
   * rejection reason); the API requires one, so approvals without a note send `-`.
   */
  async respondToLeave(
    leaveId: string,
    approve: boolean,
    answer?: string,
    signal?: AbortSignal,
  ): Promise<TeamsoEnvelope> {
    const note = pathSafeText(answer ?? '') || LEAVE_ANSWER_PLACEHOLDER;
    const path = `/leave/state/${segment(leaveId)}/${approve}/${segment(note)}`;
    return this.requestEnvelope('PUT', path, { signal });
  }

  // -------------------------------------------------------------------- otp

  /** Sends a 6-digit SMS code to the caller's phone. Costs SMS credit. */
  async requestOtp(signal?: AbortSignal): Promise<TeamsoEnvelope> {
    return this.requestEnvelope('GET', '/sms/generateToken', {
      query: { checkCredit: true },
      signal,
    });
  }

  /** Verifies the SMS code; the next OTP-protected call consumes the verification. */
  async verifyOtp(code: string, signal?: AbortSignal): Promise<TeamsoEnvelope> {
    return this.requestEnvelope('GET', `/sms/checkToken/${segment(code)}`, { signal });
  }

  // -------------------------------------------------------------- approvals

  async listPendingTransactions(signal?: AbortSignal): Promise<TeamsoPendingTransaction[]> {
    return asArray(await this.call<TeamsoPendingTransaction[]>(
      'GET',
      '/dashboard/getPendingTransactionsByRequestOwner',
      { signal },
    ));
  }

  // -------------------------------------------------------------- employees

  async searchUsers(
    params: { query: string; page?: number; size?: number },
    signal?: AbortSignal,
  ): Promise<TeamsoUserPage> {
    return this.call<TeamsoUserPage>('GET', '/user/list-pagination', {
      query: {
        page: params.page ?? 0,
        size: params.size ?? 50,
        activeFilter: true,
        searchKey: 'user',
        searchValue: params.query,
      },
      signal,
    });
  }

  async listAuthorizedEmployees(signal?: AbortSignal): Promise<TeamsoAuthorizedEmployee[]> {
    return asArray(await this.call<TeamsoAuthorizedEmployee[]>('GET', '/authorized-employee/list', { signal }));
  }

  async getUserSummary(userId: string, signal?: AbortSignal): Promise<TeamsoUserSummary> {
    return this.call<TeamsoUserSummary>('GET', `/user/getUserSummaryByUserId/${segment(userId)}`, { signal });
  }

  // ------------------------------------------------------------ performance

  async getPerformanceSettings(signal?: AbortSignal): Promise<TeamsoPerformanceSettings> {
    return this.call<TeamsoPerformanceSettings>('GET', '/performance-settings', { signal });
  }

  async listMyGoals(
    params: { periodName: string; page?: number; size?: number },
    signal?: AbortSignal,
  ): Promise<TeamsoGoalPage> {
    return this.call<TeamsoGoalPage>('GET', '/user-goal/my', {
      query: { periodName: params.periodName, page: params.page ?? 0, size: params.size ?? 100 },
      signal,
    });
  }

  async listAssignedGoals(
    params: { periodName: string; status?: string; page?: number; size?: number },
    signal?: AbortSignal,
  ): Promise<TeamsoGoalPage> {
    return this.call<TeamsoGoalPage>('GET', '/user-goal/assigned', {
      query: {
        periodName: params.periodName,
        status: params.status,
        page: params.page ?? 0,
        size: params.size ?? 100,
      },
      signal,
    });
  }

  async getGoal(goalId: string, signal?: AbortSignal): Promise<TeamsoGoal> {
    return this.call<TeamsoGoal>('GET', `/user-goal/${segment(goalId)}`, { signal });
  }

  async createGoal(request: TeamsoGoalRequest, signal?: AbortSignal): Promise<TeamsoGoal> {
    return this.call<TeamsoGoal>('POST', '/user-goal', { body: request, signal });
  }

  async sendGoalsToApproval(goalIds: string[], signal?: AbortSignal): Promise<TeamsoEnvelope> {
    return this.requestEnvelope('POST', '/user-goal/send-to-approval', { body: goalIds, signal });
  }

  /** `GET` on the API, but it changes the goal status. */
  async approveGoal(goalId: string, signal?: AbortSignal): Promise<TeamsoEnvelope<TeamsoGoal>> {
    return this.requestEnvelope<TeamsoGoal>('GET', `/user-goal/approve/${segment(goalId)}`, { signal });
  }

  async reviseAndApproveGoal(
    goalId: string,
    request: TeamsoGoalRequest,
    signal?: AbortSignal,
  ): Promise<TeamsoEnvelope<TeamsoGoal>> {
    return this.requestEnvelope<TeamsoGoal>('PUT', `/user-goal/revise-and-approve/${segment(goalId)}`, {
      body: request,
      signal,
    });
  }

  async updateGoalActualValue(
    goalId: string,
    params: { actualValue?: number; actualText?: string },
    signal?: AbortSignal,
  ): Promise<TeamsoEnvelope<TeamsoGoal>> {
    return this.requestEnvelope<TeamsoGoal>('PUT', `/user-goal/${segment(goalId)}/actual-value`, {
      query: { actualValue: params.actualValue, actualText: params.actualText },
      signal,
    });
  }

  async updateManagerActualValue(
    goalId: string,
    params: { managerActualValue?: number; managerActualText?: string },
    signal?: AbortSignal,
  ): Promise<TeamsoEnvelope<TeamsoGoal>> {
    return this.requestEnvelope<TeamsoGoal>('PUT', `/user-goal/${segment(goalId)}/manager-actual-value`, {
      query: {
        managerActualValue: params.managerActualValue,
        managerActualText: params.managerActualText,
      },
      signal,
    });
  }

  async approveEvaluationProcess(
    params: { periodName: string; userId: string },
    signal?: AbortSignal,
  ): Promise<TeamsoEnvelope<TeamsoEvaluationApproval>> {
    return this.requestEnvelope<TeamsoEvaluationApproval>('POST', '/user-goal/approve-evaluation-process', {
      query: { periodName: params.periodName, userId: params.userId },
      signal,
    });
  }

  // ---------------------------------------------------------- communication

  async getAnnouncements(signal?: AbortSignal): Promise<TeamsoAnnouncementFeed> {
    return this.call<TeamsoAnnouncementFeed>('GET', '/dashboard/getAnnouncements', { signal });
  }

  // ---------------------------------------------------------------- payroll

  async listMyPayslips(params: TeamsoPayslipListParams = {}, signal?: AbortSignal): Promise<TeamsoPayslipPage> {
    return this.call<TeamsoPayslipPage>('GET', '/payroll/getPayrollsByMe-pagination', {
      query: {
        page: params.page ?? 0,
        size: params.size ?? 12,
        sortKey: 'term',
        sortDirection: 'desc',
        searchKey: params.searchKey,
        searchValue: params.searchValue,
      },
      signal,
    });
  }

  /** Raw PDF bytes. The API answers every failure with a bodyless 404. */
  async downloadPayslip(payslipId: string, signal?: AbortSignal): Promise<TeamsoFileDownload> {
    const response = await this.send('GET', `/payroll/download-file/${segment(payslipId)}`, {
      signal,
      accept: 'application/pdf, application/json;q=0.5',
    });
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    if (!response.ok || contentType.includes('json')) {
      const text = await response.text();
      const parsed = parseJson(text);
      if (!response.ok) throw errorFromResponse(response.status, parsed, text);
      throw envelopeError(response.status, parsed);
    }
    return {
      data: new Uint8Array(await response.arrayBuffer()),
      contentType: contentType.split(';')[0]!.trim(),
      fileName: fileNameFromDisposition(response.headers.get('content-disposition')),
    };
  }

  // ------------------------------------------------------------ API catalog

  /** Endpoints the caller may call (`GET /mcp-catalog/endpoints`); pages start at 1. */
  async listApiEndpoints(
    params: { q?: string; module?: string; method?: string; page?: number; size?: number; lang?: HelpLanguage } = {},
    signal?: AbortSignal,
  ): Promise<TeamsoApiEndpointPage> {
    const page = await this.call<TeamsoApiEndpointPage>('GET', `${CATALOG_PATH}/endpoints`, {
      query: {
        q: params.q,
        module: params.module,
        method: params.method,
        page: params.page,
        size: params.size,
        lang: params.lang,
      },
      signal,
    });
    return isRecord(page) ? page : {};
  }

  /**
   * Full description of one endpoint the caller may call (`GET /mcp-catalog/endpoint`). Unknown,
   * hidden and not-allowed ids are `ITEM_NOT_FOUND`. Descriptions are cached for a minute per client.
   */
  async getApiEndpoint(id: string, lang?: HelpLanguage, signal?: AbortSignal): Promise<TeamsoApiEndpointDescription> {
    const key = `${lang ?? ''}\n${id}`;
    const now = this.now();
    const cached = this.endpointCache.get(key);
    if (cached && now < cached.expiresAt) return cached.value;
    const description = await this.call<TeamsoApiEndpointDescription>('GET', `${CATALOG_PATH}/endpoint`, {
      query: { id, lang },
      signal,
    });
    if (!isRecord(description)) {
      throw new TeamsoApiError(200, 'ITEM_NOT_FOUND', 'The catalog returned no description', description);
    }
    if (this.endpointCache.size >= ENDPOINT_CACHE_MAX) {
      const oldest = this.endpointCache.keys().next().value;
      if (oldest !== undefined) this.endpointCache.delete(oldest);
    }
    this.endpointCache.set(key, { value: description, expiresAt: now + ENDPOINT_CACHE_TTL_MS });
    return description;
  }

  /** Product modules with endpoint counts (`GET /mcp-catalog/modules`). */
  async listApiModules(lang?: HelpLanguage, signal?: AbortSignal): Promise<TeamsoApiModule[]> {
    return asArray(await this.call<TeamsoApiModule[]>('GET', `${CATALOG_PATH}/modules`, { query: { lang }, signal }));
  }

  /**
   * Calls one catalog endpoint. JSON answers are unwrapped (Teamso failures, including HTTP 200
   * failure codes, throw `TeamsoApiError`); anything else comes back as a file. Bodies larger than
   * `maxResponseBytes` throw `TeamsoResponseTooLargeError` without being buffered.
   */
  async callApi(request: ApiCallRequest, signal?: AbortSignal): Promise<ApiCallResponse> {
    assertApiPath(request.path);
    const options: RequestOptions = {
      query: request.query,
      signal,
      accept: 'application/json, */*;q=0.8',
      headers: request.readIntent ? { [MCP_INTENT_HEADER]: 'read' } : undefined,
      // A redirect would leave the catalog route: fetch would follow it to any host (internal
      // addresses included) and hand that answer to the assistant as a Teamso file.
      redirect: 'manual',
    };
    const body = request.body;
    if (body?.kind === 'json') {
      options.body = body.value;
    } else if (body?.kind === 'text') {
      options.rawBody = body.value;
      options.contentType = body.contentType;
    } else if (body?.kind === 'multipart') {
      const form = new FormData();
      for (const [name, values] of Object.entries(body.fields)) {
        for (const value of values) form.append(name, value);
      }
      for (const file of body.files) {
        form.append(file.field, new Blob([file.data], { type: file.contentType }), file.filename);
      }
      options.rawBody = form;
    }

    const response = await this.send(request.method, request.path, options);
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => undefined);
      throw new TeamsoApiError(response.status || 302, 'REDIRECT_NOT_FOLLOWED',
        'Teamso answered with a redirect; generic API calls do not follow redirects', undefined);
    }
    const contentType = response.headers.get('content-type') ?? '';
    const data = await readLimited(response, request.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
    const isJson = /json/i.test(contentType) || (contentType === '' && looksLikeJson(data));

    if (!response.ok) {
      const text = new TextDecoder().decode(data);
      throw errorFromResponse(response.status, parseJson(text), text);
    }
    if (!isJson) {
      const fileName = fileNameFromDisposition(response.headers.get('content-disposition'));
      return {
        kind: 'file',
        status: response.status,
        data,
        contentType: fileMimeType(contentType.split(';')[0]!.trim(), fileName),
        fileName,
      };
    }

    const text = new TextDecoder().decode(data);
    const parsed = parseJson(text);
    if (text.trim() !== '' && parsed === undefined) {
      throw new TeamsoApiError(response.status, undefined, 'The API returned a response that is not valid JSON', text.slice(0, 300));
    }
    if (isRecord(parsed) && (typeof parsed.message_code === 'string' || typeof parsed.code === 'number')) {
      const envelope = parsed as TeamsoEnvelope;
      if (envelope.code === 0 || isFailureMessageCode(envelope.message_code)) {
        throw envelopeError(response.status, envelope);
      }
      return {
        kind: 'json',
        status: response.status,
        envelope: true,
        messageCode: stringOrUndefined(envelope.message_code),
        message: stringOrUndefined(envelope.message),
        result: envelope.result,
      };
    }
    return { kind: 'json', status: response.status, envelope: false, result: parsed };
  }

  // ------------------------------------------------------------------- help

  /**
   * Public help-center bundle. Cached in memory; when a refresh fails the last
   * good copy is served and the download is retried a minute later.
   */
  async getHelpBundle(lang: HelpLanguage): Promise<HelpBundle> {
    const now = this.now();
    const key = `${this.helpBaseUrl}\n${lang}`;
    const entry = this.helpCache.get(key);
    if (entry?.bundle && now < entry.expiresAt) return entry.bundle;
    if (entry?.pending) return entry.pending;

    // One shared download per language; a caller's abort must not fail the others.
    const pending = this.downloadHelpBundle(lang)
      .then(bundle => {
        this.helpCache.set(key, { bundle, expiresAt: this.now() + this.helpCacheTtlMs });
        return bundle;
      })
      .catch((error: unknown) => {
        const stale = this.helpCache.get(key)?.bundle;
        this.helpCache.set(key, { bundle: stale, expiresAt: this.now() + HELP_RETRY_AFTER_MS });
        if (stale) return stale;
        throw error;
      });
    this.helpCache.set(key, { bundle: entry?.bundle, expiresAt: entry?.expiresAt ?? 0, pending });
    return pending;
  }

  private async downloadHelpBundle(lang: HelpLanguage): Promise<HelpBundle> {
    const url = `${this.helpBaseUrl}/how-to/bundle.${lang}.json`;
    const response = await this.fetchImpl(url, {
      headers: { Accept: 'application/json', [CLIENT_HEADER]: `teamso-mcp/${VERSION}` },
      signal: withTimeout(undefined, this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Help articles could not be downloaded from ${url} (HTTP ${response.status})`);
    }
    const parsed = parseJson(await response.text());
    if (!isRecord(parsed) || !Array.isArray(parsed.articles) || !Array.isArray(parsed.modules)) {
      throw new Error(`Help bundle at ${url} is not in the expected format`);
    }
    return parsed as unknown as HelpBundle;
  }

  // -------------------------------------------------------------- transport

  private async call<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    const envelope = await this.requestEnvelope<T>(method, path, options);
    return envelope.result as T;
  }

  private async requestEnvelope<T = unknown>(
    method: HttpMethod,
    path: string,
    options: RequestOptions = {},
  ): Promise<TeamsoEnvelope<T>> {
    const response = await this.send(method, path, options);
    const text = await response.text();
    const parsed = parseJson(text);

    if (!response.ok) throw errorFromResponse(response.status, parsed, text);
    if (!isRecord(parsed)) {
      throw new TeamsoApiError(response.status, undefined, 'The API returned a response that is not JSON', text);
    }

    const envelope = parsed as TeamsoEnvelope<T>;
    if (envelope.code === 0 || isFailureMessageCode(envelope.message_code)) {
      throw envelopeError(response.status, envelope);
    }
    return envelope;
  }

  private async send(method: HttpMethod, path: string, options: RequestOptions): Promise<Response> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
      } else {
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {
      ...options.headers,
      Authorization: `Bearer ${this.#accessToken}`,
      Accept: options.accept ?? 'application/json',
      [CLIENT_HEADER]: `teamso-mcp/${VERSION}`,
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    else if (typeof options.rawBody === 'string') headers['Content-Type'] = options.contentType ?? 'text/plain';

    const proxy = this.#trustedProxy;
    if (proxy) {
      const timestamp = String(this.now());
      headers[PROXY_CLIENT_IP_HEADER] = proxy.clientIp;
      headers[PROXY_TIMESTAMP_HEADER] = timestamp;
      headers[PROXY_SIGNATURE_HEADER] = signProxyRequest({
        sharedSecret: proxy.sharedSecret,
        timestamp,
        clientIp: proxy.clientIp,
        method,
        pathname: url.pathname,
        accessToken: this.#accessToken,
      });
    }

    try {
      return await this.fetchImpl(url, {
        method,
        headers,
        body: options.body === undefined ? options.rawBody : JSON.stringify(options.body),
        signal: withTimeout(options.signal, this.timeoutMs),
        ...(options.redirect ? { redirect: options.redirect } : {}),
      });
    } catch (error) {
      throw networkError(error, this.baseUrl);
    }
  }
}

/**
 * A request that never got an HTTP answer. Timeouts and cancellations pass
 * through unchanged; connection failures name the API base URL (never the
 * request URL, which may carry user input) so the user can check the setting.
 */
function networkError(error: unknown, baseUrl: string): unknown {
  if (!(error instanceof Error) || error.name === 'TimeoutError' || error.name === 'AbortError') return error;
  const reason = error.cause instanceof Error && error.cause.message ? ` (${error.cause.message})` : '';
  return new Error(`Could not reach the Teamso API at ${baseUrl}${reason}. `
    + 'Check the network connection and `TEAMSO_API_BASE_URL`.', { cause: error });
}

/** `::ffff:203.0.113.7` → `203.0.113.7`, so the API matches IPv4 allowlist entries. */
function normalizeClientIp(value: string): string {
  const trimmed = value.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  return mapped?.[1] ?? trimmed;
}

function envelopeError(status: number, body: unknown): TeamsoApiError {
  const envelope = isRecord(body) ? body as TeamsoEnvelope : {};
  const errorText = (Array.isArray(envelope.errors) ? envelope.errors : [])
    .map(error => (typeof error === 'string' ? error : error?.message))
    .filter(Boolean)
    .join(', ');
  const message = envelope.message || errorText || envelope.message_code || 'The request failed';
  return new TeamsoApiError(status, envelope.message_code, message, body);
}

function errorFromResponse(status: number, parsed: unknown, text: string): TeamsoApiError {
  if (isRecord(parsed)) {
    const apiError = isRecord(parsed.apierror) ? parsed.apierror : undefined;
    const messageCode = stringOrUndefined(parsed.message_code) ?? stringOrUndefined(parsed.error);
    const message = stringOrUndefined(parsed.message)
      ?? stringOrUndefined(apiError?.message)
      ?? stringOrUndefined(apiError?.debugMessage);
    return new TeamsoApiError(status, messageCode, message, parsed);
  }
  const snippet = text.trim().slice(0, 300);
  return new TeamsoApiError(status, undefined, snippet || undefined, text);
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);

  const controller = new AbortController();
  const abort = (source: AbortSignal) => controller.abort(source.reason);
  for (const source of [signal, timeout]) {
    if (source.aborted) {
      abort(source);
      break;
    }
    source.addEventListener('abort', () => abort(source), { once: true });
  }
  return controller.signal;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  csv: 'text/csv',
  zip: 'application/zip',
  xml: 'application/xml',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/**
 * Many Teamso exports answer `application/octet-stream`; the file name then tells what it is, so MCP
 * clients can open an Excel or PDF instead of an unknown binary. A specific type from the API wins.
 */
export function fileMimeType(contentType: string, fileName?: string): string {
  const generic = contentType === '' || /^(application|binary)\/octet-stream$/i.test(contentType);
  if (!generic) return contentType;
  const extension = fileName?.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  return (extension && MIME_BY_EXTENSION[extension]) || 'application/octet-stream';
}

function fileNameFromDisposition(header: string | null): string | undefined {
  if (!header) return undefined;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      // Fall through to the plain filename parameter.
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || undefined;
}

/**
 * Free text that travels as a URL path segment. Tomcat and Spring Security
 * reject encoded slashes, backslashes, semicolons and percent signs there, and
 * a segment of only dots is path traversal, so those are replaced.
 */
export function pathSafeText(value: string): string {
  const cleaned = value.replace(/[/\\;%]+/g, ' ').replace(/\s+/g, ' ').trim();
  return /^\.+$/.test(cleaned) ? '' : cleaned;
}

/** Encodes one path segment; `:` stays literal like browsers send it (`2026-11-02%2009:00`). */
function segment(value: string): string {
  return encodeURIComponent(value).replace(/%3A/gi, ':');
}

/**
 * Generic calls only go to resolved catalog paths: absolute, no query or fragment, no empty or dot
 * segments, so a crafted path can never leave the API base URL or reach another route. A single
 * trailing slash is kept: some Teamso routes are mapped with one (e.g. `GET /dashboard-shortcut/`)
 * and do not answer without it.
 */
function assertApiPath(path: string): void {
  if (!path.startsWith('/') || /[?#\\\s]/.test(path)) throw new Error(`Refusing to call an invalid API path: ${path}`);
  const segments = path.slice(1).split('/');
  if (segments.length > 1 && segments[segments.length - 1] === '') segments.pop();
  if (segments.some(part => part === '' || /^(\.|%2e)+$/i.test(part))) {
    throw new Error(`Refusing to call an invalid API path: ${path}`);
  }
}

/** Reads the body up to `limit` bytes; stops the download and throws as soon as it is exceeded. */
async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  const announced = Number(response.headers.get('content-length'));
  if (Number.isFinite(announced) && announced > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new TeamsoResponseTooLargeError(limit, announced);
  }
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new TeamsoResponseTooLargeError(limit);
    }
    chunks.push(value);
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

function looksLikeJson(data: Uint8Array): boolean {
  const head = new TextDecoder().decode(data.subarray(0, 64)).trimStart();
  return head.startsWith('{') || head.startsWith('[');
}

function formatMegabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
