import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TeamsoApiError, type TeamsoClient } from '../client.js';
import type {
  TeamsoGoal,
  TeamsoGoalPage,
  TeamsoGoalProgressCard,
  TeamsoGoalProgressEntry,
  TeamsoGoalProgressRequest,
  TeamsoGoalRequest,
  TeamsoGoalScore,
  TeamsoPerformancePeriod,
  TeamsoTargetValueDefinition,
  TeamsoUser,
} from '../types.js';
import { markdownTable } from '../utils/format.js';
import {
  ToolInputError,
  apiErrorResult,
  errorResult,
  toolResult,
  type ApiErrorHints,
} from '../utils/results.js';
import {
  TARGETED_PERFORMANCE_KEY,
  toGoal,
  toPerformancePeriod,
  type GoalProjection,
} from '../utils/structured.js';
import { normalizeSearchText } from '../utils/text.js';
import {
  evaluationApprovalOutputSchema,
  goalListOutputSchema,
  goalOutputSchema,
  goalProgressOutputSchema,
  goalsSentOutputSchema,
  performancePeriodsOutputSchema,
} from './schemas.js';
import {
  ADDITIVE_WRITE,
  DESTRUCTIVE_WRITE,
  GOAL_STATUSES,
  READ_ONLY,
  SCALE_CRITERIA,
  idSchema,
  periodSchema,
} from './shared.js';

import { confirmSchema, refusalText } from './workforce-support.js';

const GOAL_PAGE_SIZE = 100;
const MAX_GOAL_PAGES = 5;
/** Permission that lets a user manage every employee's goals (`PerformanceConstants.PERMISSION_ADMIN`). */
const PERFORMANCE_ADMIN_PERMISSION = 'PERFORMANCE_MANAGEMENT_ADMIN';
/** Label the web app stores for the target score. */
const TARGETED_PERFORMANCE_TEXT = 'Hedeflenen Performans';

const GOAL_HINTS: ApiErrorHints = {
  byCode: {
    GOAL_NOT_APPROVABLE: 'This goal is not waiting for approval.',
    NOT_AUTHORIZED_TO_APPROVE: 'You are not the approver of this goal at its current step.',
    NOT_AUTHORIZED: 'Only the goal owner (actual value) or their manager or an admin (manager value) can do this.',
    NO_PENDING_GOALS: 'None of these goals is a draft (`PENDING`) goal of yours, so nothing was sent.',
    GOAL_NOT_PENDING: 'Only draft (`PENDING`) goals can be sent for approval.',
    NOT_YOUR_GOAL: 'You can only send your own goals for approval.',
    GOAL_NOT_EVALUATING: 'Actual values can only be entered while the goal is being evaluated '
      + '(`EVALUATING` or `EVALUATED`), after the period\'s target entry window has closed.',
    GOAL_NOT_IN_VALID_STATUS_FOR_MANAGER_VALUE: 'The manager value cannot be entered at this goal\'s current status.',
    ACTUAL_VALUE_OR_TEXT_REQUIRED: 'Send either a numeric value or a text value.',
    NO_GOALS_IN_APPROVAL_PROCESS: 'This employee has no goal evaluation waiting for approval in that period.',
    USER_ID_REQUIRED: 'The goal owner (`user_id`) is required.',
    INVALID_SCALE_CRITERION: `\`scale_criterion\` must be one of ${SCALE_CRITERIA.join(', ')}.`,
    USER_NOT_FOUND: 'No such employee exists in your company. Find the id with `search_employees`.',
  },
  notFound: 'Teamso could not find that goal, or it is not visible to you.',
};

export function registerListPerformancePeriods(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_performance_periods',
    {
      title: 'List performance periods',
      description: 'List the company\'s performance periods with their titles, dates, target-entry window, '
        + 'who enters goals and the evaluation scale.',
      inputSchema: {},
      outputSchema: performancePeriodsOutputSchema,
      annotations: READ_ONLY,
    },
    async (_args, extra) => {
      try {
        const settings = await client.getPerformanceSettings(extra.signal);
        const periods = (settings?.periods ?? []).map(toPerformancePeriod);
        if (periods.length === 0) {
          return toolResult('No performance periods are defined yet.', { periods });
        }
        const table = markdownTable(
          ['Period', 'Status', 'Dates', 'Target entry', 'Goals entered by'],
          periods.map(period => [
            period.title,
            period.status,
            `${period.startDate ?? '?'} → ${period.endDate ?? '?'}`,
            period.targetEntryOpen
              ? `open until ${period.targetEntryEndDate ?? '?'}`
              : period.targetEntryLocked ? 'closed' : `opens ${period.targetEntryStartDate ?? '?'}`,
            period.goalEntryBy,
          ]),
        );
        return toolResult(`## Performance periods\n\n${table}`, { periods });
      } catch (error) {
        return apiErrorResult(error);
      }
    },
  );
}

