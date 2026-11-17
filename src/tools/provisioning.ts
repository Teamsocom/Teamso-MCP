import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TeamsoClient } from '../client.js';
import type {
  TeamsoProvisioningFlowRow,
  TeamsoProvisioningFlowTask,
  TeamsoProvisioningMyTask,
  TeamsoProvisioningPerson,
  TeamsoProvisioningValues,
} from '../types.js';
import { toDisplayDateTime, toIsoDay } from '../utils/dates.js';
import { markdownTable } from '../utils/format.js';
import { ToolInputError, apiErrorResult, errorResult, toolResult, type ApiErrorHints } from '../utils/results.js';
import { compact, optionalNumber, optionalString } from '../utils/structured.js';
import {
  provisioningCommentOutputSchema,
  provisioningCompleteOutputSchema,
  provisioningFlowOutputSchema,
  provisioningFlowsOutputSchema,
  provisioningMyTasksOutputSchema,
  provisioningPreviewOutputSchema,
} from './schemas.js';
import { ADDITIVE_WRITE, DESTRUCTIVE_WRITE, READ_ONLY, idSchema } from './shared.js';

/**
 * Preparation and return ("Hazırlık ve iade", TMS-5285): the tasks that get a new employee's e-mail, laptop, line and
 * card ready before the first day, and take assets back and close accounts on the last day. Every tool calls the
 * web app's own `/provisioning/...` endpoints with the user's token, so it never shows more than the web: HR sees the
 * flows of their branches, a manager the flows of their team, everyone their own tasks. Asset values, licence data,
 * exit reasons, task outputs, notes and the flow log are never copied into a result.
 */
export const PROVISIONING_STATUS_URL = 'https://teamso.com/dashboard/onoffboarding/status';
export const PROVISIONING_TASKS_URL = 'https://teamso.com/dashboard/onboarding/tasks';

export function provisioningFlowUrl(flowId: string): string {
  return `${PROVISIONING_STATUS_URL}?plan=${encodeURIComponent(flowId)}`;
}

export function provisioningTaskUrl(taskId: string): string {
  return `${PROVISIONING_TASKS_URL}?task=${encodeURIComponent(taskId)}`;
}

const FLOW_STATUSES = ['ACTIVE', 'LATE', 'COMPLETED', 'CANCELLED'] as const;
const FOCUS = ['STARTING_WEEK', 'LEAVING_WEEK', 'LATE', 'RETURNS'] as const;
const KINDS = ['ONBOARDING', 'OFFBOARDING'] as const;
const CARD_FIELD = /^(WORK_EMAIL|WORK_PHONE|ACCESS_CARD|PDKS_CARD|CUSTOM:[A-Za-z0-9_-]{1,64})$/;
export const PROVISIONING_COMMENT_MAX = 2000;
export const PROVISIONING_NOTE_MAX = 500;

const SWITCHED_OFF = 'The preparation and return flow is switched off for your company (Settings > Onboarding and '
  + 'offboarding > General, "Hazırlık ve iade akışı"), so it opens no tasks. HR can switch it on in the Teamso web '
  + `app: ${PROVISIONING_STATUS_URL}`;

