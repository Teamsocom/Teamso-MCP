import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TeamsoClient } from '../client.js';
import { markdownTable } from '../utils/format.js';
import { apiErrorResult, errorResult, toolResult } from '../utils/results.js';
import { compact, optionalNumber, optionalString } from '../utils/structured.js';
import { myShiftsOutputSchema } from './schemas.js';
import { READ_ONLY } from './shared.js';
import { daySchema, refusalText } from './workforce-support.js';

export function registerListMyShifts(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_my_shifts',
    {
      title: 'List my shifts',
      description: 'The caller\'s own shift plan: the shifts their planner has shared, day by day, with start and end '
        + 'times, breaks, branch and note (default today and the next 13 days, at most 62 days). Drafts the planner '
        + 'has not shared are not listed. Every employee of a company using shift planning reads their own plan; '
        + 'nobody else\'s.',
      inputSchema: {
        from: daySchema('First day (yyyy-MM-dd, default today).').optional(),
        to: daySchema('Last day (yyyy-MM-dd, default 13 days after `from`).').optional(),
      },
      outputSchema: myShiftsOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ from, to }, extra) => {
      try {
        const answer = await client.listMyShifts({ startDate: from, endDate: to }, extra.signal);
        const shifts = (answer.shifts ?? []).filter(s => s.id && s.date).map(s => compact({
          id: s.id!,
          date: s.date!,
          dayName: optionalString(s.dayName),
          working: s.working !== false,
          start: optionalString(s.start),
          end: optionalString(s.end),
          overnight: s.overnight === true,
          workingType: optionalString(s.workingType),
          branchName: optionalString(s.branchName),
          note: optionalString(s.note),
          breaks: (s.breaks ?? []).map(b => compact({ start: optionalString(b.start), end: optionalString(b.end) })),
        }));
        const range = { from: answer.from ?? from ?? '-', to: answer.to ?? to ?? '-' };
        if (shifts.length === 0) {
          return toolResult(`No shared shift between ${range.from} and ${range.to}.`, { ...range, shifts, total: 0 });
        }
        const table = markdownTable(['Day', 'Hours', 'Breaks', 'Branch', 'Note'], shifts.map(s => [
          s.date,
          s.working ? `${s.start ?? '-'} - ${s.end ?? '-'}${s.overnight ? ' (night)' : ''}` : 'Day off',
          s.breaks.map(b => `${b.start ?? '-'}-${b.end ?? '-'}`).join(', '),
          s.branchName,
          s.note,
        ]));
        return toolResult(`## My shifts ${range.from} → ${range.to}\n\n${table}`, {
          ...range,
          shifts,
          total: optionalNumber(answer.total) ?? shifts.length,
        });
      } catch (error) {
        const refusal = refusalText(error, {
          INVALID_DATES: 'Give `from` and `to` as yyyy-MM-dd, with `to` not before `from`.',
          RANGE_TOO_LONG: 'At most 62 days can be listed at once.',
        });
        if (refusal) return errorResult(refusal);
        return apiErrorResult(error, {
          forbidden: 'Shift planning is not open for your account or company.',
        });
      }
    },
  );
}