export function registerListMyGoals(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_my_goals',
    {
      title: 'List my goals',
      description: 'List the caller\'s own goals in a performance period with ids, status, weight, target '
        + 'and actual values. `canEnterActualValue` and `canAddGoal` tell whether the caller may enter an '
        + 'actual value or add a goal now.',
      inputSchema: {
        period: periodSchema,
      },
      outputSchema: goalListOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ period }, extra) => {
      try {
        const { title, pages } = await collectPeriodGoals(
          client,
          period,
          (periodName, page) => client.listMyGoals({ periodName, page, size: GOAL_PAGE_SIZE }, extra.signal),
          extra.signal,
        );

        const goals = pages.goals.map(toGoal);
        const pending = goals.filter(goal => goal.status === 'PENDING');
        return toolResult(goalListText(`My goals: ${title}`, goals, pages.canAddGoal), {
          period: title,
          canAddGoal: pages.canAddGoal,
          goals,
          total: goals.length,
          ...(pending.length
            ? {
              nextAction: {
                tool: 'send_goals_to_approval',
                arguments: { goal_ids: pending.map(goal => goal.id) },
                reason: 'Draft goals are not visible to the manager until they are sent for approval. Confirm with the user first.',
              },
            }
            : {}),
        });
      } catch (error) {
        return apiErrorResult(error, GOAL_HINTS);
      }
    },
  );
}

export function registerListTeamGoals(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_team_goals',
    {
      title: 'List my team\'s goals',
      description: 'List the goals of the employees the caller manages or assigned goals to, in a '
        + 'performance period (drafts are not shown). Each goal carries `canApproveGoal`, `canReviseGoal` '
        + 'and `canApproveEvaluation`, which tell what the caller may do with it.',
      inputSchema: {
        period: periodSchema,
        status: z.enum(GOAL_STATUSES).optional().describe('Only goals in this status.'),
      },
      outputSchema: goalListOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ period, status }, extra) => {
      try {
        const { title, pages } = await collectPeriodGoals(
          client,
          period,
          (periodName, page) => client.listAssignedGoals(
            { periodName, status, page, size: GOAL_PAGE_SIZE },
            extra.signal,
          ),
          extra.signal,
        );

        const goals = pages.goals.map(toGoal);
        const awaiting = goals.find(goal => goal.canApproveGoal);
        return toolResult(goalListText(`Team goals: ${title}`, goals, pages.canAddGoal, true), {
          period: title,
          canAddGoal: pages.canAddGoal,
          goals,
          total: goals.length,
          ...(awaiting
            ? {
              nextAction: {
                tool: 'approve_goal',
                arguments: { goal_id: awaiting.id },
                reason: 'This goal is waiting for your approval. Confirm with the user, or use revise_and_approve_goal to change it first.',
              },
            }
            : {}),
        });
      } catch (error) {
        return apiErrorResult(error, GOAL_HINTS);
      }
    },
  );
}

