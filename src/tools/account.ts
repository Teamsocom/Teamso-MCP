import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TeamsoClient } from '../client.js';
import { apiErrorResult, toolResult } from '../utils/results.js';
import { toMe } from '../utils/structured.js';
import { meOutputSchema } from './schemas.js';
import { READ_ONLY } from './shared.js';

export function registerGetMe(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'get_me',
    {
      title: 'Get my Teamso profile',
      description: 'Return the signed-in Teamso user: name, email, company, department, position, '
        + 'manager, roles and permission codes. Use the permission codes to tell which actions '
        + 'the user can take (e.g. `LEAVE_ADD` to request leave, `LEAVE_DELETE` to cancel one).',
      inputSchema: {},
      outputSchema: meOutputSchema,
      annotations: READ_ONLY,
    },
    async (_args, extra) => {
      try {
        const user = toMe(await client.getMe(extra.signal));
        const lines = [
          `## ${user.fullName}`,
          '',
          `- **Email:** ${user.email ?? '-'}`,
          `- **Company:** ${user.company.name ?? '-'}`,
          `- **Department / position:** ${user.department ?? '-'} / ${user.position ?? '-'}`,
          `- **Manager:** ${user.manager?.fullName ?? '-'}`,
          `- **Roles:** ${user.roles.join(', ') || '-'}`,
          `- **Permissions:** ${user.permissions.length}`,
        ];
        return toolResult(lines.join('\n'), { user });
      } catch (error) {
        return apiErrorResult(error);
      }
    },
  );
}
