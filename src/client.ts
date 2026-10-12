import crypto from 'node:crypto';
import net from 'node:net';
import type {
  HelpBundle,
  HelpLanguage,
  TeamsoAnnouncementFeed,
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

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
type QueryValue = string | number | boolean | undefined | null;

interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal;
  accept?: string;
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
      url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#accessToken}`,
      Accept: options.accept ?? 'application/json',
      [CLIENT_HEADER]: `teamso-mcp/${VERSION}`,
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

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
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: withTimeout(options.signal, this.timeoutMs),
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
