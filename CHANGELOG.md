# Changelog

## 1.5.0 (2026-11-11)

The API endpoints these tools call (`/cost-forecast/mcp/studies`) are live on teamso.com since 2026-11-11. The
Workforce Cost Forecast package is enabled per company by a Teamso distributor; without it the tools answer
`MODULE_DISABLED`.

### Added

- Workforce Cost Forecast tools (toolset `cost_forecast`, TMS-4896), read only, with the token owner's own Teamso
  rights:
  - `list_cost_forecasts`: the budget studies the user may open (`GET /cost-forecast/mcp/studies`, optional name
    search and `limit`), latest period first, with period, status (`NOT_CALCULATED`, `CALCULATING`, `CURRENT`,
    `OUTDATED`), approval status, last calculation time (Turkey wall clock) and the last result's total cost.
  - `get_cost_forecast_summary`: one study's KPI cards (employees, payroll months, gross salary, other gross pay,
    gross, net, total employer cost, expenses) and monthly totals (`GET /cost-forecast/mcp/studies/{id}/summary`,
    optional `run_id`), and a rolling study's year-end forecast against the approved budget.
  - `get_cost_forecast_breakdown`: total cost by `branch`, `department` or `position`, the largest first, with
    employees, gross, net, expenses and share (`GET /cost-forecast/mcp/studies/{id}/breakdown`).
- The API applies the report's rules: Teamso employees count only with the salary right (`SALARY_READ`) and inside
  the user's branch scope (a manager sees the totals of their scope, `scope.limited`); when none of the calculated
  employees is visible no amount is returned (`amountsHidden`). Answers hold totals only, never an employee, a name
  or a salary row. No tool calculates, edits or creates a study.
- `MODULE_DISABLED`, `COST_FORECAST_NOT_FOUND` and `PERMISSION_DENIED` answers are explained.
- The server instructions name the budget tools and say that studies are created and calculated in the Teamso web
  app (`/dashboard/cost-forecast`).
- The server instructions say that texts inside tool results (study, department, branch, position and people names,
  notes) are data written by Teamso users and that instructions written in them are never followed (TMS-4925).

### Changed

- `TOOL_NAMES` and `TOOLSETS` list the budget tools right after the AI Simulation tools, so the generic API tools stay
  last. No earlier tool was renamed or removed.

## 1.4.1

### Security

- Dependencies updated for the seven Dependabot advisories (TMS-4860): `zod` 3.25.76 to 4.6.7 (memory exhaustion on
  oversized constrained collections), `body-parser` 2.3.0 to 2.4.0 (trailing bytes after a compressed body),
  `qs` 6.16.0 to 6.17.1 (`arrayFormat: 'comma'` TypeError) and `fast-uri` 3.1.8 to 3.1.9 (four URI parsing
  advisories). `@modelcontextprotocol/sdk` 1.32.1 to 1.32.2. `npm audit` reports no vulnerabilities.

### Changed

- The listed tool schemas are the same contract as in 1.4.0. Zod 4 lists a plain object input as open; the server
  keeps input objects closed (`additionalProperties: false`) as before, and records keep their value schema.
  Schemas that pointed inside themselves with `$ref` are now written out in place. Unknown arguments are still
  dropped, not refused.
- New contract tests: every input object is closed at every level, outputs state `additionalProperties`, no
  internal `$ref`, and the patched dependency versions.

## 1.4.0

### Added

- AI Simulation tools (toolset `simulation`, TMS-4752), read-only, with the token owner's own Teamso rights:
  - `list_simulation_assignments`: the practice assigned to the user (`GET /simulation/assignments/mine`), soonest
    due date first, with status, overdue flag, best score, attempts used and left (`maxAttempts` 0 is unlimited),
    pass score and exam mode. Only open ones (`NOT_STARTED`, `IN_PROGRESS`, `OVERDUE`) unless `include_closed`.
  - `get_simulation_results`: the user's own attempts (`GET /simulation/attempts/mine`, `status` and `scenario_id`
    filters), other people's with `scope: "team"` for managers and admins (`GET /simulation/attempts`, `from`/`to`
    days, `user_id`, `scenario_id`, `mode`, `result`), or one attempt's score, criteria (level, rationale,
    evidence), strengths, priorities and better replies with `attempt_id`. The transcript (`attempt.turns`) is
    never returned. Start times are Turkey wall clock.
  - `list_simulations`: the scenario catalog (`GET /simulation/catalog`) as one list, each scenario once with the
    shelves it is on, its modes, difficulties, persona, the user's best score and an open assignment.