const PROVISIONING_HINTS: ApiErrorHints = {
  byCode: {
    MODULE_DISABLED: 'Preparation and return is not available for your company: the Onboarding and offboarding '
      + 'module ("İşe giriş ve çıkış") is switched off (Settings > Modules) or not in your package. Ask your Teamso '
      + 'administrator.',
    ITEM_NOT_FOUND: 'Teamso could not find that flow or task, or it is not visible to you: HR sees the flows of their '
      + 'branches, a manager the flows of their team, everyone else only the tasks they are on.',
    PERMISSION_DENIED: 'Only the people on a task and HR of the employee\'s branch can close it; the manager can read '
      + 'it and add notes.',
    NOT_ACTIVE: 'The flow is no longer active (completed or cancelled), so its tasks cannot change.',
    NOT_OPEN: 'The task is not open: it is still scheduled, waits for another item, or was cancelled. '
      + '`get_provisioning_flow` shows when it opens.',
    ALREADY_DONE: 'Someone already closed this task.',
    VALUE_REQUIRED: 'This task needs its value before it can close (for example the new work e-mail address in '
      + '`fields.WORK_EMAIL`). Ask the user for it.',
    VALUE_TAKEN: 'The employee card already holds another value for this field. Ask the user whether to replace it, '
      + 'then call again with `overwrite: true`.',
    OVERWRITE_CONFIRM: 'The employee card already holds another value for this field. Ask the user whether to replace '
      + 'it, then call again with `overwrite: true`.',
    EMAIL_INVALID: 'That is not a valid e-mail address.',
    PHONE_INVALID: 'That is not a valid phone number.',
    VALUE_TOO_LONG: 'One of the values is too long.',
    INVALID_CARD_FIELD: 'This task does not write that card field. `get_provisioning_flow` shows the task; the fields '
      + 'are WORK_EMAIL, WORK_PHONE, ACCESS_CARD, PDKS_CARD or CUSTOM:<id>.',
    ASSET_REQUIRED: 'This task gives an asset: pass the idle asset in `inventory_ids`, or close it in the Teamso web '
      + 'app, where a new asset can be recorded.',
    ASSET_NOT_FOUND: 'That asset is not idle or does not exist.',
    ASSET_NOT_IDLE: 'That asset is already given to someone.',
    ASSET_DETAILS_REQUIRED: 'A new asset needs its details: record it in the Teamso web app.',
    TOO_MANY_ASSETS: 'More assets were given than the task asks for.',
    CAR_REQUIRED: 'This task gives a car: pass its id in `car_id` and the start kilometre in `km`.',
    CAR_NOT_FOUND: 'That car is not free or does not exist.',
    CAR_NOT_IDLE: 'That car is already given to someone.',
    INVALID_KM: 'The kilometre must be a whole number.',
    KM_BELOW_START: 'The kilometre is below the car\'s last recorded kilometre.',
    CHOICE_REQUIRED: 'This return task needs `return_state` (GOOD, FAULTY or LOST), or for a line `line_outcome`.',
    INVALID_CHOICE: 'One of the choices is not valid: `return_state` is GOOD, FAULTY or LOST, `line_outcome` is '
      + 'CANCELLED or HANDED_OVER.',
    NOTE_REQUIRED: 'This choice needs a note (who the line was handed to, what was lost).',
    INVENTORY_OFF: 'The asset module is switched off, so this task cannot record the asset.',
    CAR_OFF: 'The company car module is switched off, so this task cannot record the car.',
    COMMENT_REQUIRED: 'The note is empty.',
    COMMENT_TOO_LONG: `The note is longer than ${PROVISIONING_COMMENT_MAX} characters.`,
    INVALID_DATE: 'The date must be `yyyy-MM-dd`.',
  },
  forbidden: 'Preparation and return lists are for HR (ONOFFBOARDING_VIEW, MANAGE or ADMIN) and the employee\'s '
    + 'manager; tasks are for the people on them. The preview is for HR and whoever adds employees (PEOPLE_ADD).',
  notFound: 'Teamso could not find that flow or task, or it is not visible to you.',
};

// ------------------------------------------------------------- projections

function kindOf(value: string | null | undefined): 'ONBOARDING' | 'OFFBOARDING' {
  return value === 'OFFBOARDING' ? 'OFFBOARDING' : 'ONBOARDING';
}

function count(value: number | string | null | undefined): number {
  return optionalNumber(value) ?? 0;
}

function person(p: TeamsoProvisioningPerson | null | undefined) {
  return { type: optionalString(p?.type) ?? 'PERSON', name: optionalString(p?.name) ?? '' };
}

/** Only these fields of a flow row reach the assistant. */
function toFlow(row: TeamsoProvisioningFlowRow) {
  return compact({
    id: row.id,
    kind: kindOf(row.kind),
    name: optionalString(row.name) ?? '',
    pending: row.pending === true,
    position: optionalString(row.position),
    department: optionalString(row.department),
    date: toIsoDay(row.date ?? undefined),
    daysLeft: optionalNumber(row.daysLeft),
    done: count(row.done),
    total: count(row.total),
    late: count(row.late),
    urgent: count(row.urgent),
    critical: count(row.critical),
    returnsOpen: count(row.returnsOpen),
    status: optionalString(row.status) ?? 'ACTIVE',
    readiness: optionalString(row.readiness),
    missing: (Array.isArray(row.missing) ? row.missing : []).map(x => optionalString(x)).filter((x): x is string => !!x),
    flowUrl: provisioningFlowUrl(row.id),
  });
}

