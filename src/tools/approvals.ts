import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { pathSafeText, type TeamsoClient } from '../client.js';
import type { TeamsoLeave } from '../types.js';
import { formatDateRange, markdownTable } from '../utils/format.js';
import { apiErrorResult, errorResult, toolResult } from '../utils/results.js';
import {
  LEAVE_STATUSES,
  closedPayrollPeriodsOf,
  leaveStatusName,
  toPendingApproval,
} from '../utils/structured.js';
import { scanLeaves } from './leave-support.js';
import { leaveDecisionOutputSchema, pendingApprovalsOutputSchema } from './schemas.js';
import { DESTRUCTIVE_WRITE, READ_ONLY, idSchema } from './shared.js';

const MAX_PENDING = 200;

const LEAVE_LIST_FORBIDDEN = 'Reading leave approvals needs the `LEAVE_ADD`, `LEAVE_ADD_ALL` or `LEAVE_READ_ALL` permission.';

/** Leaves still in the approval chain that the caller may decide right now. */
async function findApprovableLeaves(
  client: TeamsoClient,
  predicate: (leave: TeamsoLeave) => boolean,
  limit: number,
  signal?: AbortSignal,
) {
  return scanLeaves(
    client,
    { searchKey: 'state', searchValue: String(LEAVE_STATUSES.pending_approval) },
    leave => leave.state === LEAVE_STATUSES.pending_approval && leave.canApprove === true && predicate(leave),
    { limit },
    signal,
  );
}

export function registerListPendingApprovals(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_pending_approvals',
    {
      title: 'List leave requests waiting for my approval',
      description: 'List the leave requests that are waiting for the caller\'s decision as the current '
        + 'approver. Decide each one with `approve_or_reject_leave` after the user confirms.',
      inputSchema: {},
      outputSchema: pendingApprovalsOutputSchema,
      annotations: READ_ONLY,
    },
    async (_args, extra) => {
      try {
        const { leaves, truncated } = await findApprovableLeaves(client, () => true, MAX_PENDING, extra.signal);
        const approvals = leaves.map(toPendingApproval);
        if (approvals.length === 0) {
          return toolResult('No leave requests are waiting for your approval.', {
            approvals,
            total: 0,
            truncated,
          });
        }
        const table = markdownTable(
          ['Leave id', 'Employee', 'Type', 'Dates', 'Days', 'Note'],
          approvals.map(approval => [
            `\`${approval.leaveId}\``,
            approval.requester?.fullName,
            approval.leaveTypeName,
            formatDateRange(approval.start, approval.end),
            approval.workingDays,
            approval.description,
          ]),
        );
        return toolResult(`## Waiting for your approval (${approvals.length})\n\n${table}`, {
          approvals,
          total: approvals.length,
          truncated,
          nextAction: {
            tool: 'approve_or_reject_leave',
            arguments: { leave_id: approvals[0]!.leaveId },
            reason: 'Ask the user to approve or reject each request, then pass `approve` '
              + '(and a `reason` when rejecting). Never decide without the user.',
          },
        });
      } catch (error) {
        return apiErrorResult(error, { forbidden: LEAVE_LIST_FORBIDDEN });
      }
    },
  );
}

export function registerApproveOrRejectLeave(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'approve_or_reject_leave',
    {
      title: 'Approve or reject a leave request',
      description: 'Record the caller\'s decision on a leave request waiting for their approval. The '
        + 'request must appear in `list_pending_approvals`. Rejecting needs a `reason`, which the '
        + 'employee sees. The decision cannot be undone, so confirm it with the user first.',
      inputSchema: {
        leave_id: idSchema('Leave request id from `list_pending_approvals`.'),
        approve: z.boolean().describe('`true` to approve, `false` to reject.'),
        reason: z.string().trim().max(500).optional()
          .describe('Required when rejecting: the reason shown to the employee.'),
      },
      outputSchema: leaveDecisionOutputSchema,
      annotations: DESTRUCTIVE_WRITE,
    },
    async ({ leave_id, approve, reason }, extra) => {
      try {
        // The reason travels as a URL path segment; characters the API cannot
        // accept there (slashes, semicolons, percent signs) are dropped, so
        // check what is left.
        if (!approve && !pathSafeText(reason ?? '')) {
          return errorResult('Rejecting a leave request needs a `reason` in words. Ask the user why it is rejected.');
        }

        // The API does not check that the caller is the current approver, so check it here.
        const { leaves } = await findApprovableLeaves(
          client,
          leave => leave.id === leave_id,
          1,
          extra.signal,
        );
        if (!leaves[0]) {
          return errorResult(`Leave request \`${leave_id}\` is not waiting for your decision: it was already `
            + 'decided, is at another approver\'s step, or is not visible to you. '
            + 'Call `list_pending_approvals` for the requests you can decide.');
        }

        const response = await client.respondToLeave(leave_id, approve, reason, extra.signal);
        const updated = isRecord(response.result) ? response.result : {};
        const statusCode = typeof updated.status === 'number' ? updated.status : undefined;
        const status = statusCode === undefined ? (approve ? 'approved' : 'rejected') : leaveStatusName(statusCode);
        const decision = approve ? 'approved' as const : 'rejected' as const;
        const message = approve && statusCode === LEAVE_STATUSES.pending_approval
          ? 'Your approval was recorded; the request moves on to the next approver.'
          : `The leave request was ${decision}.`;
        return toolResult(`## Leave request ${decision}\n\n${message}`, {
          leaveId: leave_id,
          decision,
          status,
          ...(statusCode !== undefined ? { statusCode } : {}),
          ...(reason ? { reason } : {}),
          closedPayrollPeriods: closedPayrollPeriodsOf(updated),
          message,
        });
      } catch (error) {
        return apiErrorResult(error, {
          byCode: {
            ANSWER_ERROR: 'This leave request is no longer waiting for an approval decision.',
          },
          forbidden: LEAVE_LIST_FORBIDDEN,
          notFound: 'Teamso could not find that leave request.',
        });
      }
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
