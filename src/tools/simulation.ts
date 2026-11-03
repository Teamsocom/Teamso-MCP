import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TeamsoClient } from '../client.js';
import type {
  TeamsoSimulationAssignment,
  TeamsoSimulationAttempt,
  TeamsoSimulationAttemptResult,
  TeamsoSimulationCatalogItem,
} from '../types.js';
import { parseWallClock, toDisplayDateTime, toIsoDay } from '../utils/dates.js';
import { markdownTable } from '../utils/format.js';
import { ToolInputError, apiErrorResult, toolResult, type ApiErrorHints } from '../utils/results.js';
import { compact, optionalNumber, optionalString } from '../utils/structured.js';
import {
  simulationAssignmentsOutputSchema,
  simulationCatalogOutputSchema,
  simulationResultsOutputSchema,
} from './schemas.js';
import { READ_ONLY, idSchema } from './shared.js';

/** Where the user practises: a simulation conversation needs the web app (chat or microphone), no tool starts one. */
export const SIMULATION_PRACTICE_URL = 'https://teamso.com/dashboard/simulation';

/** Assignment statuses that still ask something of the user. */
const OPEN_STATUSES = new Set(['NOT_STARTED', 'IN_PROGRESS', 'OVERDUE']);

const ATTEMPT_STATUSES = [
  'CREATED',
  'ACTIVE',
  'ENDED',
  'SCORING',
  'SCORED',
  'SCORING_FAILED',
  'NOT_SCORABLE',
] as const;

const MODES = ['TEXT', 'VOICE'] as const;
const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;

const SIMULATION_HINTS: ApiErrorHints = {
  byCode: {
    MODULE_DISABLED: 'AI Simulation is not enabled for your company: the module is switched off (Settings > '
      + 'Modules) or the AI Simulation package has not been bought. Ask your Teamso administrator.',
    SIMULATION_NOT_FOUND: 'Teamso could not find that simulation or attempt in your company. '
      + '`get_simulation_results` without `attempt_id` lists the attempts, `list_simulations` the scenarios.',
    SIMULATION_FORBIDDEN: 'You cannot see this: employees see their own results, managers the results of their '
      + 'team, and simulation admins everyone\'s.',
  },
  forbidden: 'AI Simulation needs the simulation right of your role.',
  notFound: 'Teamso could not find that simulation or attempt, or it is not visible to you.',
};

const TEAM_HINTS: ApiErrorHints = {
  ...SIMULATION_HINTS,
  forbidden: 'Team results (`scope: "team"`) are for managers (their own team) and simulation admins. '
    + 'Without `scope` the tool shows your own results.',
};

const PRACTICE_NOTE = `The conversation itself happens in the Teamso web app: ${SIMULATION_PRACTICE_URL}`;

// ------------------------------------------------------------- projections

function toAssignment(assignment: TeamsoSimulationAssignment) {
  const attempts = optionalNumber(assignment.attempts) ?? 0;
  const maxAttempts = optionalNumber(assignment.maxAttempts);
  return compact({
    assignmentUserId: assignment.assignmentUserId,
    assignmentId: optionalString(assignment.assignmentId),
    contentType: optionalString(assignment.contentType),
    scenarioId: optionalString(assignment.scenarioId),
    trackId: optionalString(assignment.trackId),
    trackItemId: optionalString(assignment.trackItemId),
    title: optionalString(assignment.title) ?? assignment.assignmentUserId,
    dueDate: toIsoDay(assignment.dueDate ?? undefined),
    status: optionalString(assignment.status) ?? 'NOT_STARTED',
    overdue: assignment.overdue === true,
    bestScore: optionalNumber(assignment.bestScore),
    attempts,
    maxAttempts,
    // 0 means unlimited
    attemptsLeft: maxAttempts && maxAttempts > 0 ? Math.max(0, maxAttempts - attempts) : undefined,
    passScore: optionalNumber(assignment.passScore),
    examMode: assignment.examMode === true,
    allowedModes: optionalString(assignment.allowedModes),
    difficulty: optionalString(assignment.difficulty),
    note: optionalString(assignment.note),
  });
}

