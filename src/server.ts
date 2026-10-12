import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { TeamsoClient } from './client.js';
import { registerPrompts } from './prompts/index.js';
import { registerTools } from './tools/index.js';
import { withJsonSchema2020_12 } from './utils/json-schema-dialect.js';
import { VERSION } from './version.js';

export {
  CLIENT_HEADER,
  PROXY_CLIENT_IP_HEADER,
  PROXY_SIGNATURE_HEADER,
  PROXY_TIMESTAMP_HEADER,
  TeamsoApiError,
  TeamsoClient,
  isFailureMessageCode,
  signProxyRequest,
} from './client.js';
export type {
  ProxySignatureInput,
  TeamsoClientOptions,
  TrustedProxyContext,
} from './client.js';
export { PROMPT_NAMES, registerPrompts } from './prompts/index.js';
export type { PromptName } from './prompts/index.js';
export { TOOL_NAMES, registerTools } from './tools/index.js';
export type { ToolName } from './tools/index.js';
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
].join('\n');

export interface CreateMcpServerOptions {
  /** Server name reported in `initialize` (default `teamso-mcp`). */
  name?: string;
  /** Server version reported in `initialize` (default: this package's version). */
  version?: string;
  /** Usage instructions sent to the client in `initialize`. */
  instructions?: string;
}

export function createMcpServer(client: TeamsoClient, options: CreateMcpServerOptions = {}): McpServer {
  const server = new McpServer(
    {
      name: options.name ?? DEFAULT_SERVER_NAME,
      version: options.version ?? VERSION,
    },
    {
      instructions: options.instructions ?? DEFAULT_INSTRUCTIONS,
    },
  );

  registerTools(server, client);
  registerPrompts(server);

  // Claude and other 2020-12-only MCP clients reject the SDK's draft-07 $schema.
  const originalConnect = server.connect.bind(server);
  server.connect = (transport: Transport) =>
    originalConnect(withJsonSchema2020_12(transport));

  return server;
}
