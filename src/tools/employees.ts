import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TeamsoApiError, type TeamsoClient } from '../client.js';
import { markdownTable } from '../utils/format.js';
import { apiErrorResult, toolResult } from '../utils/results.js';
import {
  toEmployeeFromAuthorized,
  toEmployeeFromList,
  toEmployeeProfile,
  type EmployeeSummary,
} from '../utils/structured.js';
import { matchesAllWords } from '../utils/text.js';
import { employeeProfileOutputSchema, employeeSearchOutputSchema } from './schemas.js';
import { READ_ONLY, idSchema } from './shared.js';

export function registerSearchEmployees(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'search_employees',
    {
      title: 'Search employees',
      description: 'Find active colleagues by name or email (Turkish characters optional: "ozturk" '
        + 'finds "Öztürk"). Uses the company directory when the caller may read it (`PEOPLE_READ`), '
        + 'otherwise the employees the caller is responsible for. Use the `id` with '
        + '`get_employee_profile` or as `user_id` in the performance tools.',
      inputSchema: {
        query: z.string().trim().min(2).max(100).describe('Name, surname or email to look for.'),
        limit: z.number().int().min(1).max(50).default(10).describe('Maximum results (1-50, default 10).'),
      },
      outputSchema: employeeSearchOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ query, limit }, extra) => {
      try {
        let source: 'directory' | 'authorized_employees' = 'directory';
        let employees: EmployeeSummary[];
        let total: number;
        try {
          const page = await client.searchUsers({ query, size: limit }, extra.signal);
          employees = (page?.items ?? []).map(toEmployeeFromList);
          total = page?.pagination?.totalRecords ?? employees.length;
        } catch (error) {
          // Without `PEOPLE_READ` the directory answers 403; an IP-allowlist 403
          // would fail the fallback the same way, so report it directly.
          if (!(error instanceof TeamsoApiError) || error.status !== 403
            || error.messageCode === 'IP_NOT_ALLOWED') throw error;
          source = 'authorized_employees';
          const matches = (await client.listAuthorizedEmployees(extra.signal))
            .filter(employee => employee.active !== false)
            .filter(employee => matchesAllWords(
              query,
              employee.fullName,
              employee.name,
              employee.surname,
              employee.email,
              employee.personnelId,
            ));
          total = matches.length;
          employees = matches.slice(0, limit).map(toEmployeeFromAuthorized);
        }

        if (employees.length === 0) {
          return toolResult(`No active employee matched "${query}".`, { query, source, employees, total: 0 });
        }

        const table = markdownTable(
          ['Name', 'Id', 'Email', 'Department', 'Position'],
          employees.map(employee => [
            employee.fullName,
            `\`${employee.id}\``,
            employee.email,
            employee.department,
            employee.position,
          ]),
        );
        const more = total > employees.length ? `\n\nShowing ${employees.length} of ${total}; refine the query for more.` : '';
        return toolResult(`## Employees matching "${query}"\n\n${table}${more}`, {
          query,
          source,
          employees,
          total,
          ...(employees.length === 1
            ? {
              nextAction: {
                tool: 'get_employee_profile',
                arguments: { user_id: employees[0]!.id },
                reason: 'Exactly one match; open the profile for details.',
              },
            }
            : {}),
        });
      } catch (error) {
        return apiErrorResult(error, {
          forbidden: 'Searching employees needs the `PEOPLE_READ` permission or employees you are responsible for.',
        });
      }
    },
  );
}

export function registerGetEmployeeProfile(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'get_employee_profile',
    {
      title: 'Get an employee profile',
      description: 'Return a colleague\'s work profile: branch, department, position, manager, work '
        + 'location and contact details (the phone number is masked unless the caller may read it).',
      inputSchema: {
        user_id: idSchema('Employee id from `search_employees`.'),
      },
      outputSchema: employeeProfileOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ user_id }, extra) => {
      try {
        const employee = toEmployeeProfile(await client.getUserSummary(user_id, extra.signal));
        const lines = [
          `## ${employee.fullName}`,
          '',
          `- **Position:** ${employee.position ?? '-'}`,
          `- **Department:** ${employee.department ?? '-'}`,
          `- **Branch:** ${employee.branch ?? '-'}`,
          `- **Manager:** ${employee.manager?.fullName ?? '-'}`,
          `- **Email:** ${employee.email ?? '-'}`,
          `- **Phone:** ${employee.phone ?? '-'}`,
          `- **Work location:** ${employee.workplace ?? employee.workLocation ?? '-'}`,
        ];
        return toolResult(lines.join('\n'), { employee });
      } catch (error) {
        return apiErrorResult(error, {
          forbidden: 'Viewing employee profiles needs a company user or company admin account.',
          notFound: `No employee \`${user_id}\` exists in your company. Find the id with \`search_employees\`.`,
        });
      }
    },
  );
}