function toAttempt(attempt: TeamsoSimulationAttempt) {
  return compact({
    id: attempt.id,
    scenarioId: optionalString(attempt.scenarioId),
    scenarioTitle: optionalString(attempt.scenarioTitle),
    userId: optionalString(attempt.userId),
    userName: optionalString(attempt.userName),
    mode: optionalString(attempt.mode),
    difficulty: optionalString(attempt.difficulty),
    kind: optionalString(attempt.kind),
    status: optionalString(attempt.status) ?? 'UNKNOWN',
    totalScore: optionalNumber(attempt.totalScore),
    passed: typeof attempt.passed === 'boolean' ? attempt.passed : undefined,
    startedAt: toDisplayDateTime(attempt.startedAt ?? undefined),
    durationSec: optionalNumber(attempt.durationSec),
    reviewState: optionalString(attempt.reviewState),
    overridden: attempt.overridden === true,
  });
}

function strings(values: Array<string | null | undefined> | null | undefined): string[] {
  return (Array.isArray(values) ? values : [])
    .map(value => optionalString(value))
    .filter((value): value is string => value !== undefined);
}

/**
 * Score and feedback of one attempt. Only the listed fields are copied: the transcript (`attempt.turns`) and
 * anything else the API adds never reach the assistant.
 */
function toAttemptResult(attemptId: string, result: TeamsoSimulationAttemptResult) {
  const attempt = result.attempt ?? {};
  return compact({
    attemptId: optionalString(attempt.id) ?? attemptId,
    scenarioTitle: optionalString(result.scenario?.title) ?? optionalString(attempt.scenarioTitle),
    userName: optionalString(result.user?.name) ?? optionalString(attempt.userName),
    mode: optionalString(attempt.mode),
    difficulty: optionalString(attempt.difficulty),
    startedAt: toDisplayDateTime(attempt.startedAt ?? undefined),
    durationSec: optionalNumber(result.durationSec ?? attempt.durationSec),
    totalScore: optionalNumber(result.totalScore),
    passScore: optionalNumber(result.passScore),
    passed: typeof result.passed === 'boolean' ? result.passed : undefined,
    outcome: optionalString(result.outcome),
    criticalFailed: result.criticalFailed === true,
    criteria: (result.criteria ?? []).map(criterion => compact({
      key: criterion.key,
      name: optionalString(criterion.name) ?? criterion.key,
      skillTag: optionalString(criterion.skillTag),
      weight: optionalNumber(criterion.weight),
      level: optionalNumber(criterion.level),
      score: optionalNumber(criterion.score),
      rationale: optionalString(criterion.rationale),
      evidence: (criterion.evidence ?? [])
        .map(item => compact({ turn: optionalNumber(item.turn), quote: optionalString(item.quote) ?? '' }))
        .filter(item => item.quote),
      overridden: criterion.overridden === true,
    })),
    strengths: strings(result.strengths),
    priorities: strings(result.priorities),
    betterReplies: (result.betterReplies ?? [])
      .map(reply => compact({ turn: optionalNumber(reply.turn), text: optionalString(reply.text) ?? '' }))
      .filter(reply => reply.text),
    nextPracticeSkill: optionalString(result.nextPracticeSkill),
  });
}

function listOf(value: string[] | string | null | undefined): string[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return [...new Set(items.map(item => (typeof item === 'string' ? item.trim() : '')).filter(Boolean))];
}

