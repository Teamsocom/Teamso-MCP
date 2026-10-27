import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TeamsoClient } from '../client.js';
import { apiErrorResult, toolResult } from '../utils/results.js';
import { toAnnouncement } from '../utils/structured.js';
import { truncate } from '../utils/text.js';
import { announcementsOutputSchema } from './schemas.js';
import { READ_ONLY } from './shared.js';

const PREVIEW_LENGTH = 400;

export function registerListAnnouncements(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_announcements',
    {
      title: 'List company announcements',
      description: 'List the latest company and shuttle announcements visible to the caller, newest first.',
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(10).describe('Maximum announcements (1-50, default 10).'),
      },
      outputSchema: announcementsOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ limit }, extra) => {
      try {
        const feed = await client.getAnnouncements(extra.signal);
        const all = feed?.announcementListResponseDto ?? [];
        const announcements = all.slice(0, limit).map(toAnnouncement);
        if (announcements.length === 0) {
          return toolResult('There are no announcements.', { announcements, total: 0 });
        }
        const text = announcements
          .map(announcement => [
            `### ${announcement.date ?? 'Undated'}${announcement.sharedBy ? `: ${announcement.sharedBy}` : ''}`,
            '',
            truncate(announcement.text, PREVIEW_LENGTH) || '_(no text)_',
          ].join('\n'))
          .join('\n\n');
        return toolResult(`## Announcements\n\n${text}`, { announcements, total: all.length });
      } catch (error) {
        return apiErrorResult(error);
      }
    },
  );
}
