#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TeamsoClient } from './client.js';
import { createMcpServer } from './server.js';

const accessToken = process.env['TEAMSO_ACCESS_TOKEN']?.trim();
const baseUrl = process.env['TEAMSO_API_BASE_URL']?.trim() || undefined;
const helpBaseUrl = process.env['TEAMSO_HELP_BASE_URL']?.trim() || undefined;

if (!accessToken) {
  console.error(
    'Error: TEAMSO_ACCESS_TOKEN environment variable is required.\n\n' +
    'Set it in your MCP server config:\n\n' +
    '  "env": {\n' +
    '    "TEAMSO_ACCESS_TOKEN": "tms_pat_..."\n' +
    '  }\n\n' +
    'Create a personal access token at https://teamso.com/dashboard/mcp-access',
  );
  process.exit(1);
}

let client: TeamsoClient;
try {
  client = new TeamsoClient(accessToken, baseUrl, { helpBaseUrl });
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const server = createMcpServer(client);
const transport = new StdioServerTransport();

await server.connect(transport);
console.error(`Teamso MCP server running on stdio (api: ${client.baseUrl})`);