function toCatalogItem(item: TeamsoSimulationCatalogItem) {
  const persona = item.persona
    ? compact({
      name: optionalString(item.persona.name),
      age: optionalNumber(item.persona.age),
      occupation: optionalString(item.persona.occupation),
      city: optionalString(item.persona.city),
    })
    : undefined;
  const assignment = item.assignment
    ? compact({
      assignmentUserId: optionalString(item.assignment.assignmentUserId),
      assignmentId: optionalString(item.assignment.assignmentId),
      dueDate: toIsoDay(item.assignment.dueDate ?? undefined),
      status: optionalString(item.assignment.status),
      overdue: typeof item.assignment.overdue === 'boolean' ? item.assignment.overdue : undefined,
      passScore: optionalNumber(item.assignment.passScore),
      examMode: typeof item.assignment.examMode === 'boolean' ? item.assignment.examMode : undefined,
    })
    : null;
  return compact({
    scenarioId: item.scenarioId,
    title: optionalString(item.title) ?? item.scenarioId,
    description: optionalString(item.description),
    sector: optionalString(item.sector),
    language: optionalString(item.language),
    direction: optionalString(item.direction),
    modes: listOf(item.modes),
    difficulties: listOf(item.difficulties),
    estMinutes: optionalNumber(item.estMinutes),
    persona: persona && Object.keys(persona).length ? persona : undefined,
    myBestScore: optionalNumber(item.myBestScore),
    myAttempts: optionalNumber(item.myAttempts) ?? 0,
    assignment,
    shelves: [] as string[],
  });
}

// ----------------------------------------------------------------- helpers

function formatDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined) return undefined;
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes ? `${minutes} min${rest ? ` ${rest} s` : ''}` : `${rest} s`;
}

function passedLabel(passed: boolean | undefined): string | undefined {
  return passed === undefined ? undefined : passed ? 'passed' : 'failed';
}

function dayOf(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  const parsed = parseWallClock(value, field);
  if (parsed.time) throw new ToolInputError(`\`${field}\` must be a day (\`yyyy-MM-dd\`), got "${value}".`);
  return parsed.date;
}

/** Due date first (no due date last), keeping the API order otherwise. */
function byDueDate<T extends { dueDate?: string }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (a.item.dueDate && b.item.dueDate && a.item.dueDate !== b.item.dueDate) {
        return a.item.dueDate < b.item.dueDate ? -1 : 1;
      }
      if (Boolean(a.item.dueDate) !== Boolean(b.item.dueDate)) return a.item.dueDate ? -1 : 1;
      return a.index - b.index;
    })
    .map(entry => entry.item);
}

// ------------------------------------------------------------------- tools

export function registerListSimulationAssignments(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_simulation_assignments',
    {
      title: 'List my AI Simulation assignments',
      description: 'List the AI Simulation practice assigned to the caller (role-play conversations with an AI '
        + 'customer or colleague, single scenarios or tracks), soonest due date first, with status, best score, '
        + 'attempts used and left, pass score and exam mode. By default only open ones (`NOT_STARTED`, '
        + '`IN_PROGRESS`, `OVERDUE`); `include_closed` adds passed, failed and cancelled ones. The conversation '
        + 'itself happens in the Teamso web app; no tool starts one.',
      inputSchema: {
        include_closed: z.boolean().default(false)
          .describe('Also list closed assignments (`PASSED`, `FAILED`, `CANCELLED`). Default: only open ones.'),
      },
      outputSchema: simulationAssignmentsOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ include_closed }, extra) => {
      try {
        const all = (await client.listMySimulationAssignments(extra.signal)).map(toAssignment);
        const assignments = byDueDate(include_closed ? all : all.filter(item => OPEN_STATUSES.has(item.status)));
        const structured = {
          assignments,
          total: assignments.length,
          includeClosed: include_closed,
          practiceUrl: SIMULATION_PRACTICE_URL,
        };
        if (assignments.length === 0) {
          const closed = all.length && !include_closed
            ? ` (${all.length} closed; \`include_closed: true\` lists them)`
            : '';
          return toolResult(`You have no ${include_closed ? '' : 'open '}AI Simulation assignments${closed}.`, structured);
        }
        const table = markdownTable(
          ['Assignment', 'Due', 'Status', 'Best score', 'Attempts', 'Pass score'],
          assignments.map(item => [
            item.examMode ? `${item.title} (exam)` : item.title,
            item.dueDate,
            item.overdue && item.status !== 'OVERDUE' ? `${item.status} (overdue)` : item.status,
            item.bestScore,
            item.maxAttempts && item.maxAttempts > 0 ? `${item.attempts} of ${item.maxAttempts}` : `${item.attempts}`,
            item.passScore,
          ]),
        );
        const heading = include_closed ? 'My AI Simulation assignments' : 'My open AI Simulation assignments';
        return toolResult(`## ${heading}\n\n${table}\n\n${PRACTICE_NOTE}`, structured);
      } catch (error) {
        return apiErrorResult(error, SIMULATION_HINTS);
      }
    },
  );
}

