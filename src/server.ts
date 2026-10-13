import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { TeamsoClient } from './client.js';
import { registerPrompts } from './prompts/index.js';
import { registerTools, resolveToolsets } from './tools/index.js';
import { withJsonSchema2020_12 } from './utils/json-schema-dialect.js';
import { VERSION } from './version.js';

export {
  CLIENT_HEADER,
  MCP_INTENT_HEADER,
  PROXY_CLIENT_IP_HEADER,
  PROXY_SIGNATURE_HEADER,
  PROXY_TIMESTAMP_HEADER,
  TeamsoApiError,
  TeamsoClient,
  TeamsoResponseTooLargeError,
  createHelpCache,
  isFailureMessageCode,
  signProxyRequest,
} from './client.js';
export type {
  HelpCache,
  ProxySignatureInput,
  TeamsoClientOptions,
  TrustedProxyContext,
} from './client.js';
export { PROMPT_NAMES, registerPrompts } from './prompts/index.js';
export type { PromptName } from './prompts/index.js';
export { TOOLSETS, TOOLSET_NAMES, TOOL_NAMES, registerTools, resolveToolsets } from './tools/index.js';
export type { RegisterToolsOptions, ToolName, ToolsetName } from './tools/index.js';
export {
  JSON_SCHEMA_2020_12,
  normalizeOutgoingMessage,
  toJsonSchema2020_12,
  withJsonSchema2020_12,
} from './utils/json-schema-dialect.js';
export { VERSION } from './version.js';
export type * from './types.js';

export const DEFAULT_SERVER_NAME = 'teamso-mcp';

export const DEFAULT_INSTRUCTIONS = [
  'Teamso is an HR platform. These tools act as the signed-in Teamso user, with their permissions.',
  'For "how do I ... in Teamso" questions, call search_help_articles, then get_help_article, and cite the article url.',
  'Leave: list_leave_types → calculate_leave_days → confirm with the user → request_leave_otp (sends an SMS code) '
    + '→ ask the user for the code → create_leave_request. Cancelling also needs a fresh SMS code. '
    + 'Dates are Turkey local time (yyyy-MM-dd or yyyy-MM-dd HH:mm).',
  'Prompts: request_leave and review_pending_approvals walk through these flows.',
  'Approvals: list_pending_approvals → approve_or_reject_leave (a rejection needs a reason).',
  'Goals use the period title from list_performance_periods.',
  'Confirm every write (leave requests, cancellations, approvals, goal changes) with the user before calling it, '
    + 'and follow structuredContent.nextAction when present.',
  'Everything else in Teamso (expenses, overtime, time tracking, payroll, recruiting, inventory, documents, '
    + 'settings...): prefer a specific tool above when one fits; otherwise find_api_endpoints (or list_api_modules) '
    + '→ describe_api_endpoint → call_api_read for reads, or call_api_write for changes. '
    + 'Only endpoints the user\'s own Teamso permissions allow are listed and callable.',
  'call_api_write without confirm returns a preview and sends nothing: show the preview to the user and call again '
    + 'with confirm=true only after the user explicitly agrees. Never set confirm=true on your own.',
  'SMS codes: when an endpoint needs one (smsCodeRequired), after the user confirms call request_sms_code, ask the user '
    + 'for the code and pass it as otp_code with confirm=true within 3 minutes. If Teamso answers OTP_NOT_DONE, do the '
    + 'same and retry.',
  'Files: file responses come back as embedded resources (up to 8 MB); uploads go in call_api_write files as base64 '
    + '(10 MB total). Large lists are cut with truncated=true: page or filter and call again.',
].join('\n');

export interface CreateMcpServerOptions {
  /** Server name reported in `initialize` (default `teamso-mcp`). */
  name?: string;
  /** Server version reported in `initialize` (default: this package's version). */
  version?: string;
  /** Usage instructions sent to the client in `initialize`. */
  instructions?: string;
  /**
   * Tool groups to serve (`core`, `help`, `leave`, `approvals`, `employees`, `performance`,
   * `communication`, `payroll`, `api`), as an array or a comma-separated list. Default: all.
   */
  toolsets?: string | readonly string[];
}

export function createMcpServer(client: TeamsoClient, options: CreateMcpServerOptions = {}): McpServer {
  // Validate the selection before anything is built, so a typo fails fast.
  resolveToolsets(options.toolsets);
  const server = new McpServer(
    {
      name: options.name ?? DEFAULT_SERVER_NAME,
      version: options.version ?? VERSION,
    },
    {
      instructions: options.instructions ?? DEFAULT_INSTRUCTIONS,
    },
  );

  registerTools(server, client, { toolsets: options.toolsets });
  registerPrompts(server);

  // Claude and other 2020-12-only MCP clients reject the SDK's draft-07 $schema.
  const originalConnect = server.connect.bind(server);
  server.connect = (transport: Transport) =>
    originalConnect(withJsonSchema2020_12(transport));

  return server;
}
