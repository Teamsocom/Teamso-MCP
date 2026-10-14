# Changelog

## 1.2.1

### Changed

- README for the npm package page: Teamso logo, library install from npm instead of GitHub, the
  generic-tools section renamed to "Reaching every module" (it repeated a heading), and the release
  steps moved to `CONTRIBUTING.md`. No code changes.

## 1.2.0

### Added

- Generic API tools that make every Teamso module usable through MCP, always with the token owner's own
  Teamso permissions. They are built on the API's per-user catalog (`/mcp-catalog`), which lists only the
  endpoints the caller may call:
  - `find_api_endpoints` (keywords, module, HTTP method, side effect, paging), `list_api_modules` and
    `describe_api_endpoint` (parameters, body JSON Schema, response kind, SMS-code and side-effect notes,
    example arguments).
  - `call_api_read`: runs only `read` endpoints and sends `X-Teamso-Mcp-Intent: read`, so the API refuses
    anything that writes. JSON results over 40,000 characters are cut with `truncated: true` and paging
    hints; files come back as embedded resources (up to 8 MB).
  - `call_api_write`: returns a preview (resolved request, body validated against the endpoint's JSON Schema
    with ajv 2020-12, delete/SMS warnings, one-line summary) and runs only with `confirm: true`. Handles the
    SMS-code flow (`always`, `conditional`, `preVerify`), plain-text bodies and multipart uploads
    (`files`, base64, 10 MB in total). Ids the catalog does not list for the caller are refused; there are
    no free-form URLs.
  - `request_sms_code`: the generic SMS-code tool (`request_leave_otp` stays as the leave alias).
- Toolsets: `TEAMSO_TOOLSETS` / the `toolsets` option of `createMcpServer` and `registerTools`
  (`core`, `help`, `leave`, `approvals`, `employees`, `performance`, `communication`, `payroll`, `api`;
  default all). New exports `TOOLSETS`, `TOOLSET_NAMES`, `resolveToolsets`. `TOOL_NAMES` keeps every
  earlier name in the same order; the six new tools are appended.
- `TeamsoClient`: `listApiEndpoints`, `getApiEndpoint` (cached for a minute), `listApiModules` and
  `callApi`; `MCP_INTENT_HEADER` and `TeamsoResponseTooLargeError` exports.
- Server instructions explain when to use the generic tools, the preview-then-confirm rule, SMS codes and
  files.

### Changed

- `ajv` is now a runtime dependency (request body validation).

### Fixed (found by the local end-to-end run against the real catalog)

- Catalog paths with a trailing slash (30 endpoints, e.g. `GET /document/savedQueryListByMe/`,
  `POST /inventory/`, `GET /dashboard-shortcut/`) were refused as "invalid API path". One trailing slash
  is now kept; empty middle segments and dot segments are still refused.
- Exports sent as `application/octet-stream` (payroll Excel, PDKS records, templates) now carry the type
  of their file name (`.xlsx`, `.pdf`, `.csv`, ...), so clients can open them.
- `call_api_read` explains Teamso's empty-list answers (`GET_ERROR` / `ITEM_NOT_FOUND` with HTTP 200 and no
  data, e.g. `GET /demand/list` with no demands) as "no matching records" instead of a bare failure.
- Server instructions map the Turkish words users say to modules ("talep" = the user's own demands, not
  approvals; "masraf"/"harcama" = expenses; "demirbaş"/"zimmet" = inventory, ...).

### Security (review of the generic API tools)

- Generic API calls no longer follow HTTP redirects. A 3xx answer is reported as `REDIRECT_NOT_FOLLOWED`
  instead of being fetched, so a redirect can never pull a file from another host (internal addresses
  included) into the conversation. The specific tools are unchanged.
- Server instructions say that text inside Teamso records is data written by other people, never
  instructions, and that data is changed only for what the user asked.
- A clear hint for Teamso's new "too many wrong SMS codes" answer: the code is cancelled and a new one is needed.

## 1.1.3

### Fixed

- `create_leave_request` said "sent for approval" even when Teamso approved the leave on the spot (no
  approval step for the user); the message now follows the new leave's status.

### Added

- `createHelpCache()` and the `helpCache` client option: servers that create a client per request share
  one help bundle cache instead of downloading the bundle on every help tool call.

## 1.1.2

### Added

- `TeamsoClient` option `helpPublicUrl` (stdio: `TEAMSO_HELP_PUBLIC_URL`): the public
  site used for every help link and image in tool output. It defaults to
  `helpBaseUrl`, which stays the address the help bundle is downloaded from, so a
  hosted server can download the bundle from an internal mirror (e.g. a loopback
  URL) without that address reaching users.

## 1.1.1

### Fixed

- Goal tools showed no evaluation result: `score` was read from the API's legacy
  `score` column, which Teamso leaves empty. Goals now carry `score` (from
  `scoreValue`), `weightedScore`, `finalScore` and `finalScoreText`; goal lists add
  a Score column and the period score (marked "pending approval" until every goal
  of the employee is COMPLETED).

## 1.1.0

### Added

- MCP prompts `request_leave` (optional `start`, `end`, `leave_type`, `note`;
  walks `list_leave_types → calculate_leave_days →` confirm `→ request_leave_otp
  → create_leave_request`) and `review_pending_approvals` (no arguments;
  `list_pending_approvals →` ask per request `→ approve_or_reject_leave`).
- `PROMPT_NAMES` and `registerPrompts` exports, also on the
  `@teamso/teamso-mcp/prompts` subpath; `createMcpServer` registers the prompts.

### Fixed

- `list_my_leaves`, `cancel_leave_request` and `create_leave_request` now find
  the caller's leaves: the API puts the owner in `user.id` and leaves `userId`
  null.
- Goal summaries show the manager's value and the achievement.

## 1.0.0

First release.

- 28 tools: help center (3), account (1), leave (7), approvals (2), employees (2),
  performance (10), communication (1) and payroll (2).
- `TeamsoClient` with personal access token auth, Teamso envelope handling
  (HTTP 200 failures become `TeamsoApiError`) and optional trusted-proxy
  caller-IP signing.
- Typed input and output schemas, annotations, `structuredContent` and
  `nextAction` hints on every tool; JSON Schema 2020-12 on `tools/list`.
- Write safeguards the API does not enforce on its own: leave decisions only at
  the caller's approval step, goals for others only for direct reports (or
  performance admins), never `approveAndContinue`.
- Dates stay on Turkey wall clock; API instants are shown in `Europe/Istanbul`.
- Stdio binary `teamso-mcp`.