/** Only these fields of a task reach the assistant: never its output values, note, warning or the log. */
function toFlowTask(task: TeamsoProvisioningFlowTask) {
  return compact({
    id: task.id,
    title: optionalString(task.title) ?? task.id,
    source: optionalString(task.source) ?? 'TEMPLATE',
    category: optionalString(task.category),
    status: optionalString(task.status) ?? 'OPEN',
    dueDate: toIsoDay(task.dueDate ?? undefined),
    late: task.late === true,
    lateDays: count(task.lateDays),
    urgent: task.urgent === true,
    critical: task.critical === true,
    escalated: task.escalated === true,
    noAssignee: optionalString(task.noAssigneeReason) !== undefined,
    people: (Array.isArray(task.people) ? task.people : []).map(person).filter(p => p.name),
    mine: task.mine === true,
    completedAt: toDisplayDateTime(task.completedAt ?? undefined),
    completedBy: optionalString(task.completedByName),
  });
}

function toMyTask(task: TeamsoProvisioningMyTask) {
  return compact({
    id: task.id,
    flowId: optionalString(task.planId),
    kind: kindOf(task.kind),
    title: optionalString(task.title) ?? task.id,
    employeeName: optionalString(task.employeeName) ?? '',
    position: optionalString(task.position),
    date: toIsoDay(task.date ?? undefined),
    status: optionalString(task.status) ?? 'OPEN',
    dueDate: toIsoDay(task.dueDate ?? undefined),
    opensAt: displayTime(task.openAt),
    group: optionalString(task.group),
    late: task.late === true,
    urgent: task.urgent === true,
    critical: task.critical === true,
    needsValues: task.quickComplete !== true,
    formMissing: task.requestMissing === true,
    claimedBy: optionalString(task.claimedByName),
    completedAt: toDisplayDateTime(task.completedAt ?? undefined),
  });
}

const READINESS_TEXT: Record<string, string> = {
  READY: 'ready',
  ON_TRACK: 'on track',
  ATTENTION: 'needs attention',
  AT_RISK: 'at risk',
};

const KIND_TEXT = { ONBOARDING: 'entry', OFFBOARDING: 'exit' } as const;

function daysText(kind: 'ONBOARDING' | 'OFFBOARDING', daysLeft: number | undefined): string | undefined {
  if (daysLeft === undefined) return undefined;
  if (daysLeft === 0) return kind === 'ONBOARDING' ? 'starts today' : 'last day today';
  if (daysLeft > 0) return `in ${daysLeft} day(s)`;
  return `${-daysLeft} day(s) ago`;
}

/** Instants on the Turkey clock; a wall clock without an offset (`2026-11-24T09:00`) as `2026-11-24 09:00`. */
function displayTime(value: string | number | null | undefined): string | undefined {
  return toDisplayDateTime(value ?? undefined)?.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/, '$1 $2');
}

function dateSchema(description: string) {
  return z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be yyyy-MM-dd').describe(description);
}

// ------------------------------------------------------------------- tools