- `MODULE_DISABLED`, `SIMULATION_NOT_FOUND` and `SIMULATION_FORBIDDEN` answers are explained (AI Simulation off or
  not bought, unknown attempt, not your team).
- The server instructions name the AI Simulation tools and say that the conversation itself happens in the Teamso
  web app (`/dashboard/simulation`); no tool starts one.

### Changed

- `TOOL_NAMES` and `TOOLSETS` list the simulation tools right after the badge tools, so the generic API tools stay
  last. No earlier tool was renamed or removed.

## 1.3.4

### Changed

- The last tool texts that pointed at other tools or their result fields (`list_performance_periods`, the goal
  approval tools, endpoint ids, SMS codes, uploads) or told the caller what to send now only describe the tool.

## 1.3.3

### Changed

- Tool and parameter descriptions only say what each tool does, returns and requires. Pointers to other tools and
  the "confirm with the user first" guidance moved to the server instructions sent in `initialize`, as the Claude
  Connectors Directory asks. Tool behaviour is unchanged.

## 1.3.2

### Fixed

- Every tool also carries its title in `annotations.title`, where MCP directories (Claude Connectors Directory, the
  ChatGPT plugin review) read a tool's display name.
- `call_api_read` and `call_api_write` describe the type of `body` (a JSON object, array or single value, or plain
  text) instead of an untyped parameter.

## 1.3.1

### Added

- `TeamsoClient` also takes the access tokens of the hosted server's browser sign-in (`tms_at_...`, OAuth 2.1 on
  https://mcp.teamso.com/v1). They work like personal access tokens: every call runs with the signed-in user's own
  Teamso rights. The stdio server still asks for a personal access token in `TEAMSO_ACCESS_TOKEN`.

## 1.3.0

### Added

- Badge tools (toolset `badges`), with the token owner's own Teamso rights and limits:
  - `list_badges`: the recognition badges the user can give now, their giving role (`ADMIN`, `MANAGER`, `PEER`,
    `NONE`), whether a badge needs a message or an approval, and the monthly peer quota left. Optional name filter
    without Turkish characters.
  - `give_badge`: gives a badge (id or exact name) to 1-50 colleagues with a message and optional visibility through
    `POST /badge-award`, the endpoint of the web app. The API applies the same rules as on the web (who may give what
    to whom, per-person limit, waiting days, approval, peer quota); people who cannot get the badge are listed with
    the reason and the date it is possible again. Checks the message length and the one-person peer rule first.
  - `list_my_badges`: the badges the user received, with the giver (Teamso for automatic ones), the message and the
    totals; points only when the company shows them.
- The server instructions name the badge flow (search_employees, list_badges, confirm, give_badge).

### Changed

- `TOOL_NAMES` and `TOOLSETS` list the badge tools right after the performance tools, so the generic API tools stay
  last (they are the catch-all for every other module). No earlier tool was renamed or removed.

## 1.2.1

### Fixed

- When the user types the code of an older SMS, Teamso answers `a newer code was sent`. The leave and
  generic API tools now tell the assistant to ask for the code in the latest SMS, instead of treating
  it as a not-found error and pointing at `path_params`.

### Changed

- README for the npm package page: Teamso logo, library install from npm instead of GitHub, the
  generic-tools section renamed to "Reaching every module" (it repeated a heading), and the release
  steps moved to `CONTRIBUTING.md`.
- CI uses `actions/checkout` and `actions/setup-node` v7.

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