export function registerCreateUserGoal(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'create_user_goal',
    {
      title: 'Create a personal goal',
      description: 'Create a personal goal in a performance period for the caller, or for a direct report '
        + '(`user_id`; performance admins may set goals for anyone). The goal starts as a draft '
        + '(`PENDING`). Teamso expects the weights of a person\'s goals to total 100.',
      inputSchema: {
        period: periodSchema,
        name: z.string().trim().min(1).max(255).describe('Goal title.'),
        scale_criterion: z.enum(SCALE_CRITERIA)
          .describe('How the goal is measured. `OTHER` is a free-text goal without weight or numeric target.'),
        weight: z.number().gt(0).max(100).optional()
          .describe('Weight in percent (required unless `scale_criterion` is `OTHER`).'),
        target_value: z.number().optional()
          .describe('Numeric target, e.g. 120 (required unless `scale_criterion` is `OTHER`).'),
        currency: z.string().trim().regex(/^[A-Za-z]{3}$/).optional()
          .describe('ISO currency code for `CURRENCY` goals, e.g. `TRY`.'),
        other_text: z.string().trim().max(1000).optional()
          .describe('Expected outcome, required for `OTHER` goals.'),
        description: z.string().trim().max(2000).optional().describe('Details of the goal.'),
        user_id: idSchema('Goal owner\'s employee id; defaults to the caller. Another employee must report '
          + 'to the caller directly.').optional(),
      },
      outputSchema: goalOutputSchema,
      annotations: ADDITIVE_WRITE,
    },
    async (args, extra) => {
      try {
        const scale = args.scale_criterion;
        if (scale === 'OTHER' && !args.other_text) {
          throw new ToolInputError('`other_text` is required for `OTHER` goals.');
        }
        if (scale !== 'OTHER' && args.weight === undefined) {
          throw new ToolInputError('`weight` is required unless `scale_criterion` is `OTHER`.');
        }
        if (scale !== 'OTHER' && (args.target_value === undefined || args.target_value === 0)) {
          throw new ToolInputError('A non-zero `target_value` is required unless `scale_criterion` is `OTHER`.');
        }
        if (scale === 'CURRENCY' && !args.currency) {
          throw new ToolInputError('`currency` is required for `CURRENCY` goals, e.g. `TRY`.');
        }

        const [me, settings] = await Promise.all([
          client.getMe(extra.signal),
          client.getPerformanceSettings(extra.signal),
        ]);
        const period = resolvePeriod(settings?.periods ?? [], args.period);
        const userId = args.user_id ?? me.id;
        const forSelf = userId === me.id;
        if (!forSelf) await assertCanSetGoalsFor(client, me, userId, extra.signal);
        const page = forSelf
          ? await client.listMyGoals({ periodName: period.title, size: 1 }, extra.signal)
          : await client.listAssignedGoals({ periodName: period.title, size: 1 }, extra.signal);
        if (page?.canAddGoal === false) {
          return errorResult(forSelf
            ? `You cannot add goals for yourself in "${period.title}" (goal entry is closed, or goals are entered by managers).`
            : `You cannot add goals for other employees in "${period.title}" (goal entry is closed, or you are not their manager).`);
        }

        const request: TeamsoGoalRequest = {
          userId,
          name: args.name,
          ...(args.description ? { description: args.description } : {}),
          type: 'PERSONAL',
          ...(scale !== 'OTHER' ? { weight: args.weight } : {}),
          periodName: period.title,
          ...periodDates(period),
          targetValueDefinition: targetDefinition(period, scale, args),
        };
        const goal = toGoal(await client.createGoal(request, extra.signal));
        const message = `Goal "${goal.name}" was created as ${goal.status}.`;
        return toolResult(`## Goal created\n\n${goalLine(goal)}\n\n${message}`, {
          goal,
          message,
          ...(goal.status === 'PENDING' && forSelf
            ? {
              nextAction: {
                tool: 'send_goals_to_approval',
                arguments: { goal_ids: [goal.id] },
                reason: 'The goal is a draft until it is sent to the manager for approval.',
              },
            }
            : {}),
        });
      } catch (error) {
        return apiErrorResult(error, GOAL_HINTS);
      }
    },
  );
}

export function registerSendGoalsToApproval(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'send_goals_to_approval',
    {
      title: 'Send my goals for approval',
      description: 'Send the caller\'s draft (`PENDING`) goals to their manager for approval. Other '
        + 'goals in the list are ignored.',
      inputSchema: {
        goal_ids: z.array(idSchema('Goal id.')).min(1).max(100)
          .describe('Ids of the caller\'s draft goals.'),
      },
      outputSchema: goalsSentOutputSchema,
      annotations: ADDITIVE_WRITE,
    },
    async ({ goal_ids }, extra) => {
      try {
        const response = await client.sendGoalsToApproval(goal_ids, extra.signal);
        const goals = (Array.isArray(response.result) ? response.result as TeamsoGoal[] : []).map(toGoal);
        const message = `${goals.length || goal_ids.length} goal(s) sent for approval.`;
        return toolResult(`## Goals sent for approval\n\n${goals.map(goalLine).join('\n') || message}\n\n${message}`, {
          goals,
          message,
        });
      } catch (error) {
        return apiErrorResult(error, GOAL_HINTS);
      }
    },
  );
}

export function registerApproveGoal(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'approve_goal',
    {
      title: 'Approve a goal',
      description: 'Approve, without changes, a goal waiting for the caller\'s approval.',
      inputSchema: {
        goal_id: idSchema('Id of a goal of an employee the caller manages.'),
      },
      outputSchema: goalOutputSchema,
      annotations: ADDITIVE_WRITE,
    },
    async ({ goal_id }, extra) => {
      try {
        const response = await client.approveGoal(goal_id, extra.signal);
        return goalMutationResult(response.result, goal_id, 'Goal approved', client, extra.signal);
      } catch (error) {
        return apiErrorResult(error, GOAL_HINTS);
      }
    },
  );
}

