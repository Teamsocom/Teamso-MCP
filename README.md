<div align="center">

# Teamso MCP Server

**Official [MCP](https://modelcontextprotocol.io/) server for [Teamso](https://teamso.com/)** — request leave, handle approvals, find colleagues, manage performance goals, read payslips and search the Teamso help center from Cursor, Claude, Windsurf, and any MCP-compatible AI assistant.

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

**Cursor** — open MCP settings (`Cmd+Shift+P` → "Open MCP settings") and add:

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

**Claude Desktop** — add to `claude_desktop_config.json`:

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

**Windsurf** — add to `~/.codeium/windsurf/mcp_config.json`:

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

**Other clients** — any client that supports Streamable HTTP can use the hosted
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

### Communication

| Tool | Description |
|------|-------------|
| `list_announcements` | Latest company and shuttle announcements |

### Payroll

| Tool | Description |
|------|-------------|
| `list_my_payslips` | Your e-payslips by term with status |
| `get_payslip_pdf` | One payslip as an embedded `application/pdf` resource |

Leave chain:
`list_leave_types → calculate_leave_days → request_leave_otp → create_leave_request`

Approval chain:
`list_pending_approvals → approve_or_reject_leave`

Goal chain:
`list_performance_periods → list_my_goals → create_user_goal → send_goals_to_approval`

## Prompts

The server also publishes MCP prompts: ready-made starting points that clients
show as slash commands or prompt pickers (`prompts/list`, `prompts/get`). A
prompt only steers the assistant through the tools above; every write still
needs the user's confirmation and, for leave requests, the SMS code.

| Prompt | Arguments | Description |
|--------|-----------|-------------|
| `request_leave` | `start`, `end`, `leave_type`, `note` (all optional) | Create a leave request: `list_leave_types → calculate_leave_days →` confirm with the user `→ request_leave_otp → create_leave_request`. Missing dates are asked for; `end` defaults to `start`, `leave_type` to annual leave |
| `review_pending_approvals` | — | Go through the leave requests waiting for your approval: `list_pending_approvals →` ask the user about each request `→ approve_or_reject_leave` |

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

- [MCP Server (Hosted)](https://teamso.com/docs/teamso-mcp-server) — setup guides for Cursor, Claude Code, Claude Desktop, Windsurf and other clients
- [Self-Hosted MCP](https://teamso.com/docs/mcp-self-hosted) — run locally with npx, environment variables, library usage
- [Access Tokens](https://teamso.com/dashboard/mcp-access) — create and revoke personal access tokens
- [Help Center](https://help.teamso.com/) — the user guides behind the help tools

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
| `createMcpServer(client, options?)` | Creates an McpServer with all 28 tools and both prompts registered; `options` sets `name`, `version`, `instructions` |
| `TeamsoClient` | Teamso REST client (personal access token, envelope handling, optional trusted-proxy signing) |
| `TeamsoApiError` | Error with `status`, `messageCode`, `apiMessage` and the response `body` |
| `registerTools(server, client)` | Register the tools on an existing McpServer |
| `TOOL_NAMES` | Names of the tools this package serves, for routing other names elsewhere |
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
| `TEAMSO_HELP_BASE_URL` | No | Site that serves the help articles (default: `https://teamso.com`) |

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

The package builds itself on install (`prepare`), so it can also be installed
straight from GitHub: `npm install github:Teamsocom/Teamso-MCP#v1.1.0`.

Run the tests (mocked API, no network) with `npm test`.

## Releasing

1. Bump `version` in `package.json`, add a `CHANGELOG.md` entry, commit and push.
2. Tag `v<version>` and create a GitHub release from it: `.github/workflows/publish.yml` type-checks,
   tests, builds and runs `npm publish --provenance --access public`.
3. An existing tag can be published by hand: `gh workflow run publish.yml -f tag=v1.1.0`.

Authentication is npm trusted publishing (OIDC) once it is configured for `@teamso/teamso-mcp` on
npmjs.com; until then the `NPM_TOKEN` repository secret (an automation token of the `@teamso` npm
organization) is used.

## Links

- [Teamso](https://teamso.com)
- [MCP Server documentation](https://teamso.com/docs/teamso-mcp-server)
- [Self-hosted MCP documentation](https://teamso.com/docs/mcp-self-hosted)
- [npm package](https://www.npmjs.com/package/@teamso/teamso-mcp)
- [GitHub repository](https://github.com/Teamsocom/Teamso-MCP)
- [Changelog](./CHANGELOG.md)

## License

MIT — see [LICENSE](./LICENSE) for details.

---

<div align="center">

**Built by the Teamso team**

[teamso.com](https://teamso.com) · [GitHub @Teamsocom](https://github.com/Teamsocom)

</div>