export function registerListProvisioningFlows(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_provisioning_flows',
    {
      title: 'List preparation and return flows',
      description: 'List the preparation ("hazırlık", new employees) and return ("iade", leavers) flows the caller '
        + 'follows, nearest date first: who, entry or exit, the first or last day, days left, tasks done of total, '
        + 'late, urgent and critical tasks, open items and a readiness of `READY`, `ON_TRACK`, `ATTENTION` or '
        + '`AT_RISK`. HR sees the flows of their branches, a manager the flows of their team. Filter by `status` '
        + '(`ACTIVE` default, `LATE` = active with late tasks, `COMPLETED`, `CANCELLED`), `kind`, a date range of the '
        + 'first or last day, a name, or `focus` (`STARTING_WEEK`, `LEAVING_WEEK`, `LATE`, `RETURNS` = assets still '
        + 'out after the last day). Example: "who starts this week and what is missing" is `focus: "STARTING_WEEK"`. '
        + 'Read only.',
      inputSchema: {
        status: z.enum(FLOW_STATUSES).default('ACTIVE').describe('Which flows: ACTIVE (default), LATE, COMPLETED or CANCELLED.'),
        kind: z.enum(KINDS).optional().describe('ONBOARDING (new employees) or OFFBOARDING (leavers). Default: both.'),
        focus: z.enum(FOCUS).optional()
          .describe('A summary card: STARTING_WEEK, LEAVING_WEEK (next 7 days), LATE, RETURNS (assets still out).'),
        from: dateSchema('First or last day on or after this day (`yyyy-MM-dd`).').optional(),
        to: dateSchema('First or last day on or before this day (`yyyy-MM-dd`).').optional(),
        query: z.string().trim().min(1).max(100).optional().describe('Words in the employee\'s name.'),
        page: z.number().int().min(0).max(1000).default(0).describe('Page, from 0.'),
        limit: z.number().int().min(1).max(100).default(20).describe('Flows per page (1-100, default 20).'),
      },
      outputSchema: provisioningFlowsOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ status, kind, focus, from, to, query, page, limit }, extra) => {
      try {
        const listed = await client.listProvisioningFlows({
          tab: status,
          kind,
          card: focus,
          from,
          to,
          q: query,
          page,
          size: limit,
        }, extra.signal) ?? {};
        const flows = (listed.rows ?? []).filter(row => optionalString(row?.id)).map(toFlow);
        const total = optionalNumber(listed.total) ?? flows.length;
        const enabled = listed.enabled !== false;
        if (!enabled && total === 0) return errorResult(SWITCHED_OFF);
        const cards = listed.cards ?? {};
        const counts: Record<string, number> = {};
        for (const key of FLOW_STATUSES) counts[key] = count(listed.counts?.[key]);
        const firstMissing = flows.find(flow => flow.status === 'ACTIVE' && flow.done < flow.total);
        const structured = compact({
          flows,
          total,
          returned: flows.length,
          page,
          status,
          counts,
          thisWeek: {
            starting: count(cards['STARTING_WEEK']),
            leaving: count(cards['LEAVING_WEEK']),
            withLateTasks: count(cards['LATE']),
            unreturnedAfterLastDay: count(cards['RETURNS']),
          },
          teamOnly: listed.teamOnly === true,
          enabled,
          appUrl: PROVISIONING_STATUS_URL,
          nextAction: firstMissing
            ? {
              tool: 'get_provisioning_flow',
              arguments: { flow_id: firstMissing.id },
              reason: 'The items of one flow, who does them and when they are due.',
            }
            : undefined,
        });
        const off = enabled ? '' : `\n\n${SWITCHED_OFF}`;
        if (flows.length === 0) {
          return toolResult(`No ${status === 'ACTIVE' ? 'active ' : ''}preparation or return flow matches.${off}`, structured);
        }
        const table = markdownTable(
          ['Employee', 'Type', 'Date', 'When', 'Done', 'Late', 'Readiness', 'Missing', 'Id'],
          flows.map(flow => [
            flow.pending ? `${flow.name} (not added yet)` : flow.name,
            KIND_TEXT[flow.kind],
            flow.date,
            daysText(flow.kind, flow.daysLeft),
            `${flow.done}/${flow.total}`,
            flow.late || undefined,
            flow.readiness ? READINESS_TEXT[flow.readiness] ?? flow.readiness : flow.status.toLowerCase(),
            flow.missing.slice(0, 4).join(', ') || undefined,
            `\`${flow.id}\``,
          ]),
        );
        const more = total > (page * limit) + flows.length ? `\n\nShowing ${flows.length} of ${total} flows (page ${page}).` : '';
        const team = structured.teamOnly ? '\n\nYou see the flows of the employees you manage.' : '';
        return toolResult(`## Preparation and return flows\n\n${table}${more}${team}${off}`, structured);
      } catch (error) {
        return apiErrorResult(error, PROVISIONING_HINTS);
      }
    },
  );
}