export function registerReviseAndApproveGoal(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'revise_and_approve_goal',
    {
      title: 'Revise and approve a goal',
      description: 'Change a goal waiting for the caller\'s approval and approve it in one step. Only the '
        + 'fields given are changed; the employee sees the revision.',
      inputSchema: {
        goal_id: idSchema('Id of a goal of an employee the caller manages.'),
        name: z.string().trim().min(1).max(255).optional().describe('New goal title.'),
        description: z.string().trim().max(2000).optional().describe('New details.'),
        weight: z.number().gt(0).max(100).optional().describe('New weight in percent.'),
        target_value: z.number().optional().describe('New numeric target.'),
      },
      outputSchema: goalOutputSchema,
      annotations: DESTRUCTIVE_WRITE,
    },
    async ({ goal_id, name, description, weight, target_value }, extra) => {
      try {
        if (name === undefined && description === undefined && weight === undefined && target_value === undefined) {
          throw new ToolInputError('Give at least one change (`name`, `description`, `weight` or `target_value`), '
            + 'or use `approve_goal` to approve without changes.');
        }
        const request: TeamsoGoalRequest = {
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(weight !== undefined ? { weight } : {}),
        };
        if (target_value !== undefined) {
          const current = await client.getGoal(goal_id, extra.signal);
          request.targetValueDefinition = withTargetValue(current.targetValueDefinition, target_value);
        }
        const response = await client.reviseAndApproveGoal(goal_id, request, extra.signal);
        return goalMutationResult(response.result, goal_id, 'Goal revised and approved', client, extra.signal);
      } catch (error) {
        return apiErrorResult(error, GOAL_HINTS);
      }
    },
  );
}

const PROGRESS_STATUSES = ['ON_TRACK', 'AT_RISK', 'LATE'] as const;

/** TMS-5065: refusals of `POST /user-goal-progress/goal/{id}` in plain words. */
const PROGRESS_REFUSALS: Record<string, string> = {
  PERIOD_NOT_ACTIVE: 'The goal\'s period is not running, so progress cannot be added now. Progress is added only '
    + 'between the period\'s start and end day.',
  GOAL_NOT_OPEN: 'This goal takes no progress now: progress is added after the goal is approved and until its actual '
    + 'value is entered.',
  PERMISSION_DENIED: 'Only the goal\'s owner, their direct manager or a performance admin can add progress to it.',
  PROGRESS_STATUS_REQUIRED: 'Choose a status: ON_TRACK, AT_RISK or LATE.',
  PROGRESS_VALUE_REQUIRED: 'This is a numeric goal: send the value reached so far as `value`.',
  PROGRESS_PERCENT_INVALID: 'This is an `OTHER` goal: send `percent` between 0 and 100.',
  PROGRESS_COMMENT_TOO_LONG: 'The comment can have at most 1000 characters.',
};

/** Same rule as Teamso (value / target, a negative target the other way round), one decimal. */
function percentOfTarget(value: number, target: number | null | undefined): number | undefined {
  if (target === null || target === undefined || target === 0) return undefined;
  if (target > 0) return Math.round((value / target) * 1000) / 10;
  if (value === 0) return 0;
  return Math.round((target / value) * 1000) / 10;
}

