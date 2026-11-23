import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TeamsoClient } from '../client.js';
import { toIsoDay, toWallClock } from '../utils/dates.js';
import { markdownTable } from '../utils/format.js';
import { apiErrorResult, toolResult, type ApiErrorHints } from '../utils/results.js';
import { compact, optionalNumber, optionalString } from '../utils/structured.js';
import { jobCandidatesOutputSchema, jobPostingsOutputSchema } from './schemas.js';
import { READ_ONLY, idSchema } from './shared.js';

const ATS_USER = 'Needs the recruiting (ATS) admin or hiring responsibility.';

const ATS_HINTS: ApiErrorHints = {
  forbidden: ATS_USER,
  byCode: {
    INVALID_DATA: 'Teamso could not find that job posting in your company.',
  },
};

const POSTING_STATUSES = ['ACTIVE', 'PASSIVE', 'DRAFT', 'STOPPED', 'CLOSED'] as const;
const CANDIDATE_STATUSES = ['NEWCANDIDATE', 'INTERVIEW', 'HIRED', 'REJECTED', 'NEGATIVE', 'ARCHIVE'] as const;

/** The pseudo posting the list puts first: every candidate of the company. */
const ALL_CANDIDATES_ID = '0';

export function registerListJobPostings(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_job_postings',
    {
      title: 'List job postings',
      description: 'The company\'s job postings (iş ilanları) with their status, number of applicants, location, work '
        + `model and how long they have been published, plus the total number of candidates. ${ATS_USER}`,
      inputSchema: {
        status: z.enum(POSTING_STATUSES).optional().describe('Only postings in this status (ACTIVE = published).'),
        position: z.string().trim().min(1).max(100).optional().describe('Only postings whose position contains this.'),
      },
      outputSchema: jobPostingsOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ status, position }, extra) => {
      try {
        const rows = await client.listJobPostings({ status, position }, extra.signal);
        const all = rows.find(row => row.id === ALL_CANDIDATES_ID);
        const postings = rows.filter(row => row.id && row.id !== ALL_CANDIDATES_ID).map(row => compact({
          id: row.id,
          position: optionalString(row.positionName ?? undefined) ?? '-',
          status: row.status ?? '-',
          applicants: optionalNumber(row.candidateCount) ?? 0,
          location: optionalString(row.location ?? undefined),
          workModel: optionalString(row.workModel ?? undefined),
          workingType: optionalString(row.workingType ?? undefined),
          departments: (row.departmentNames ?? []).filter(Boolean),
          publishedOn: toIsoDay(Array.isArray(row.sharedDate) ? toWallClock(row.sharedDate) : row.sharedDate ?? undefined),
          daysOpen: optionalNumber(row.daysSinceShared ?? undefined),
        }));
        const allCandidates = optionalNumber(all?.candidateCount);
        if (postings.length === 0) {
          return toolResult('No job posting matches these filters.', compact({ postings, allCandidates, total: 0 }));
        }
        const table = markdownTable(['Position', 'Id', 'Status', 'Applicants', 'Location', 'Days open'],
          postings.map(p => [p.position, `\`${p.id}\``, p.status, p.applicants, p.location, p.daysOpen]));
        const busiest = [...postings].sort((a, b) => b.applicants - a.applicants)[0]!;
        return toolResult(`## Job postings (${postings.length})\n\n${table}`, compact({
          postings,
          allCandidates,
          total: postings.length,
          nextAction: {
            tool: 'list_job_candidates',
            arguments: { job_posting_id: busiest.id },
            reason: 'List the applicants of a posting with their stage and AI score.',
          },
        }));
      } catch (error) {
        return apiErrorResult(error, ATS_HINTS);
      }
    },
  );
}

export function registerListJobCandidates(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_job_candidates',
    {
      title: 'List the candidates of a job posting',
      description: 'The applicants of one job posting, newest first, with their stage in this posting (NEWCANDIDATE, '
        + 'INTERVIEW, HIRED, REJECTED, NEGATIVE, ARCHIVE), CV score, AI criteria fit, location and experience, plus '
        + `the number of applicants in each stage. No contact details are returned. ${ATS_USER}`,
      inputSchema: {
        job_posting_id: idSchema('Job posting id.'),
        status: z.enum(CANDIDATE_STATUSES).optional().describe('Only candidates in this stage.'),
        limit: z.number().int().min(1).max(100).default(20).describe('Maximum candidates (1-100, default 20).'),
      },
      outputSchema: jobCandidatesOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ job_posting_id, status, limit }, extra) => {
      try {
        const page = await client.listJobCandidates(job_posting_id, { status, size: limit }, extra.signal);
        const items = (page.items ?? []).filter(row => row.id);
        const candidates = items.map(row => compact({
          id: row.id,
          fullName: [row.name, row.surname].map(part => part?.trim()).filter(Boolean).join(' ') || '-',
          status: optionalString(row.status ?? undefined),
          subStatus: optionalString(row.subStatus ?? undefined),
          cvScore: optionalNumber(row.cvScore ?? undefined),
          criteriaFit: optionalNumber(row.criteriaFit ?? undefined),
          location: optionalString(row.location ?? undefined),
          experience: optionalString(row.experience ?? undefined),
          favorite: row.isFavorite === true,
          appliedAt: toWallClock(row.createdAt),
        }));
        const stageCounts: Record<string, number> = {};
        for (const [key, value] of Object.entries(page.filters?.statusCounts ?? {})) {
          const n = optionalNumber(value);
          if (n !== undefined) stageCounts[key] = n;
        }
        const total = optionalNumber(page.pagination?.totalRecords) ?? candidates.length;
        if (candidates.length === 0) {
          return toolResult('No candidate in this posting for these filters.', {
            jobPostingId: job_posting_id, candidates, stageCounts, total: 0, truncated: false,
          });
        }
        const table = markdownTable(['Candidate', 'Stage', 'CV score', 'Criteria fit', 'Applied'],
          candidates.map(c => [c.fullName, c.subStatus ? `${c.status} / ${c.subStatus}` : c.status, c.cvScore,
            c.criteriaFit, c.appliedAt]));
        const stages = Object.entries(stageCounts).filter(([key]) => !['ALL', 'FAVORITE', 'RESERVED'].includes(key))
          .map(([key, value]) => `${key} ${value}`).join(' · ');
        return toolResult(`## Candidates (${total})\n\n${stages ? `${stages}\n\n` : ''}${table}`, {
          jobPostingId: job_posting_id,
          candidates,
          stageCounts,
          total,
          truncated: total > candidates.length,
        });
      } catch (error) {
        return apiErrorResult(error, ATS_HINTS);
      }
    },
  );
}