export function registerGetProvisioningFlow(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'get_provisioning_flow',
    {
      title: 'Get a preparation or return flow',
      description: 'One preparation or return flow with its tasks: each item\'s category, status (`PLANNED` = opens '
        + 'later, `WAITING` = waits for another item, `OPEN`, `DONE`, `SKIPPED` = not needed, `CANCELLED`), due day, '
        + 'days late, urgent and critical marks, whether it was escalated, who is on it (teams by name) and whether '
        + 'the caller is one of them (`mine`). Values written on closing, notes, asset values, licence data and the '
        + 'flow log are not returned. Read only.',
      inputSchema: {
        flow_id: idSchema('Flow id: `id` of a flow in the flow list, or `flowId` of a task.'),
      },
      outputSchema: provisioningFlowOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ flow_id }, extra) => {
      try {
        const result = await client.getProvisioningFlow(flow_id, extra.signal) ?? { id: flow_id };
        const { missing: _missing, ...head } = toFlow({ ...result, id: optionalString(result.id) ?? flow_id });
        const flow = compact({
          ...head,
          managerName: optionalString(result.managerName),
          immediate: result.immediate === true,
        });
        const tasks = (result.tasks ?? []).filter(task => optionalString(task?.id)).map(toFlowTask);
        const mineOpen = tasks.find(task => task.mine && task.status === 'OPEN');
        const structured = compact({
          flow,
          tasks,
          nextAction: mineOpen
            ? {
              tool: 'complete_provisioning_task',
              arguments: { task_id: mineOpen.id },
              reason: 'Only after the user says the task is done, with the values it writes.',
            }
            : undefined,
        });
        const facts = [
          `${KIND_TEXT[flow.kind] === 'entry' ? 'First day' : 'Last day'}: ${flow.date ?? 'not set'}`
            + (daysText(flow.kind, flow.daysLeft) ? ` (${daysText(flow.kind, flow.daysLeft)})` : ''),
          `Done: ${flow.done}/${flow.total}`,
          flow.readiness ? `Readiness: ${READINESS_TEXT[flow.readiness] ?? flow.readiness}` : `Status: ${flow.status}`,
          flow.managerName ? `Manager: ${flow.managerName}` : undefined,
        ].filter(Boolean).join(' · ');
        const table = tasks.length
          ? markdownTable(
            ['Task', 'Status', 'Due', 'Late', 'Who', 'Id'],
            tasks.map(task => [
              `${task.title}${task.critical ? ' (critical)' : ''}${task.urgent ? ' (urgent)' : ''}`,
              task.status.toLowerCase(),
              task.dueDate,
              task.late ? `${task.lateDays} day(s)` : undefined,
              (task.people.map(p => p.name).join(', ') || (task.noAssignee ? 'nobody (HR)' : undefined))
                + (task.mine ? ' (you)' : ''),
              `\`${task.id}\``,
            ]),
          )
          : 'This flow has no tasks.';
        const who = flow.position || flow.department ? ` (${[flow.position, flow.department].filter(Boolean).join(', ')})` : '';
        return toolResult(`## ${flow.name}${who}: ${KIND_TEXT[flow.kind]}\n\n${facts}\n\n${table}\n\nIn the Teamso web app: `
          + `${flow.flowUrl}`, structured);
      } catch (error) {
        return apiErrorResult(error, PROVISIONING_HINTS);
      }
    },
  );
}

