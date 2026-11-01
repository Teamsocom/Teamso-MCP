<div align="center">

<img src="https://teamso.com/logo/teamso-logo.png" alt="Teamso" width="220" />

# Teamso MCP Server

**Official [MCP](https://modelcontextprotocol.io/) server for [Teamso](https://teamso.com/)**: request leave, handle approvals, find colleagues, manage performance goals, read payslips, search the Teamso help center and reach every other Teamso module through permission-checked generic API tools, from Cursor, Claude, Windsurf, and any MCP-compatible AI assistant.

[![npm](https://img.shields.io/badge/npm-@teamso/teamso--mcp-1a56db?style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/@teamso/teamso-mcp)
[![MCP](https://img.shields.io/badge/MCP-compatible-333?style=for-the-badge)](https://modelcontextprotocol.io/)
[![MIT](https://img.shields.io/badge/license-MIT-6f42c1?style=for-the-badge)](./LICENSE)

[Official MCP Server](https://teamso.com/docs/teamso-mcp-server) · [Self-Hosted MCP](https://teamso.com/docs/mcp-self-hosted) · [Access Tokens](https://teamso.com/dashboard/mcp-access) · [Help Center](https://help.teamso.com/) · [Teamso](https://teamso.com/)

</div>

## Quick Start

Local `npx` and library usage require Node.js 20 or later. The hosted MCP
endpoint does not require a local Node.js installation.

### 1. Create an Access Token

Sign in to Teamso and create a personal access token at
[teamso.com/dashboard/mcp-access](https://teamso.com/dashboard/mcp-access).
The token starts with `tms_pat_` and is shown only once.

### 2. Add to Your AI Assistant

**Cursor**: open MCP settings (`Cmd+Shift+P` → "Open MCP settings") and add:

```json
{
  "mcpServers": {
    "teamso": {
      "command": "npx",
      "args": ["-y", "@teamso/teamso-mcp"],
      "env": {
        "TEAMSO_ACCESS_TOKEN": "tms_pat_your-token"
      }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add teamso -e TEAMSO_ACCESS_TOKEN=tms_pat_your-token -- npx -y @teamso/teamso-mcp
```

Or connect to the hosted server without installing anything:

```bash
claude mcp add --transport http teamso https://mcp.teamso.com/v1 \
  --header "Authorization: Bearer tms_pat_your-token"
```

**Claude Desktop**: add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "teamso": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@teamso/teamso-mcp"],
      "env": {
        "TEAMSO_ACCESS_TOKEN": "tms_pat_your-token"
      }
    }
  }
}
```

**Windsurf**: add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "teamso": {
      "command": "npx",
      "args": ["-y", "@teamso/teamso-mcp"],
      "env": {
        "TEAMSO_ACCESS_TOKEN": "tms_pat_your-token"
      }
    }
  }
}
```

**Other clients**: any client that supports Streamable HTTP can use the hosted
server with a bearer header:

```json
{
  "mcpServers": {
    "teamso": {
      "url": "https://mcp.teamso.com/v1",
      "headers": {
        "Authorization": "Bearer tms_pat_your-token"
      }
    }
  }
}
```

Stdio-only clients can run `npx -y @teamso/teamso-mcp` with
`TEAMSO_ACCESS_TOKEN` in its environment.

### 3. Start Using

Ask your AI assistant:

- *"How many leave days do I have left?"*
- *"Request annual leave from 2 to 4 November"*
- *"Which leave requests are waiting for my approval?"*
- *"Who is Can Öztürk's manager?"*
- *"Show my goals for Q4 2026 and send the drafts for approval"*
- *"Open my September payslip"*
- *"Teamso'da performans hedefi nasıl girilir?"*

## Authentication

Every tool runs as the owner of the personal access token, with exactly the
roles and permissions that user has in Teamso. A tool the user may not use in
the web app fails with a clear permission message here too.

- Create, list and revoke tokens at [teamso.com/dashboard/mcp-access](https://teamso.com/dashboard/mcp-access).
- Tokens of deactivated users stop working immediately; revoked or expired tokens return `401`.
- If your company restricts Teamso to an IP allowlist, requests from `npx`
  come from your own IP address and must be allowed.
- Creating or cancelling a leave request needs an SMS code, exactly like the
  web app: `request_leave_otp` sends it, and the user reads it back to the
  assistant. Each SMS uses company digital credit.
- Token management, password, security settings and API key endpoints cannot
  be called with a personal access token.
- The generic API tools only list and call the endpoints the token owner's own
  Teamso permissions allow: a user without the leave-add permission cannot add
  leave through MCP either.

```
TEAMSO_ACCESS_TOKEN=tms_pat_your-token
```

## Available Tools

### Help center

| Tool | Description |
|------|-------------|
| `search_help_articles` | Search the Teamso user guides (Turkish-insensitive, Turkish suffixes stripped) by query, language, module and role |
| `get_help_article` | Read one guide as Markdown with steps, common problems and related articles |
| `list_help_modules` | Browse the modules that have guides and their article ids |

### Account

| Tool | Description |
|------|-------------|
| `get_me` | Your profile: name, email, company, department, position, manager, roles and permission codes |

### Leave

| Tool | Description |
|------|-------------|
| `list_leave_types` | Leave types you can request, with remaining days and per-type rules |
| `get_my_leave_balance` | Remaining leave days per type |
| `calculate_leave_days` | Working days, return-to-work date and Teamso's pre-check for a planned leave |
| `request_leave_otp` | Send the SMS code needed to create or cancel a leave request (valid 3 minutes) |
| `create_leave_request` | Create a leave request with the SMS code and send it for approval |
| `list_my_leaves` | Your leave requests with status, filterable by dates and status |
| `cancel_leave_request` | Cancel one of your leave requests with the SMS code |

### Approvals

| Tool | Description |
|------|-------------|
| `list_pending_approvals` | Leave requests waiting for your decision |
| `approve_or_reject_leave` | Approve, or reject with a reason, a leave request at your approval step |

### Employees

| Tool | Description |
|------|-------------|
| `search_employees` | Find active colleagues by name or email |
| `get_employee_profile` | A colleague's branch, department, position, manager and contact details |

### Performance

| Tool | Description |
|------|-------------|
| `list_performance_periods` | Periods with dates, target-entry window and evaluation scale |
| `list_my_goals` | Your goals in a period and whether you can add more |
| `list_team_goals` | Goals of the employees you manage, with what you can approve |
| `create_user_goal` | Create a personal goal for yourself or a direct report (performance admins: anyone) |
| `send_goals_to_approval` | Send your draft goals to your manager |
| `approve_goal` | Approve a goal waiting for you |
| `revise_and_approve_goal` | Change a goal's title, details, weight or target and approve it |
| `update_goal_actual_value` | Enter the achieved value of your goal during evaluation |
| `update_manager_actual_value` | Enter your assessment of an employee's goal as their manager |
| `approve_goal_evaluation` | Approve an employee's evaluation for a period |

### Badges

| Tool | Description |
|------|-------------|
| `list_badges` | The recognition badges you can give, your giving role and the peer quota left |
| `give_badge` | Give a badge with a message to one or more colleagues, with your own Teamso rights and limits |
| `list_my_badges` | The badges you have received, who gave them and when |

### Communication

| Tool | Description |
|------|-------------|
| `list_announcements` | Latest company and shuttle announcements |

### Payroll

| Tool | Description |
|------|-------------|
| `list_my_payslips` | Your e-payslips by term with status |
| `get_payslip_pdf` | One payslip as an embedded `application/pdf` resource |

### Generic API tools

| Tool | Description |
|------|-------------|
| `list_api_modules` | Teamso modules with how many API endpoints you can call in each |
| `find_api_endpoints` | Search the endpoints you may call by keywords, module, HTTP method or side effect |
| `describe_api_endpoint` | Parameters, body JSON Schema, response kind, SMS-code and side-effect notes, example arguments |
| `call_api_read` | Run a read-only endpoint; returns JSON (long lists are cut with `truncated: true`) or a file |
| `call_api_write` | Preview, then (with `confirm: true`) run an endpoint that creates, changes or deletes data |
| `request_sms_code` | Send the SMS code an endpoint needs (`request_leave_otp` is the leave-specific alias) |

Leave chain:
`list_leave_types → calculate_leave_days → request_leave_otp → create_leave_request`

Approval chain:
`list_pending_approvals → approve_or_reject_leave`

Goal chain:
`list_performance_periods → list_my_goals → create_user_goal → send_goals_to_approval`

Everything else (expenses, overtime, time tracking, payroll, recruiting,
inventory, documents, settings...):
`find_api_endpoints → describe_api_endpoint → call_api_read` or
`call_api_write (preview) → user confirms → call_api_write confirm: true`

## Reaching every module

The specific tools above cover the most common tasks. Every other Teamso
module is reachable through six generic tools built on the Teamso API's
per-user catalog (`GET /mcp-catalog/endpoints`, `/endpoint`, `/modules`):

- **Only what you may use.** The catalog evaluates each endpoint's permission
  rule for the token owner, so `find_api_endpoints` lists only endpoints the
  user may call, and `describe_api_endpoint` / `call_api_*` refuse every id the
  catalog does not list for that user. There are no free-form URLs: a call is
  always an endpoint id (`"POST /expense-form"`) plus `path_params`, `query`
  and `body`, and the real request still passes Teamso's own permission checks.
  Login, password, token, security-setting, payment and SMS endpoints are never
  listed.
- **Reads are read-only.** `call_api_read` only runs endpoints whose
  `sideEffect` is `read` and sends `X-Teamso-Mcp-Intent: read`, with which the
  API refuses anything that would write (403). `GET` endpoints that do change
  data (`read_with_writes`) must go through `call_api_write`.
- **Writes preview first.** `call_api_write` without `confirm` sends nothing:
  it returns the resolved request, the body checked against the endpoint's JSON
  Schema (ajv, 2020-12; errors listed), delete and SMS warnings and a one-line
  summary. The assistant shows it to the user and repeats the call with
  `confirm: true` only after the user agrees. Invalid requests are never sent.
- **SMS codes.** Endpoints with `smsCodeRequired: always` (or `preVerify`) need
  `otp_code` (`request_sms_code` sends it; the code is verified immediately
  before the call). `conditional` endpoints are called first; when Teamso
  answers `OTP_NOT_DONE` the given `otp_code` is verified and the call retried
  once, otherwise the tool asks for `request_sms_code`.
- **Files.** File responses (PDF, Excel, CSV, images) come back as an embedded
  resource with `mimeType` and file name, up to 8 MB; larger files fail with a
  clear message. Multipart endpoints take `files: [{field, filename,
  content_type, base64}]`, up to 10 files and 10 MB in total.
- **Large results.** JSON results above 40,000 characters are cut to the
  items that fit, with `truncated: true` and a `truncation` object (original
  and returned item counts, how to page). Results are never cut silently.
- **Errors.** Teamso failures, including HTTP 200 responses with a failure
  `message_code`, come back as `isError` results naming the `message_code`.

```text
find_api_endpoints { "query": "masraf", "side_effect": "write" }
describe_api_endpoint { "id": "POST /expense-form/{expenseFormId}/finalize" }
call_api_write { "id": "POST /expense-form/{expenseFormId}/finalize", "path_params": { "expenseFormId": "…" } }   → preview
request_sms_code {}                                                                                                 → user reads the code
call_api_write { …same arguments…, "confirm": true, "otp_code": "123456" }                                          → runs it
```

### Toolsets

`TEAMSO_TOOLSETS` (or the `toolsets` option of `createMcpServer`) limits the
tools a server offers, as a comma-separated list. Default: all tools.

| Toolset | Tools |
|---------|-------|
| `core` | `get_me` |
| `help` | `search_help_articles`, `get_help_article`, `list_help_modules` |
| `leave` | `list_leave_types`, `get_my_leave_balance`, `calculate_leave_days`, `request_leave_otp`, `create_leave_request`, `list_my_leaves`, `cancel_leave_request` |
| `approvals` | `list_pending_approvals`, `approve_or_reject_leave` |
| `employees` | `search_employees`, `get_employee_profile` |
| `performance` | the ten goal and evaluation tools |
| `badges` | `list_badges`, `give_badge`, `list_my_badges` |
| `communication` | `list_announcements` |
| `payroll` | `list_my_payslips`, `get_payslip_pdf` |
| `api` | `find_api_endpoints`, `list_api_modules`, `describe_api_endpoint`, `call_api_read`, `call_api_write`, `request_sms_code` |

An unknown toolset name stops the server with the list of valid names.

```json
"env": {
  "TEAMSO_ACCESS_TOKEN": "tms_pat_...",
  "TEAMSO_TOOLSETS": "core,leave,approvals,api"
}
```

## Prompts

The server also publishes MCP prompts: ready-made starting points that clients
show as slash commands or prompt pickers (`prompts/list`, `prompts/get`). A
prompt only steers the assistant through the tools above; every write still
needs the user's confirmation and, for leave requests, the SMS code.

| Prompt | Arguments | Description |
|--------|-----------|-------------|
| `request_leave` | `start`, `end`, `leave_type`, `note` (all optional) | Create a leave request: `list_leave_types → calculate_leave_days →` confirm with the user `→ request_leave_otp → create_leave_request`. Missing dates are asked for; `end` defaults to `start`, `leave_type` to annual leave |
| `review_pending_approvals` | none | Go through the leave requests waiting for your approval: `list_pending_approvals →` ask the user about each request `→ approve_or_reject_leave` |

Relative dates such as *"tomorrow"* / *"yarın"* are resolved in Turkey time
(`Europe/Istanbul`).

### LLM-friendly responses

All tools publish typed MCP input and output schemas (JSON Schema 2020-12) and
annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
`openWorldHint`). Successful calls return `structuredContent` for reliable
chaining and concise Markdown `content` for clients that only render text.
Failures return `isError: true` with an explanation the assistant can act on
(for example: ask for a new SMS code, or which permission is missing).

Teamso reports many failures with HTTP 200 and `code: 1` (for example
`OTP_NOT_DONE`, `ITEM_NOT_FOUND`, `CREDIT_INSUFFICIENT`). The client checks
`message_code` and turns those into errors, so a tool never reports success
for a request Teamso refused.

When the next step needs another tool, the response includes an executable
`nextAction`:

```json
{
  "request": {
    "leaveTypeId": "lt-annual",
    "leaveTypeName": "Yıllık İzin",
    "start": "2026-11-02 09:00",
    "end": "2026-11-04 18:00",
    "workingDays": 3,
    "returnToWorkDate": "2026-11-05 09:00"
  },
  "remainingDays": 14,
  "remainingAfterRequest": 11,
  "canRequest": true,
  "problems": [],
  "nextAction": {
    "tool": "request_leave_otp",
    "arguments": {},
    "reason": "Creating the request needs an SMS code. After the user confirms these days, send the code, then call create_leave_request with the same leave_type_id, start, end and the otp_code."
  }
}
```

Dates are Turkey local time. Leave dates accept `yyyy-MM-dd` (the leave starts
at your shift start and ends at your shift end, 09:00–18:00 by default) or
`yyyy-MM-dd HH:mm`. Goal and filter dates are `yyyy-MM-dd`.

Write tools never skip Teamso's approval chain, and `approve_or_reject_leave`
only decides requests that are at your own approval step. `create_user_goal`
only creates goals for other people when they report to you directly, or when
you have the performance administrator permission.

The access token is sent only to the Teamso API. It is never written to logs or
error messages, and the help tools download the public help bundle without it.

## Hosted MCP Server

Teamso also provides a hosted MCP server at `https://mcp.teamso.com/v1` that
requires no local installation. It serves the same tools and prompts, plus
Teamso's content tools that run inside the Teamso API. See the
[MCP Server documentation](https://teamso.com/docs/teamso-mcp-server) for setup
instructions.

## Documentation

- [MCP Server (Hosted)](https://teamso.com/docs/teamso-mcp-server): setup guides for Cursor, Claude Code, Claude Desktop, Windsurf and other clients
- [Self-Hosted MCP](https://teamso.com/docs/mcp-self-hosted): run locally with npx, environment variables, library usage
- [Access Tokens](https://teamso.com/dashboard/mcp-access): create and revoke personal access tokens
- [Help Center](https://help.teamso.com/): the user guides behind the help tools

## Using as a Library

This package exports its core components for use in custom MCP servers:

```typescript
import { TeamsoClient } from '@teamso/teamso-mcp/client';
import { createMcpServer } from '@teamso/teamso-mcp/server';

const client = new TeamsoClient('tms_pat_your-token');
const server = createMcpServer(client);
```

A server that forwards end users' requests can sign the caller's IP so Teamso
applies the company IP allowlist and audit log to the real caller. The secret
must match the API's `security.mcp-proxy.shared-secret`:

```typescript
const client = new TeamsoClient(userToken, 'https://api.teamso.com/v1', {
  trustedProxy: { clientIp: request.ip, sharedSecret: process.env.TEAMSO_MCP_PROXY_SECRET! },
});
```

### Exports

| Export | Description |
|--------|-------------|
| `createMcpServer(client, options?)` | Creates an McpServer with all 37 tools and both prompts registered; `options` sets `name`, `version`, `instructions` and `toolsets` |
| `TeamsoClient` | Teamso REST client (personal access token, envelope handling, optional trusted-proxy signing) |
| `TeamsoApiError` | Error with `status`, `messageCode`, `apiMessage` and the response `body` |
| `registerTools(server, client, options?)` | Register the tools (optionally only some `toolsets`) on an existing McpServer |
| `TOOL_NAMES` | Names of the tools this package serves, for routing other names elsewhere |
| `TOOLSETS`, `TOOLSET_NAMES`, `resolveToolsets(selection)` | Tool groups for `TEAMSO_TOOLSETS` and the tools a selection serves |
| `MCP_INTENT_HEADER` | `X-Teamso-Mcp-Intent`; with value `read` the API refuses requests that would write |
| `TeamsoResponseTooLargeError` | Thrown by `TeamsoClient.callApi` when a response exceeds its size limit |
| `registerPrompts(server)` | Register the prompts on an existing McpServer |
| `PROMPT_NAMES` | Names of the prompts this package serves (`request_leave`, `review_pending_approvals`) |
| `withJsonSchema2020_12(transport)` | Rewrites `tools/list` schemas to JSON Schema 2020-12 on any transport |
| `signProxyRequest(input)` | The trusted-proxy signature, for verifiers and tests |
| `VERSION` | Package version |

```typescript
// Import specific components
import { TeamsoClient, TeamsoApiError } from '@teamso/teamso-mcp/client';
import { registerTools, TOOL_NAMES } from '@teamso/teamso-mcp/tools';
import { registerPrompts, PROMPT_NAMES } from '@teamso/teamso-mcp/prompts';
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TEAMSO_ACCESS_TOKEN` | Yes | Your personal access token (`tms_pat_...`) |
| `TEAMSO_API_BASE_URL` | No | Override the API base URL (default: `https://api.teamso.com/v1`) |
| `TEAMSO_HELP_BASE_URL` | No | Site the help articles are downloaded from (default: `https://teamso.com`) |
| `TEAMSO_HELP_PUBLIC_URL` | No | Public site used for help links and images in tool output (default: `TEAMSO_HELP_BASE_URL`). Set it when the download address is internal |
| `TEAMSO_TOOLSETS` | No | Comma-separated toolsets to serve: `core`, `help`, `leave`, `approvals`, `employees`, `performance`, `badges`, `communication`, `payroll`, `api` (default: all) |

## Self-hosting from source

```bash
git clone https://github.com/Teamsocom/Teamso-MCP.git
cd Teamso-MCP
npm ci
npm run build
TEAMSO_ACCESS_TOKEN=tms_pat_your-token node dist/index.js
```

Point your client at the build instead of `npx`:

```json
{
  "mcpServers": {
    "teamso": {
      "command": "node",
      "args": ["/absolute/path/to/Teamso-MCP/dist/index.js"],
      "env": {
        "TEAMSO_ACCESS_TOKEN": "tms_pat_your-token"
      }
    }
  }
}
```

To use it as a library instead, install it from npm: `npm install @teamso/teamso-mcp`.

Run the tests (mocked API, no network) with `npm test`.

## Links

- [Teamso](https://teamso.com)
- [MCP Server documentation](https://teamso.com/docs/teamso-mcp-server)
- [Self-hosted MCP documentation](https://teamso.com/docs/mcp-self-hosted)
- [npm package](https://www.npmjs.com/package/@teamso/teamso-mcp)
- [GitHub repository](https://github.com/Teamsocom/Teamso-MCP)
- [Changelog](./CHANGELOG.md)

## Contributing

Issues and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems
privately as described in [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](./LICENSE) for details.

---

<div align="center">

**Built with ❤️ by the Teamso team**

[teamso.com](https://teamso.com) · [GitHub @Teamsocom](https://github.com/Teamsocom)

</div>