function num(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function progressHistory(entries: TeamsoGoalProgressEntry[] | undefined, limit = 5) {
  return (entries ?? []).slice(0, limit).map(entry => ({
    ...(num(entry.value) !== undefined ? { value: num(entry.value) } : {}),
    ...(num(entry.percent) !== undefined ? { percent: num(entry.percent) } : {}),
    ...(entry.status ? { status: entry.status } : {}),
    ...(entry.comment ? { comment: entry.comment } : {}),
    ...(entry.createdAt ? { createdAt: entry.createdAt } : {}),
    ...(entry.createdByName ? { createdBy: entry.createdByName } : {}),
  }));
}

function progressLine(progress: { value?: number; percent?: number; status: string; comment?: string }): string {
  const parts = [
    progress.value !== undefined ? `value ${progress.value}` : undefined,
    progress.percent !== undefined ? `${progress.percent}% of the target` : undefined,
    progress.status,
    progress.comment ? `"${progress.comment}"` : undefined,
  ].filter(Boolean);
  return parts.join(', ');
}

export function registerAddGoalProgress(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'add_goal_progress',
    {
      title: 'Add progress to my goal',
      description: 'Record where a goal stands during its period ("hedefime ilerleme ekle"): the value reached so far '
        + '(numeric goals: `value`) or the percent done (`OTHER` goals: `percent`), whether it is ON_TRACK, AT_RISK '
        + 'or LATE, and an optional short comment. Without `confirm: true` it only previews; with it the check-in is '
        + 'saved and kept in the goal\'s history (check-ins are never edited). Only while the period runs and the '
        + 'goal is approved but not yet evaluated, by the goal\'s owner, their direct manager or a performance admin. '
        + 'AT_RISK and LATE goals reach the manager\'s team view. Files are attached in the Teamso web app.',
      inputSchema: {
        goal_id: idSchema('Id of a goal of the caller, or of an employee the caller manages.'),
        status: z.enum(PROGRESS_STATUSES).describe('ON_TRACK, AT_RISK or LATE.'),
        value: z.number().finite().optional().describe('Value reached so far, for numeric goals (e.g. 18 of 40).'),
        percent: z.number().min(0).max(100).optional().describe('Percent done (0-100), only for `OTHER` goals.'),
        comment: z.string().trim().max(1000).optional().describe('Short comment: what was done, what is needed.'),
        confirm: confirmSchema,
      },
      outputSchema: goalProgressOutputSchema,
      annotations: ADDITIVE_WRITE,
    },
    async ({ goal_id, status, value, percent, comment, confirm }, extra) => {
      try {
        const card: TeamsoGoalProgressCard = await client.getGoalProgress(goal_id, extra.signal);
        if (card?.canAddProgress !== true) {
          const reason = card?.closedReason && PROGRESS_REFUSALS[card.closedReason]
            ? PROGRESS_REFUSALS[card.closedReason]!
            : card?.open ? PROGRESS_REFUSALS.PERMISSION_DENIED! : PROGRESS_REFUSALS.GOAL_NOT_OPEN!;
          return errorResult(reason);
        }
        const isOther = card.isOther === true;
        if (isOther && (percent === undefined || value !== undefined)) {
          throw new ToolInputError('This is an `OTHER` goal: send `percent` (0-100) and no `value`.');
        }
        if (!isOther && (value === undefined || percent !== undefined)) {
          throw new ToolInputError('This is a numeric goal: send the value reached so far as `value`, not `percent`.');
        }
        const note = comment ? comment : undefined;
        const request: TeamsoGoalProgressRequest = {
          ...(isOther ? { percent } : { value }),
          status,
          ...(note ? { comment: note } : {}),
          withFile: false,
        };
        const target = num(card.targetValue);
        const progress = {
          ...(value !== undefined ? { value } : {}),
          ...(isOther
            ? { percent }
            : percentOfTarget(value!, target) !== undefined ? { percent: percentOfTarget(value!, target) } : {}),
          status,
          ...(note ? { comment: note } : {}),
        };
        const base = {
          goalId: card.goalId || goal_id,
          ...(card.goalName ? { goalName: card.goalName } : {}),
          ...(card.periodName ? { period: card.periodName } : {}),
          ...(target !== undefined ? { target } : {}),
        };
        if (!confirm) {
          const last = card.lastProgressStatus
            ? ` The last check-in was ${card.lastProgressStatus}${num(card.lastProgressPercent) !== undefined ? ` at ${card.lastProgressPercent}%` : ''}.`
            : ' This would be the first check-in.';
          const message = `This check-in would be added to "${card.goalName ?? goal_id}": ${progressLine(progress)}.${last} `
            + 'Nothing was saved yet.';
          return toolResult(`## Goal progress preview\n\n${message}`, {
            saved: false,
            ...base,
            progress,
            history: progressHistory(card.entries, 3),
            message,
            nextAction: {
              tool: 'add_goal_progress',
              arguments: { goal_id, status, ...(isOther ? { percent } : { value }), ...(note ? { comment: note } : {}), confirm: true },
              reason: 'Save it only after the user agrees to these details.',
            },
          });
        }
        const saved = await client.addGoalProgress(goal_id, request, extra.signal);
        const latest = saved?.entries?.[0];
        const savedProgress = {
          ...(num(latest?.value) !== undefined ? { value: num(latest?.value) } : progress.value !== undefined ? { value: progress.value } : {}),
          ...(num(latest?.percent) !== undefined ? { percent: num(latest?.percent) } : progress.percent !== undefined ? { percent: progress.percent } : {}),
          status,
          ...(note ? { comment: note } : {}),
        };
        const message = `Progress saved for "${saved?.goalName ?? card.goalName ?? goal_id}": ${progressLine(savedProgress)}.`
          + (status === 'ON_TRACK' ? '' : ' The goal now shows in the manager\'s list of goals at risk.');
        return toolResult(`## Goal progress saved\n\n${message}`, {
          saved: true,
          ...base,
          progress: savedProgress,
          history: progressHistory(saved?.entries),
          message,
        });
      } catch (error) {
        const refusal = refusalText(error, PROGRESS_REFUSALS);
        if (refusal) return errorResult(refusal);
        return apiErrorResult(error, GOAL_HINTS);
      }
    },
  );
}

