# Changelog

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