export function registerGetSimulationResults(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'get_simulation_results',
    {
      title: 'Get AI Simulation results',
      description: 'AI Simulation results. Without arguments: the caller\'s own attempts, newest first, with '
        + 'score and pass or fail (filter by `status` or `scenario_id`). `scope: "team"` (managers: their team, '
        + 'simulation admins: everyone) lists other people\'s attempts with `from`/`to` days, `user_id`, '
        + '`scenario_id`, `mode` and `result` filters. `attempt_id` returns one attempt\'s score, criteria with '
        + 'level, rationale and evidence, strengths, priorities and better replies. The conversation transcript is '
        + 'never returned.',
      inputSchema: {
        attempt_id: idSchema('Attempt id from a list of this tool: returns that attempt\'s score and feedback.')
          .optional(),
        scope: z.enum(['mine', 'team']).default('mine')
          .describe('`mine` (default): your own attempts. `team`: the people you may see (managers, admins).'),
        from: z.string().trim().max(10).optional()
          .describe('Team only: first day, `yyyy-MM-dd` (Turkey local time).'),
        to: z.string().trim().max(10).optional().describe('Team only: last day, `yyyy-MM-dd`.'),
        user_id: idSchema('Team only: one employee\'s attempts (id from `search_employees`).').optional(),
        scenario_id: idSchema('Only this scenario (id from `list_simulations`).').optional(),
        mode: z.enum(MODES).optional().describe('Team only: `TEXT` (written) or `VOICE` attempts.'),
        result: z.enum(['PASSED', 'FAILED']).optional().describe('Team only: passed or failed attempts.'),
        status: z.enum(ATTEMPT_STATUSES).optional()
          .describe('Mine only: attempt status, e.g. `SCORED` for the scored ones.'),
        page: z.number().int().min(1).max(1_000).default(1).describe('Page number, starting at 1.'),
        limit: z.number().int().min(1).max(100).default(20).describe('Attempts per page (1-100, default 20).'),
      },
      outputSchema: simulationResultsOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ attempt_id, scope, from, to, user_id, scenario_id, mode, result, status, page, limit }, extra) => {
      try {
        if (attempt_id) return await attemptResult(client, attempt_id, extra.signal);

        const team = scope === 'team';
        if (!team) {
          const teamOnly = Object.entries({ from, to, user_id, mode, result })
            .filter(([, value]) => value !== undefined)
            .map(([key]) => `\`${key}\``);
          if (teamOnly.length) {
            throw new ToolInputError(`${teamOnly.join(', ')} work with \`scope: "team"\` only. For your own attempts `
              + 'use `status` and `scenario_id`, or page through them (newest first).');
          }
        } else if (status) {
          throw new ToolInputError('`status` works for your own attempts only. With `scope: "team"` use `result` '
            + '(`PASSED` or `FAILED`).');
        }
        const fromDay = dayOf(from, 'from');
        const toDay = dayOf(to, 'to');
        if (fromDay && toDay && fromDay > toDay) {
          throw new ToolInputError(`\`from\` (${fromDay}) is after \`to\` (${toDay}).`);
        }

        const listed = team
          ? await client.listSimulationAttempts({
            from: fromDay,
            to: toDay,
            userId: user_id,
            scenarioId: scenario_id,
            mode,
            result,
            page: page - 1,
            size: limit,
          }, extra.signal)
          : await client.listMySimulationAttempts({
            page: page - 1,
            size: limit,
            status,
            scenarioId: scenario_id,
          }, extra.signal);
        const attempts = (listed?.items ?? []).map(toAttempt);
        const total = listed?.total ?? attempts.length;
        const scored = attempts.find(attempt => attempt.status === 'SCORED');
        const structured = compact({
          scope: team ? 'team' as const : 'mine' as const,
          attempts,
          total,
          page,
          size: limit,
          nextAction: scored
            ? {
              tool: 'get_simulation_results',
              arguments: { attempt_id: scored.id },
              reason: 'Score, criteria and feedback of one attempt.',
            }
            : undefined,
        });
        if (attempts.length === 0) {
          const text = page > 1 && total > 0
            ? `No attempts on page ${page}; there are ${Math.ceil(total / limit)} page(s).`
            : team ? 'No AI Simulation attempts match these filters.' : 'You have no AI Simulation attempts yet.';
          return toolResult(team ? text : `${text}\n\n${PRACTICE_NOTE}`, structured);
        }
        const table = markdownTable(
          [
            'Started',
            ...(team ? ['Person'] : []),
            'Scenario',
            'Mode',
            'Difficulty',
            'Status',
            'Score',
            'Result',
            'Id',
          ],
          attempts.map(attempt => [
            attempt.startedAt,
            ...(team ? [attempt.userName ?? attempt.userId] : []),
            attempt.scenarioTitle ?? attempt.scenarioId,
            attempt.mode,
            attempt.difficulty,
            attempt.status,
            attempt.totalScore,
            passedLabel(attempt.passed),
            `\`${attempt.id}\``,
          ]),
        );
        const more = total > page * limit ? `\n\nPage ${page} of ${Math.ceil(total / limit)} (${total} attempts).` : '';
        const heading = team ? 'AI Simulation results' : 'My AI Simulation results';
        return toolResult(`## ${heading}\n\n${table}${more}`, structured);
      } catch (error) {
        return apiErrorResult(error, scope === 'team' && !attempt_id ? TEAM_HINTS : SIMULATION_HINTS);
      }
    },
  );
}