export function registerUpdateGoalActualValue(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'update_goal_actual_value',
    {
      title: 'Enter my goal\'s actual value',
      description: 'Enter or correct the achieved value of the caller\'s own goal during evaluation. '
        + 'Numeric goals take `actual_value`, `OTHER` goals take `actual_text`.',
      inputSchema: {
        goal_id: idSchema('Id of one of the caller\'s own goals.'),
        actual_value: z.number().optional().describe('Achieved numeric value.'),
        actual_text: z.string().trim().min(1).max(2000).optional().describe('Achieved outcome for `OTHER` goals.'),
      },
      outputSchema: goalOutputSchema,
      annotations: DESTRUCTIVE_WRITE,
    },
    async ({ goal_id, actual_value, actual_text }, extra) => {
      try {
        if ((actual_value === undefined) === (actual_text === undefined)) {
          throw new ToolInputError('Send exactly one of `actual_value` or `actual_text`.');
        }
        await refreshPeriodStatuses(client, extra.signal);
        const response = await client.updateGoalActualValue(
          goal_id,
          { actualValue: actual_value, actualText: actual_text },
          extra.signal,
        );
        return goalMutationResult(response.result, goal_id, 'Actual value saved', client, extra.signal);
      } catch (error) {
        return apiErrorResult(error, GOAL_HINTS);
      }
    },
  );
}

export function registerUpdateManagerActualValue(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'update_manager_actual_value',
    {
      title: 'Enter the manager\'s actual value for a goal',
      description: 'Record the manager\'s assessed achieved value for an employee\'s goal during evaluation '
        + '(the caller must be the employee\'s direct manager or an admin). Numeric goals take `value`, '
        + '`OTHER` goals take `text`.',
      inputSchema: {
        goal_id: idSchema('Id of a goal of an employee the caller manages.'),
        value: z.number().optional().describe('Achieved numeric value in the manager\'s assessment.'),
        text: z.string().trim().min(1).max(2000).optional().describe('Assessment for `OTHER` goals.'),
      },
      outputSchema: goalOutputSchema,
      annotations: DESTRUCTIVE_WRITE,
    },
    async ({ goal_id, value, text }, extra) => {
      try {
        if ((value === undefined) === (text === undefined)) {
          throw new ToolInputError('Send exactly one of `value` or `text`.');
        }
        await refreshPeriodStatuses(client, extra.signal);
        const response = await client.updateManagerActualValue(
          goal_id,
          { managerActualValue: value, managerActualText: text },
          extra.signal,
        );
        return goalMutationResult(response.result, goal_id, 'Manager value saved', client, extra.signal);
      } catch (error) {
        return apiErrorResult(error, GOAL_HINTS);
      }
    },
  );
}

export function registerApproveGoalEvaluation(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'approve_goal_evaluation',
    {
      title: 'Approve an employee\'s goal evaluation',
      description: 'Approve the goal evaluation of one employee for a period at the caller\'s approval '
        + 'step. When it is the last step Teamso computes the final score.',
      inputSchema: {
        period: periodSchema,
        user_id: idSchema('Employee id of the goal owner.'),
      },
      outputSchema: evaluationApprovalOutputSchema,
      annotations: ADDITIVE_WRITE,
    },
    async ({ period, user_id }, extra) => {
      try {
        const settings = await client.getPerformanceSettings(extra.signal);
        const { title } = resolvePeriod(settings?.periods ?? [], period);
        const response = await client.approveEvaluationProcess({ periodName: title, userId: user_id }, extra.signal);
        const result = response.result ?? {};
        const goals = (result.goals ?? []).map(toGoal);
        const finalScore = typeof result.finalScore === 'number' ? result.finalScore : undefined;
        const finalScoreText = result.finalScoreText || undefined;
        const message = finalScore !== undefined
          ? `Evaluation approved. Final score: ${finalScore}${finalScoreText ? ` (${finalScoreText})` : ''}.`
          : `Evaluation approved${result.newStatus ? `; goals are now ${result.newStatus}` : ''}.`;
        return toolResult(`## Evaluation approved: ${title}\n\n${goals.map(goalLine).join('\n')}\n\n${message}`, {
          period: title,
          userId: user_id,
          ...(result.newStatus ? { newStatus: result.newStatus } : {}),
          ...(finalScore !== undefined ? { finalScore } : {}),
          ...(finalScoreText ? { finalScoreText } : {}),
          goals,
          message,
        });
      } catch (error) {
        return apiErrorResult(error, GOAL_HINTS);
      }
    },
  );
}

