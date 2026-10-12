# Changelog

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