export function registerListMyProvisioningTasks(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_my_provisioning_tasks',
    {
      title: 'List my preparation and return tasks',
      description: 'The caller\'s own preparation and return tasks ("Görevlerim"): open ones with the group `LATE`, '
        + '`TODAY`, `WEEK` or `LATER`, the employee, their first or last day and the due day; `needsValues` marks a '
        + 'task that writes something on closing (a work e-mail address, an asset, a car, a return state). With '
        + '`include_upcoming` the tasks that open later, with `include_done` those closed in the last 30 days. '
        + 'Read only.',
      inputSchema: {
        kind: z.enum(KINDS).optional().describe('ONBOARDING or OFFBOARDING tasks only. Default: both.'),
        query: z.string().trim().min(1).max(100).optional().describe('Words in the employee\'s name or the task.'),
        include_upcoming: z.boolean().default(false).describe('Also the tasks that open later.'),
        include_done: z.boolean().default(false).describe('Also the tasks closed in the last 30 days.'),
      },
      outputSchema: provisioningMyTasksOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ kind, query, include_upcoming, include_done }, extra) => {
      try {
        const result = await client.listMyProvisioningTasks({ kind, q: query }, extra.signal) ?? {};
        const tasks = (result.todo ?? []).filter(task => optionalString(task?.id)).map(toMyTask);
        const upcoming = include_upcoming ? (result.upcoming ?? []).filter(task => optionalString(task?.id)).map(toMyTask) : [];
        const done = include_done ? (result.done ?? []).filter(task => optionalString(task?.id)).map(toMyTask) : [];
        const enabled = result.enabled !== false;
        if (!enabled && tasks.length === 0 && (result.upcoming ?? []).length === 0 && (result.done ?? []).length === 0) {
          return errorResult(SWITCHED_OFF);
        }
        const first = tasks[0];
        const structured = compact({
          tasks,
          upcoming,
          done,
          late: count(result.late),
          enabled,
          appUrl: PROVISIONING_TASKS_URL,
          nextAction: first
            ? {
              tool: 'complete_provisioning_task',
              arguments: { task_id: first.id },
              reason: 'Only after the user says the task is done'
                + (first.needsValues ? ', with the value it writes.' : '.'),
            }
            : undefined,
        });
        const sections: string[] = [];
        const row = (task: ReturnType<typeof toMyTask>) => [
          task.title,
          task.employeeName,
          `${KIND_TEXT[task.kind]} ${task.date ?? ''}`.trim(),
          task.dueDate,
          task.group ? task.group.toLowerCase() : task.opensAt,
          task.needsValues ? 'yes' : undefined,
          `\`${task.id}\``,
        ];
        const head = ['Task', 'Employee', 'Entry or exit', 'Due', 'When', 'Needs a value', 'Id'];
        sections.push(tasks.length
          ? `## My preparation and return tasks (${tasks.length} open, ${structured.late} late)\n\n${markdownTable(head, tasks.map(row))}`
          : '## My preparation and return tasks\n\nYou have no open task.');
        if (upcoming.length) sections.push(`### Opening later\n\n${markdownTable(head, upcoming.map(row))}`);
        if (done.length) sections.push(`### Closed in the last 30 days\n\n${markdownTable(head, done.map(row))}`);
        if (!enabled) sections.push(SWITCHED_OFF);
        return toolResult(sections.join('\n\n'), structured);
      } catch (error) {
        return apiErrorResult(error, PROVISIONING_HINTS);
      }
    },
  );
}

/** The values closing writes, in the API's shape; nothing outside the listed fields is sent. */
export function provisioningValues(input: {
  fields?: Record<string, string>;
  inventory_ids?: string[];
  car_id?: string;
  km?: number;
  return_state?: string;
  line_outcome?: string;
  handed_to?: string;
  overwrite?: boolean;
}): TeamsoProvisioningValues | undefined {
  const values: TeamsoProvisioningValues = {};
  if (input.fields && Object.keys(input.fields).length) {
    for (const key of Object.keys(input.fields)) {
      if (!CARD_FIELD.test(key)) {
        throw new ToolInputError(`\`fields.${key}\` is not a card field: use WORK_EMAIL, WORK_PHONE, ACCESS_CARD, `
          + 'PDKS_CARD or CUSTOM:<custom field id>.');
      }
    }
    values.fields = { ...input.fields };
  }
  if (input.inventory_ids?.length) values.inventoryIds = [...input.inventory_ids];
  if (input.car_id) values.carId = input.car_id;
  if (input.km !== undefined) values.km = String(input.km);
  if (input.return_state) values.returnState = input.return_state;
  if (input.line_outcome) values.lineOutcome = input.line_outcome;
  if (input.handed_to) values.handedTo = input.handed_to;
  if (input.overwrite) values.overwrite = true;
  return Object.keys(values).length ? values : undefined;
}