async function collectGoals(load: (page: number) => Promise<TeamsoGoalPage>) {
  const goals: TeamsoGoal[] = [];
  let canAddGoal = false;
  for (let page = 0; page < MAX_GOAL_PAGES; page++) {
    const result = await load(page);
    if (page === 0) canAddGoal = result?.canAddGoal === true;
    goals.push(...(result?.goals ?? []));
    if (!result?.pagination?.hasNext) break;
  }
  return { goals, canAddGoal };
}

/**
 * Goals link to a period by its exact title, so a title that differs only in
 * case or Turkish letters silently returns nothing. When the first query is
 * empty, the title is resolved against the defined periods (an unknown title
 * is an error) and the goals are loaded again under the exact title.
 */
async function collectPeriodGoals(
  client: TeamsoClient,
  period: string,
  load: (periodName: string, page: number) => Promise<TeamsoGoalPage>,
  signal?: AbortSignal,
) {
  const pages = await collectGoals(page => load(period, page));
  if (pages.goals.length > 0) return { title: period, pages };

  const settings = await client.getPerformanceSettings(signal);
  const { title } = resolvePeriod(settings?.periods ?? [], period);
  if (title === period) return { title, pages };
  return { title, pages: await collectGoals(page => load(title, page)) };
}

/**
 * `POST /user-goal` does not check who the goal is for. Teamso's own rule
 * (`/user-goal/assigned`, manager values) is: performance admins may set goals
 * for anyone, other users only for their direct reports.
 */
async function assertCanSetGoalsFor(
  client: TeamsoClient,
  me: TeamsoUser,
  userId: string,
  signal?: AbortSignal,
): Promise<void> {
  const isAdmin = (me.permissions ?? []).some(permission => permission.code === PERFORMANCE_ADMIN_PERMISSION);
  if (isAdmin) return;
  let managerId: string | null | undefined;
  try {
    managerId = (await client.getUserSummary(userId, signal))?.managerId;
  } catch (error) {
    if (error instanceof TeamsoApiError && (error.status === 403 || error.status === 404
      || error.messageCode === 'USER_NOT_FOUND' || error.messageCode === 'ITEM_NOT_FOUND')) {
      managerId = undefined;
    } else {
      throw error;
    }
  }
  if (managerId !== me.id) {
    throw new ToolInputError(`You can only create goals for yourself or your direct reports, and \`${userId}\` `
      + 'does not report to you. Ask a performance administrator, or check the id with `search_employees`.');
  }
}

function resolvePeriod(periods: TeamsoPerformancePeriod[], title: string): TeamsoPerformancePeriod {
  const exact = periods.find(period => period.title === title);
  if (exact) return exact;
  const wanted = normalizeSearchText(title).trim();
  const loose = periods.find(period => normalizeSearchText(period.title).trim() === wanted);
  if (loose) return loose;
  const titles = periods.map(period => `"${period.title}"`).join(', ');
  throw new ToolInputError(`No performance period is titled "${title}". `
    + `Available periods: ${titles || 'none'}. Use \`list_performance_periods\`.`);
}

/**
 * The goal endpoints move goals into evaluation lazily when the performance
 * settings are read after a target-entry window closes.
 */
async function refreshPeriodStatuses(client: TeamsoClient, signal?: AbortSignal): Promise<void> {
  try {
    await client.getPerformanceSettings(signal);
  } catch {
    // Best effort: the update call reports the real problem.
  }
}

function periodDates(period: TeamsoPerformancePeriod): Pick<TeamsoGoalRequest, 'periodStartDate' | 'periodEndDate'> {
  const projected = toPerformancePeriod(period);
  return {
    ...(projected.startDate ? { periodStartDate: projected.startDate } : {}),
    ...(projected.endDate ? { periodEndDate: projected.endDate } : {}),
  };
}

/** Same shape the web app sends: the target score first, then the period's evaluation scale. */
function targetDefinition(
  period: TeamsoPerformancePeriod,
  scale: (typeof SCALE_CRITERIA)[number],
  args: { target_value?: number; currency?: string; other_text?: string },
): TeamsoTargetValueDefinition {
  if (scale === 'OTHER') {
    return { scaleCriterion: scale, otherText: args.other_text ?? '' };
  }
  const evaluationScale = toPerformancePeriod(period).evaluationScale;
  const scores: TeamsoGoalScore[] = [
    { text: TARGETED_PERFORMANCE_TEXT, value: args.target_value, key: TARGETED_PERFORMANCE_KEY },
    ...evaluationScale.map(item => ({ text: item.label, value: item.value ?? null })),
  ];
  return {
    scaleCriterion: scale,
    ...(scale === 'CURRENCY' && args.currency ? { currency: args.currency.toUpperCase() } : {}),
    scores,
  };
}