async function attemptResult(client: TeamsoClient, attemptId: string, signal: AbortSignal) {
  const result = toAttemptResult(attemptId, await client.getSimulationAttemptResult(attemptId, signal) ?? {});
  const title = [result.scenarioTitle ?? 'AI Simulation attempt', result.userName].filter(Boolean).join(', ');
  const lines: string[] = [`## ${title}`, ''];
  const facts = [
    result.startedAt ? `Started: ${result.startedAt}` : undefined,
    result.mode ? `Mode: ${result.mode}` : undefined,
    result.difficulty ? `Difficulty: ${result.difficulty}` : undefined,
    formatDuration(result.durationSec) ? `Duration: ${formatDuration(result.durationSec)}` : undefined,
  ].filter(Boolean);
  if (facts.length) lines.push(facts.join(' · '), '');
  if (result.totalScore === undefined) {
    lines.push('This attempt has no score yet: it is still being scored, or it could not be scored.');
  } else {
    const pass = result.passScore !== undefined ? ` (pass score ${result.passScore})` : '';
    const verdict = passedLabel(result.passed);
    lines.push(`Score: ${result.totalScore}${pass}${verdict ? `, ${verdict}` : ''}.`);
  }
  if (result.criticalFailed) lines.push('A critical criterion failed, so the attempt does not pass whatever the score.');
  if (result.criteria.length) {
    lines.push('', markdownTable(
      ['Criterion', 'Skill', 'Weight', 'Level (0-4)', 'Score'],
      result.criteria.map(criterion => [
        criterion.overridden ? `${criterion.name} (reviewed)` : criterion.name,
        criterion.skillTag,
        criterion.weight,
        criterion.level,
        criterion.score,
      ]),
    ));
  }
  const section = (heading: string, items: string[]) => {
    if (items.length) lines.push('', `### ${heading}`, '', ...items.map(item => `- ${item}`));
  };
  section('Strengths', result.strengths);
  section('Priorities', result.priorities);
  section('Better replies', result.betterReplies.map(reply => (reply.turn !== undefined
    ? `Turn ${reply.turn}: ${reply.text}`
    : reply.text)));
  if (result.nextPracticeSkill) lines.push('', `Next skill to practise: ${result.nextPracticeSkill}.`);
  if (result.criteria.some(criterion => criterion.rationale || criterion.evidence.length)) {
    lines.push('', '_The rationale and evidence of each criterion are in structuredContent.result.criteria._');
  }
  return toolResult(lines.join('\n'), { scope: 'attempt', result });
}