export function registerCompleteProvisioningTask(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'complete_provisioning_task',
    {
      title: 'Complete a preparation or return task',
      description: 'Close a preparation or return task the caller is on (or, as HR of the branch, manages) and write '
        + 'what it produces: a card field such as the new work e-mail address (`fields: { "WORK_EMAIL": '
        + '"ayse.yilmaz@firma.com" }`), an idle asset (`inventory_ids`), a car with its kilometre, or on exit the '
        + 'return state (`GOOD`, `FAULTY`, `LOST`) or what happened to a line (`CANCELLED`, `HANDED_OVER` with '
        + '`handed_to`). The values go on the employee card and asset records, the next tasks may open, and closing '
        + 'cannot be undone here. A manager who is not on the task cannot close it. A task that needs a new asset with '
        + 'its price is closed in the Teamso web app.',
      inputSchema: {
        task_id: idSchema('Task id: `id` of a task in the caller\'s task list or in a flow.'),
        fields: z.record(z.string().trim().min(1).max(80), z.string().trim().min(1).max(254)).optional()
          .describe('Card fields to write: WORK_EMAIL, WORK_PHONE, ACCESS_CARD, PDKS_CARD or CUSTOM:<id>.'),
        inventory_ids: z.array(idSchema('Idle asset id.')).min(1).max(20).optional()
          .describe('Idle assets to give (asset tasks).'),
        car_id: idSchema('Company car to give (car tasks).').optional(),
        km: z.number().int().min(0).max(10_000_000).optional().describe('Kilometre of the car on giving or taking it back.'),
        return_state: z.enum(['GOOD', 'FAULTY', 'LOST']).optional().describe('Exit: the state the asset came back in.'),
        line_outcome: z.enum(['CANCELLED', 'HANDED_OVER']).optional().describe('Exit: what happened to the GSM line.'),
        handed_to: z.string().trim().min(1).max(120).optional().describe('With HANDED_OVER: who took the line.'),
        overwrite: z.boolean().default(false)
          .describe('Replace a value the employee card already holds for the field.'),
        note: z.string().trim().max(PROVISIONING_NOTE_MAX).optional().describe('A short closing note.'),
      },
      outputSchema: provisioningCompleteOutputSchema,
      annotations: DESTRUCTIVE_WRITE,
    },
    async ({ task_id, note, ...input }, extra) => {
      try {
        const values = provisioningValues(input);
        const response = await client.completeProvisioningTask(task_id, { values, note: note || undefined }, extra.signal);
        const view = isRecord(response.result) ? response.result : {};
        const task = isRecord(view['task']) ? view['task'] : view;
        const title = typeof task['title'] === 'string' ? task['title'] : undefined;
        const status = typeof task['status'] === 'string' ? task['status'] : 'DONE';
        const message = values
          ? 'The task is closed and its values were written.'
          : 'The task is closed.';
        return toolResult(`## Task closed\n\n${title ? `**${title}**: ` : ''}${message}`, compact({
          taskId: task_id,
          title,
          status,
          message,
        }));
      } catch (error) {
        return apiErrorResult(error, PROVISIONING_HINTS);
      }
    },
  );
}

export function registerAddProvisioningTaskComment(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'add_provisioning_task_comment',
    {
      title: 'Add a note to a preparation or return task',
      description: 'Add a note to a preparation or return task ("laptop ordered, arrives Thursday"). The people on '
        + 'the task, HR of the branch and the employee\'s manager may add notes; everyone on the task sees it. '
        + `At most ${PROVISIONING_COMMENT_MAX} characters.`,
      inputSchema: {
        task_id: idSchema('Task id: `id` of a task in the caller\'s task list or in a flow.'),
        text: z.string().trim().min(1).max(PROVISIONING_COMMENT_MAX).describe('The note.'),
      },
      outputSchema: provisioningCommentOutputSchema,
      annotations: ADDITIVE_WRITE,
    },
    async ({ task_id, text }, extra) => {
      try {
        await client.commentProvisioningTask(task_id, text, extra.signal);
        const message = 'The note was added to the task.';
        return toolResult(`## Note added\n\n${message}`, { taskId: task_id, commented: true, message });
      } catch (error) {
        return apiErrorResult(error, PROVISIONING_HINTS);
      }
    },
  );
}

const REFUSAL_TEXT: Record<string, string> = {
  OFF: SWITCHED_OFF,
  PAST_DATE: 'The first day is further in the past than the company setting allows, so no task would open.',
  EXCEL_OFF: 'Flows do not start for employees added from Excel (company setting).',
  API_OFF: 'Flows do not start for employees added through the API (company setting).',
};

const EXCLUDED_TEXT: Record<string, string> = {
  CONDITION: 'its conditions (position, department, branch) do not match',
  NOT_IN_PACKAGE: 'not in the position\'s package',
  REMOVED: 'taken out by hand',
};

