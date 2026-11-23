import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TeamsoClient } from '../client.js';
import type { TeamsoOnboarding } from '../types.js';
import { toIsoDay } from '../utils/dates.js';
import { markdownTable } from '../utils/format.js';
import { apiErrorResult, toolResult } from '../utils/results.js';
import { compact, optionalNumber, optionalString } from '../utils/structured.js';
import { onboardingCandidatesOutputSchema } from './schemas.js';
import { READ_ONLY } from './shared.js';

const ONBOARDING_USER = 'Needs ONBOARDING_READ, ONBOARDING_ADD or ONBOARDING_APPROVE; only the caller\'s branches.';

type WaitingOn = 'candidate' | 'hr' | 'approver' | 'system' | 'nobody';

/** E-onboarding statuses: what each means and who has to act. */
const STAGES: Record<string, { stage: string; waitingOn: WaitingOn }> = {
  NOT_REQUESTED: { stage: 'Data entry not requested yet', waitingOn: 'hr' },
  AWAITING_DATA_ENTRY: { stage: 'Waiting for the candidate to enter their details', waitingOn: 'candidate' },
  REVISION_PENDING: { stage: 'Sent back to the candidate for corrections', waitingOn: 'candidate' },
  PENDING_APPROVAL: { stage: 'Details entered, waiting for HR', waitingOn: 'hr' },
  APPROVAL_PROCESS: { stage: 'In the approval process', waitingOn: 'approver' },
  MANAGER_APPROVAL_PROCESS: { stage: 'Waiting for the manager\'s approval', waitingOn: 'approver' },
  TRANSFER_PENDING: { stage: 'Approved, being added as an employee', waitingOn: 'system' },
  APPROVED: { stage: 'Approved', waitingOn: 'nobody' },
  REJECT: { stage: 'Rejected', waitingOn: 'nobody' },
  IS_BLACK_LISTED: { stage: 'Blacklisted', waitingOn: 'nobody' },
};
const STATUSES = Object.keys(STAGES) as [string, ...string[]];

function toCandidate(row: TeamsoOnboarding) {
  const status = row.status ?? 'NOT_REQUESTED';
  const meaning = STAGES[status] ?? { stage: status, waitingOn: 'nobody' as const };
  const starts = (row.startDateHistory ?? []).map(item => toIsoDay(item.startDate ?? undefined)).filter(Boolean);
  return compact({
    id: row.id,
    fullName: [row.name, row.secondName, row.surname].map(part => part?.trim()).filter(Boolean).join(' ') || '-',
    branchName: optionalString(row.branch?.name ?? undefined),
    status,
    stage: meaning.stage,
    waitingOn: meaning.waitingOn,
    startDate: starts[starts.length - 1],
    emailConfirmed: row.isConfirmed === true,
    phoneConfirmed: row.isConfirmedPhoneNumber === true,
    approvalStep: optionalNumber(row.approvalQueue) || undefined,
    rejectReason: optionalString(row.rejectReason ?? undefined),
    transferFailed: row.hasTransferFailure === true,
  });
}

export function registerListOnboardingCandidates(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_onboarding_candidates',
    {
      title: 'List e-onboarding candidates',
      description: 'The candidates in e-onboarding (e-karşılama), newest first: their stage, who has to act next '
        + '(candidate, HR, an approver or the system), branch, planned start date, whether e-mail and phone are '
        + `confirmed, and a failed transfer to employees. Archived records are left out. ${ONBOARDING_USER}`,
      inputSchema: {
        status: z.enum(STATUSES).optional().describe('Only this status, e.g. AWAITING_DATA_ENTRY or PENDING_APPROVAL.'),
        waiting_only: z.boolean().default(false).describe('true: only candidates someone still has to act on.'),
        limit: z.number().int().min(1).max(100).default(50).describe('Maximum candidates (1-100, default 50).'),
      },
      outputSchema: onboardingCandidatesOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ status, waiting_only, limit }, extra) => {
      try {
        const page = await client.listOnboardings({ status, size: waiting_only ? 100 : limit }, extra.signal);
        let candidates = (page.items ?? []).filter(row => row.id).map(toCandidate);
        if (waiting_only) candidates = candidates.filter(c => c.waitingOn !== 'nobody' || c.transferFailed);
        const total = waiting_only ? candidates.length : optionalNumber(page.pagination?.totalRecords) ?? candidates.length;
        const shown = candidates.slice(0, limit);
        if (shown.length === 0) {
          return toolResult('No e-onboarding candidate matches these filters.', {
            candidates: shown, total: 0, truncated: false,
          });
        }
        const table = markdownTable(['Candidate', 'Branch', 'Stage', 'Waiting on', 'Start'],
          shown.map(c => [c.fullName, c.branchName, c.transferFailed ? `${c.stage} (transfer failed)` : c.stage,
            c.waitingOn, c.startDate]));
        return toolResult(`## E-onboarding candidates (${total})\n\n${table}`, {
          candidates: shown,
          total,
          truncated: total > shown.length || (page.pagination?.hasNext === true),
        });
      } catch (error) {
        return apiErrorResult(error, { forbidden: ONBOARDING_USER });
      }
    },
  );
}