function withTargetValue(
  definition: TeamsoTargetValueDefinition | null | undefined,
  targetValue: number,
): TeamsoTargetValueDefinition {
  if (definition?.scaleCriterion === 'OTHER') {
    throw new ToolInputError('`OTHER` goals have no numeric target; change `description` instead.');
  }
  const scores = [...(definition?.scores ?? [])];
  const index = scores.findIndex(score => score.key === TARGETED_PERFORMANCE_KEY);
  const target = { text: TARGETED_PERFORMANCE_TEXT, value: targetValue, key: TARGETED_PERFORMANCE_KEY };
  if (index >= 0) scores[index] = { ...scores[index], value: targetValue };
  else scores.unshift(target);
  return { ...(definition ?? {}), scores };
}

async function goalMutationResult(
  result: TeamsoGoal | undefined,
  goalId: string,
  heading: string,
  client: TeamsoClient,
  signal?: AbortSignal,
) {
  const raw = result?.id ? result : await client.getGoal(goalId, signal);
  const goal = toGoal(raw);
  const message = `${heading}. The goal is now ${goal.status}.`;
  return toolResult(`## ${heading}\n\n${goalLine(goal)}\n\n${message}`, { goal, message });
}

function goalLine(goal: GoalProjection): string {
  const target = goal.targetValue !== undefined ? `target ${goal.targetValue}` : goal.otherText;
  const parts = [
    goal.status,
    goal.weight !== undefined ? `weight ${goal.weight}%` : undefined,
    target,
    goal.actualValue !== undefined ? `actual ${goal.actualValue}` : goal.actualText,
    goal.managerActualValue !== undefined
      ? `manager ${goal.managerActualValue}`
      : goal.managerActualText ? `manager: ${goal.managerActualText}` : undefined,
    goal.achievementPercentage !== undefined ? `achieved ${goal.achievementPercentage}%` : undefined,
    goal.score !== undefined ? `score ${goal.score}` : undefined,
  ].filter(Boolean);
  return `- **${goal.name}** (\`${goal.id}\`): ${parts.join(', ')}`;
}

function goalListText(heading: string, goals: GoalProjection[], canAddGoal: boolean, withOwner = false): string {
  if (goals.length === 0) {
    return `## ${heading}\n\nNo goals yet.${canAddGoal ? ' You can add one with `create_user_goal`.' : ''}`;
  }
  const scored = goals.some(goal => goal.score !== undefined);
  const headers = [
    ...(withOwner ? ['Employee'] : []),
    'Goal', 'Id', 'Status', 'Weight', 'Target', 'Actual',
    ...(scored ? ['Score'] : []),
  ];
  const rows = goals.map(goal => {
    const row = [
      goal.name,
      `\`${goal.id}\``,
      goal.status,
      goal.weight !== undefined ? `${goal.weight}%` : undefined,
      goal.targetValue ?? goal.otherText,
      goal.actualValue ?? goal.actualText,
      ...(scored ? [goal.score] : []),
    ];
    return withOwner ? [goal.userFullName, ...row] : row;
  });
  const notes: string[] = [];
  if (!withOwner) notes.push(`Total weight: ${goals.reduce((sum, goal) => sum + (goal.weight ?? 0), 0)}%`);
  // Teamso writes the period score while the evaluation is still in approval (so the approver sees it);
  // it is final only once every goal of that employee is COMPLETED.
  const owners = new Map<string, { value?: string; final: boolean }>();
  for (const goal of goals) {
    const owner = goal.userFullName ?? goal.userId ?? '';
    const entry = owners.get(owner) ?? { final: true };
    entry.final = entry.final && goal.status === 'COMPLETED';
    if (goal.finalScore !== undefined) {
      entry.value = `${goal.finalScore}${goal.finalScoreText ? ` (${goal.finalScoreText})` : ''}`;
    }
    owners.set(owner, entry);
  }
  const periodScores = [...owners].filter(([, entry]) => entry.value !== undefined) as [string, { value: string; final: boolean }][];
  const scoreNote = (entry: { value: string; final: boolean }) => `${entry.value}${entry.final ? '' : ', pending approval'}`;
  if (!withOwner && periodScores.length) notes.push(`Period score: ${scoreNote(periodScores[0]![1])}`);
  if (withOwner && periodScores.length) {
    notes.push(`Period scores: ${periodScores.map(([owner, entry]) => `${owner || 'employee'} ${scoreNote(entry)}`).join(', ')}`);
  }
  if (canAddGoal) notes.push('New goals can be added.');
  return `## ${heading}\n\n${markdownTable(headers, rows)}${notes.length ? `\n\n${notes.join(' · ')}` : ''}`;
}