export function registerListSimulations(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_simulations',
    {
      title: 'List AI Simulation scenarios',
      description: 'List the AI Simulation scenarios the caller can practise (the catalog of the web app), with '
        + 'sector, language, modes, difficulties, estimated minutes, the AI persona, the caller\'s best score and '
        + 'attempts, and an open assignment when there is one. Each scenario appears once, with the catalog '
        + 'shelves it is on. The conversation itself happens in the Teamso web app; no tool starts one.',
      inputSchema: {
        query: z.string().trim().min(1).max(100).optional().describe('Words in the scenario title or description.'),
        sector: z.string().trim().min(1).max(50).optional().describe('Only this sector (e.g. `RETAIL`, `BANKING`).'),
        mode: z.enum(MODES).optional().describe('Only scenarios with `TEXT` (written) or `VOICE` practice.'),
        difficulty: z.enum(DIFFICULTIES).optional().describe('Only scenarios with this difficulty.'),
        language: z.string().trim().regex(/^[A-Za-z]{2}(?:-[A-Za-z]{2})?$/, 'must be a language code such as tr or en')
          .optional()
          .describe('Conversation language code, e.g. `tr` or `en`.'),
        limit: z.number().int().min(1).max(100).default(30).describe('Maximum scenarios (1-100, default 30).'),
      },
      outputSchema: simulationCatalogOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ query, sector, mode, difficulty, language, limit }, extra) => {
      try {
        const catalog = await client.getSimulationCatalog({ query, sector, mode, difficulty, language }, extra.signal);
        const byId = new Map<string, ReturnType<typeof toCatalogItem>>();
        const shelves: Array<{ key: string; count: number }> = [];
        for (const shelf of catalog?.shelves ?? []) {
          const key = optionalString(shelf?.key);
          const items = (shelf?.items ?? []).filter(item => optionalString(item?.scenarioId));
          if (key) shelves.push({ key, count: items.length });
          for (const item of items) {
            const existing = byId.get(item.scenarioId) ?? toCatalogItem(item);
            if (key && !existing.shelves.includes(key)) existing.shelves.push(key);
            byId.set(item.scenarioId, existing);
          }
        }
        const all = [...byId.values()];
        const simulations = all.slice(0, limit);
        const structured = {
          simulations,
          total: all.length,
          shelves,
          practiceUrl: SIMULATION_PRACTICE_URL,
        };
        if (all.length === 0) {
          const filtered = query || sector || mode || difficulty || language;
          return toolResult(filtered
            ? 'No AI Simulation scenario matches these filters.'
            : 'There are no AI Simulation scenarios for you yet.', structured);
        }
        const table = markdownTable(
          ['Scenario', 'Id', 'Sector', 'Modes', 'Difficulty', 'Minutes', 'My best', 'Assigned'],
          simulations.map(item => [
            item.title,
            `\`${item.scenarioId}\``,
            item.sector,
            item.modes.join(', '),
            item.difficulties.join(', '),
            item.estMinutes,
            item.myBestScore,
            item.assignment ? (item.assignment.dueDate ? `due ${item.assignment.dueDate}` : 'yes') : undefined,
          ]),
        );
        const more = all.length > simulations.length ? `\n\nShowing ${simulations.length} of ${all.length}.` : '';
        return toolResult(`## AI Simulation scenarios\n\n${table}${more}\n\n${PRACTICE_NOTE}`, structured);
      } catch (error) {
        return apiErrorResult(error, SIMULATION_HINTS);
      }
    },
  );
}