export function registerPreviewProvisioning(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'preview_provisioning',
    {
      title: 'Preview preparation tasks',
      description: 'Show which preparation tasks would open for a new employee in a position starting on a day, '
        + 'without saving anything: each item, when it opens and is due, whether it would open late (urgent), what it '
        + 'waits for and who would do it, plus the items left out and why. For HR and whoever adds employees '
        + '(PEOPLE_ADD). `position_id` is a Teamso position id. Example: '
        + '`{ "position_id": "<id>", "start_date": "2026-12-01" }`. Read only.',
      inputSchema: {
        position_id: idSchema('Position of the new employee.'),
        start_date: dateSchema('First day (`yyyy-MM-dd`). Default: today.').optional(),
        department_id: idSchema('Department, when it differs from the position\'s.').optional(),
        branch_id: idSchema('Branch of the new employee.').optional(),
        manager_id: idSchema('Manager of the new employee (items done by the manager).').optional(),
      },
      outputSchema: provisioningPreviewOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ position_id, start_date, department_id, branch_id, manager_id }, extra) => {
      try {
        const result = await client.previewProvisioning({
          positionId: position_id,
          startDate: start_date,
          departmentId: department_id,
          branchId: branch_id,
          managerId: manager_id,
        }, extra.signal) ?? {};
        if (result.enabled === false) return errorResult(SWITCHED_OFF);
        const refusal = optionalString(result.refusal);
        const tasks = (result.tasks ?? []).map(task => compact({
          itemId: optionalString(task.itemId),
          name: optionalString(task.name) ?? '',
          category: optionalString(task.categoryName),
          quantity: optionalNumber(task.quantity),
          status: optionalString(task.status) ?? 'PLANNED',
          opensAt: displayTime(task.openAt),
          dueDate: toIsoDay(task.dueDate ?? undefined),
          urgent: task.urgent === true,
          waitsFor: optionalString(task.waitsFor),
          people: (task.assignees ?? []).map(person).filter(p => p.name),
          noAssignee: optionalString(task.noAssigneeReason) !== undefined,
        }));
        const excluded = (result.excluded ?? []).map(item => compact({
          name: optionalString(item.name) ?? '',
          category: optionalString(item.categoryName),
          reason: optionalString(item.reason) ?? 'CONDITION',
        }));
        const structured = compact({
          startDate: toIsoDay(result.startDate ?? undefined) ?? start_date,
          daysToStart: optionalNumber(result.daysToStart),
          enabled: true,
          setupDone: result.setupDone === true,
          wouldStart: !refusal,
          refusal,
          tasks,
          excluded,
          urgentCount: count(result.urgentCount),
          noAssigneeCount: count(result.noAssigneeCount),
        });
        const lines = [`## Preparation preview: first day ${structured.startDate ?? 'today'}`, ''];
        if (refusal) lines.push(REFUSAL_TEXT[refusal] ?? `No flow would start (${refusal}).`, '');
        if (!structured.setupDone) lines.push('The company has not finished the preparation setup yet.', '');
        lines.push(tasks.length
          ? markdownTable(
            ['Item', 'Opens', 'Due', 'Who', 'Note'],
            tasks.map(task => [
              task.quantity && task.quantity > 1 ? `${task.name} (${task.quantity})` : task.name,
              task.status === 'OPEN' ? 'at once' : task.opensAt,
              task.dueDate,
              task.people.map(p => p.name).join(', ') || (task.noAssignee ? 'nobody: HR gets it' : undefined),
              [task.urgent ? 'opens late (urgent)' : undefined, task.waitsFor ? `waits for ${task.waitsFor}` : undefined]
                .filter(Boolean).join('; ') || undefined,
            ]),
          )
          : 'No item would open for this position.');
        if (excluded.length) {
          lines.push('', 'Left out: ' + excluded.map(item => `${item.name} (${EXCLUDED_TEXT[item.reason] ?? item.reason})`)
            .join(', ') + '.');
        }
        lines.push('', 'Nothing was saved: the flow opens when the employee is added in Teamso.');
        return toolResult(lines.join('\n'), structured);
      } catch (error) {
        return apiErrorResult(error, PROVISIONING_HINTS);
      }
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
