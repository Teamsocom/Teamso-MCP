import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TeamsoClient } from '../client.js';
import type {
  TeamsoCostForecastAmounts,
  TeamsoCostForecastListItem,
  TeamsoCostForecastResultHead,
  TeamsoCostForecastStudyHead,
  TeamsoCostForecastSummary,
} from '../types.js';
import { toDisplayDateTime } from '../utils/dates.js';
import { markdownTable } from '../utils/format.js';
import { apiErrorResult, toolResult, type ApiErrorHints } from '../utils/results.js';
import { compact, optionalNumber, optionalString } from '../utils/structured.js';
import {
  costForecastBreakdownOutputSchema,
  costForecastListOutputSchema,
  costForecastSummaryOutputSchema,
} from './schemas.js';
import { READ_ONLY, idSchema } from './shared.js';

/** Where budget studies are created, calculated and edited: no tool does any of that (each calculation calls filika). */
export const COST_FORECAST_APP_URL = 'https://teamso.com/dashboard/cost-forecast';

/** The report step of a study in the web app. */
export function costForecastReportUrl(studyId: string): string {
  return `${COST_FORECAST_APP_URL}/${encodeURIComponent(studyId)}/rapor`;
}

/** Budget amounts are Turkish lira (the payroll engine calculates in TRY). */
export const COST_FORECAST_CURRENCY = 'TRY' as const;

const STATUSES = ['NOT_CALCULATED', 'CALCULATING', 'CURRENT', 'OUTDATED'] as const;
type Status = typeof STATUSES[number];

const BREAKDOWN_KEYS = ['branch', 'department', 'position'] as const;
type BreakdownKey = typeof BREAKDOWN_KEYS[number];

const UNASSIGNED = 'Not specified';

const COST_FORECAST_HINTS: ApiErrorHints = {
  byCode: {
    MODULE_DISABLED: 'Workforce Cost Forecast is not enabled for your company: the module is switched off '
      + '(Settings > Modules) or its package has not been bought. Ask your Teamso administrator.',
    COST_FORECAST_NOT_FOUND: 'Teamso could not find that budget study in your company (it may be archived), or that '
      + 'calculation is not one of its results. `list_cost_forecasts` lists the studies you can open.',
    PERMISSION_DENIED: 'You have no role on this budget study: studies are open to their owner, the people they '
      + 'are shared with and Workforce Cost Forecast admins.',
    COST_FORECAST_INVALID_INPUT: 'Teamso refused the request: `by` must be `branch`, `department` or `position`.',
  },
  forbidden: 'Budget studies need a Workforce Cost Forecast responsibility (admin, manager or viewer).',
  notFound: 'Teamso could not find that budget study, or it is not visible to you.',
};

// ------------------------------------------------------------- projections

function money(value: number | string | null | undefined): number | undefined {
  const parsed = optionalNumber(value);
  return parsed === undefined ? undefined : Math.round(parsed * 100) / 100;
}

function status(value: string | null | undefined): Status {
  return (STATUSES as readonly string[]).includes(value ?? '') ? value as Status : 'NOT_CALCULATED';
}

function amounts(value: TeamsoCostForecastAmounts | null | undefined) {
  return compact({
    employees: optionalNumber(value?.employees) ?? 0,
    gross: money(value?.gross) ?? 0,
    net: money(value?.net) ?? 0,
    totalCost: money(value?.totalCost) ?? 0,
    expenses: money(value?.expenses),
    totalCostWithExpenses: money(value?.totalCostWithExpenses),
  });
}

function toListItem(item: TeamsoCostForecastListItem) {
  const hidden = item.amountsHidden === true;
  return compact({
    id: item.id,
    name: optionalString(item.name) ?? item.id,
    startPeriod: optionalString(item.startPeriod),
    endPeriod: optionalString(item.endPeriod),
    monthCount: optionalNumber(item.monthCount),
    status: status(item.status),
    approvalStatus: optionalString(item.approvalStatus),
    activeBudget: item.activeBudget === true,
    owned: item.owned === true,
    lastCalculatedAt: toDisplayDateTime(item.lastCalculatedAt ?? undefined),
    runStatus: optionalString(item.runStatus),
    employees: optionalNumber(item.employees),
    limited: item.limited === true,
    amountsHidden: hidden,
    totalCost: hidden ? undefined : money(item.totalCost),
    totalCostWithExpenses: hidden ? undefined : money(item.totalCostWithExpenses),
    reportUrl: costForecastReportUrl(item.id),
  });
}

function toStudy(study: TeamsoCostForecastStudyHead | null | undefined, studyId: string) {
  return compact({
    id: optionalString(study?.id) ?? studyId,
    name: optionalString(study?.name) ?? studyId,
    startPeriod: optionalString(study?.startPeriod),
    endPeriod: optionalString(study?.endPeriod),
    monthCount: optionalNumber(study?.monthCount),
    approvalStatus: optionalString(study?.approvalStatus),
    headcount: study?.headcount === true,
  });
}

/** Study, status, run and scope of a summary or breakdown answer. */
function toHead(result: TeamsoCostForecastResultHead, studyId: string) {
  const study = toStudy(result.study, studyId);
  const run = result.run && optionalString(result.run.id)
    ? compact({
      id: optionalString(result.run.id)!,
      status: optionalString(result.run.status) ?? 'DONE',
      startedAt: toDisplayDateTime(result.run.startedAt ?? undefined),
      finishedAt: toDisplayDateTime(result.run.finishedAt ?? undefined),
      current: result.run.current === true,
      failedEmployees: optionalNumber(result.run.failedEmployees) ?? 0,
    })
    : undefined;
  const scope = result.scope
    ? { limited: result.scope.limited === true, employees: optionalNumber(result.scope.employees) ?? 0 }
    : undefined;
  return compact({
    study,
    status: status(result.status),
    calculated: result.calculated === true,
    run,
    scope,
    amountsHidden: result.amountsHidden === true,
    hasExpenses: result.hasExpenses === true,
    currency: COST_FORECAST_CURRENCY,
    reportUrl: costForecastReportUrl(study.id),
  });
}

function toRolling(rolling: TeamsoCostForecastSummary['rolling']) {
  if (!rolling) return undefined;
  return compact({
    actualsThrough: optionalString(rolling.actualsThrough),
    yearEnd: money(rolling.yearEnd),
    approvedName: optionalString(rolling.approved?.name),
    approvedTotal: money(rolling.approved?.total),
    difference: money(rolling.difference),
    differencePct: optionalNumber(rolling.differencePct),
  });
}

// ----------------------------------------------------------------- helpers

const NUMBER = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatTry(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${NUMBER.format(value)} ${COST_FORECAST_CURRENCY}`;
}

function period(start: string | undefined, end: string | undefined): string | undefined {
  if (!start && !end) return undefined;
  return start === end || !end ? start : `${start ?? '?'} to ${end}`;
}

const STATUS_TEXT: Record<Status, string> = {
  NOT_CALCULATED: 'not calculated',
  CALCULATING: 'calculating',
  CURRENT: 'up to date',
  OUTDATED: 'changed since the last calculation',
};

/** Lines every summary and breakdown starts with: period, state of the numbers, whose employees are counted. */
function headLines(head: ReturnType<typeof toHead>): string[] {
  const lines: string[] = [];
  const facts = [
    period(head.study.startPeriod, head.study.endPeriod) ? `Period: ${period(head.study.startPeriod, head.study.endPeriod)}` : undefined,
    `Status: ${STATUS_TEXT[head.status]}`,
    head.run?.finishedAt ? `Calculated: ${head.run.finishedAt} (Turkey time)` : undefined,
    head.study.approvalStatus && head.study.approvalStatus !== 'DRAFT' ? `Approval: ${head.study.approvalStatus}` : undefined,
  ].filter(Boolean);
  lines.push(facts.join(' · '));
  if (head.run && !head.run.current) {
    lines.push('', head.status === 'OUTDATED' || head.status === 'CALCULATING'
      ? 'The study changed after this calculation; the numbers are from the last calculation.'
      : 'These are the numbers of an earlier calculation, not the study\'s latest result.');
  }
  if (head.run && head.run.failedEmployees > 0) {
    lines.push('', `${head.run.failedEmployees} employee(s) have months that could not be calculated; those months `
      + 'are not in the totals.');
  }
  if (head.amountsHidden) {
    lines.push('', 'None of the calculated employees are visible to this account (salary right or branch scope), so '
      + 'no amounts are shown.');
  } else if (head.scope?.limited) {
    lines.push('', `Totals cover only the ${head.scope.employees} employee(s) this account may see (salary right and `
      + 'branch scope).');
  }
  if (head.study.headcount) lines.push('', 'Headcount study: the rows are positions, employees counts people.');
  return lines;
}

function notCalculatedText(head: ReturnType<typeof toHead>): string {
  const running = head.status === 'CALCULATING' ? ' A calculation is running now.' : '';
  return `## ${head.study.name}\n\n${headLines(head).join('\n')}\n\nThis study has no calculated result yet.${running} `
    + `Calculations run in the Teamso web app: ${head.reportUrl}`;
}

// ------------------------------------------------------------------- tools

export function registerListCostForecasts(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_cost_forecasts',
    {
      title: 'List Workforce Cost Forecast budget studies',
      description: 'List the Workforce Cost Forecast budget studies ("bütçe çalışmaları") the caller may open, latest '
        + 'period first, with name, period, status (`NOT_CALCULATED`, `CALCULATING`, `CURRENT`, or `OUTDATED` when the '
        + 'study changed after its last calculation), approval status, last calculation time and the total cost of the '
        + 'last result in TRY. Totals cover only the employees the caller may see (salary right and branch scope); '
        + '`amountsHidden` marks a study whose calculated employees are all outside them. Read only: nothing is '
        + 'calculated or changed.',
      inputSchema: {
        query: z.string().trim().min(1).max(100).optional()
          .describe('Words in the study name (Turkish characters optional).'),
        limit: z.number().int().min(1).max(50).default(20).describe('Maximum studies (1-50, default 20).'),
      },
      outputSchema: costForecastListOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ query, limit }, extra) => {
      try {
        const listed = await client.listCostForecasts({ query, limit }, extra.signal);
        const studies = (listed?.studies ?? []).filter(item => optionalString(item?.id)).map(toListItem);
        const total = optionalNumber(listed?.total) ?? studies.length;
        const first = studies.find(study => study.totalCost !== undefined);
        const structured = compact({
          studies,
          total,
          returned: studies.length,
          currency: COST_FORECAST_CURRENCY,
          appUrl: COST_FORECAST_APP_URL,
          nextAction: first
            ? {
              tool: 'get_cost_forecast_summary',
              arguments: { study_id: first.id },
              reason: 'KPIs and monthly totals of one study.',
            }
            : undefined,
        });
        if (studies.length === 0) {
          return toolResult(query
            ? `No budget study matches "${query}".`
            : `There are no budget studies you can open. Studies are created in the Teamso web app: ${COST_FORECAST_APP_URL}`,
          structured);
        }
        const table = markdownTable(
          ['Study', 'Period', 'Status', 'Last calculation', 'Employees', 'Total cost', 'Id'],
          studies.map(study => [
            study.activeBudget ? `${study.name} (approved budget)` : study.name,
            period(study.startPeriod, study.endPeriod),
            STATUS_TEXT[study.status],
            study.lastCalculatedAt,
            study.employees !== undefined ? `${study.employees}${study.limited ? ' (visible to you)' : ''}` : undefined,
            study.amountsHidden ? 'hidden' : formatTry(study.totalCost),
            `\`${study.id}\``,
          ]),
        );
        const more = total > studies.length ? `\n\nShowing ${studies.length} of ${total} studies.` : '';
        const notes: string[] = [];
        if (studies.some(study => study.limited)) {
          notes.push('Totals cover only the employees you may see (salary right and branch scope).');
        }
        if (studies.some(study => study.amountsHidden)) {
          notes.push('"hidden": none of the calculated employees are visible to you.');
        }
        const footer = notes.length ? `\n\n${notes.join(' ')}` : '';
        return toolResult(`## Budget studies (Workforce Cost Forecast)\n\n${table}${more}${footer}`, structured);
      } catch (error) {
        return apiErrorResult(error, COST_FORECAST_HINTS);
      }
    },
  );
}

export function registerGetCostForecastSummary(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'get_cost_forecast_summary',
    {
      title: 'Get a budget study summary',
      description: 'KPIs and monthly totals of a Workforce Cost Forecast budget study: employees, payroll months, '
        + 'gross salary, other gross pay, total gross, net, total employer cost and expenses in TRY, and per month '
        + 'employees, gross, net and total cost, from the last calculation (or `run_id`). A rolling study also gets the '
        + 'year-end forecast against the approved budget. Totals cover only the employees the caller may see (salary '
        + 'right and branch scope); without any visible employee no amount is returned. Read only: nothing is '
        + 'calculated or changed.',
      inputSchema: {
        study_id: idSchema('Budget study id (`id` in the study list).'),
        run_id: idSchema('A finished calculation of the study (`run.id`). Default: its last result.').optional(),
      },
      outputSchema: costForecastSummaryOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ study_id, run_id }, extra) => {
      try {
        const result = await client.getCostForecastSummary(study_id, { runId: run_id }, extra.signal) ?? {};
        const head = toHead(result, study_id);
        const kpis = head.calculated && !head.amountsHidden && result.kpis
          ? compact({
            ...amounts(result.kpis),
            payrolls: optionalNumber(result.kpis.payrolls),
            grossSalary: money(result.kpis.grossSalary),
            grossBenefits: money(result.kpis.grossBenefits),
          })
          : undefined;
        const months = kpis
          ? (result.months ?? [])
            .filter(month => optionalString(month?.period))
            .map(month => ({ period: optionalString(month.period)!, ...amounts(month) }))
          : [];
        const rolling = kpis ? toRolling(result.rolling) : undefined;
        const structured = compact({
          ...head,
          kpis,
          months,
          rolling,
          nextAction: kpis
            ? {
              tool: 'get_cost_forecast_breakdown',
              arguments: { study_id: head.study.id, by: 'department' },
              reason: 'Total cost by branch, department or position.',
            }
            : undefined,
        });
        if (!head.calculated) return toolResult(notCalculatedText(head), structured);

        const lines = [`## ${head.study.name}`, '', ...headLines(head)];
        if (kpis) {
          const rows: Array<[string, string | number | undefined]> = [
            [head.study.headcount ? 'People' : 'Employees', kpis.employees],
            ['Payroll months', kpis.payrolls],
            ['Gross salary', formatTry(kpis.grossSalary)],
            ['Other gross pay', formatTry(kpis.grossBenefits)],
            ['Total gross', formatTry(kpis.gross)],
            ['Net pay', formatTry(kpis.net)],
            ['Total employer cost', formatTry(kpis.totalCost)],
          ];
          if (kpis.expenses !== undefined) rows.push(['Expenses', formatTry(kpis.expenses)]);
          if (kpis.totalCostWithExpenses !== undefined) {
            rows.push(['Total cost with expenses', formatTry(kpis.totalCostWithExpenses)]);
          }
          lines.push('', markdownTable(['KPI', 'Value'], rows.filter(([, value]) => value !== undefined)));
          if (months.length) {
            const withExpenses = months.some(month => month.totalCostWithExpenses !== undefined);
            lines.push('', '### Monthly totals', '', markdownTable(
              ['Month', 'Employees', 'Gross', 'Net', 'Total cost', ...(withExpenses ? ['With expenses'] : [])],
              months.map(month => [
                month.period,
                month.employees,
                formatTry(month.gross),
                formatTry(month.net),
                formatTry(month.totalCost),
                ...(withExpenses ? [formatTry(month.totalCostWithExpenses)] : []),
              ]),
            ));
          }
          if (rolling?.yearEnd !== undefined) {
            const against = rolling.approvedTotal !== undefined
              ? ` against the approved budget${rolling.approvedName ? ` "${rolling.approvedName}"` : ''} `
                + `(${formatTry(rolling.approvedTotal)}): ${formatTry(rolling.difference)}`
                + `${rolling.differencePct !== undefined ? ` (${rolling.differencePct}%)` : ''}`
              : '';
            const through = rolling.actualsThrough ? `, actual payrolls through ${rolling.actualsThrough}` : '';
            lines.push('', `Year-end forecast${through}: ${formatTry(rolling.yearEnd)}${against}.`);
          }
        }
        lines.push('', `Report in the Teamso web app: ${head.reportUrl}`);
        return toolResult(lines.join('\n'), structured);
      } catch (error) {
        return apiErrorResult(error, COST_FORECAST_HINTS);
      }
    },
  );
}

export function registerGetCostForecastBreakdown(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'get_cost_forecast_breakdown',
    {
      title: 'Get a budget study breakdown',
      description: 'Total cost of a Workforce Cost Forecast budget study by branch, department or position, the '
        + 'largest first: employees, gross, net, total employer cost (with expenses when the study has them) in TRY '
        + 'and share of the total, from the last calculation (or `run_id`). Groups only, never single employees. '
        + 'Totals cover only the employees the caller may see (salary right and branch scope); without any visible '
        + 'employee no amount is returned. Read only: nothing is calculated or changed.',
      inputSchema: {
        study_id: idSchema('Budget study id (`id` in the study list).'),
        by: z.enum(BREAKDOWN_KEYS).default('department')
          .describe('Group by `branch`, `department` (default) or `position`.'),
        run_id: idSchema('A finished calculation of the study (`run.id`). Default: its last result.').optional(),
        limit: z.number().int().min(1).max(200).default(50).describe('Maximum groups (1-200, default 50).'),
      },
      outputSchema: costForecastBreakdownOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ study_id, by, run_id, limit }, extra) => {
      try {
        const result = await client.getCostForecastBreakdown(study_id, { by, runId: run_id, limit }, extra.signal)
          ?? {};
        const head = toHead(result, study_id);
        const visible = head.calculated && !head.amountsHidden;
        const groups = visible
          ? (result.groups ?? []).map(group => {
            const name = optionalString(group?.name);
            return {
              name: name ?? UNASSIGNED,
              unassigned: name === undefined,
              ...amounts(group),
              share: optionalNumber(group?.share) ?? 0,
            };
          })
          : [];
        const key: BreakdownKey = (BREAKDOWN_KEYS as readonly string[]).includes(result.by ?? '')
          ? result.by as BreakdownKey
          : by;
        const totals = visible && result.totals ? amounts(result.totals) : undefined;
        const groupCount = optionalNumber(result.groupCount) ?? groups.length;
        const structured = compact({
          ...head,
          by: key,
          groups,
          groupCount,
          truncated: result.truncated === true,
          totals,
        });
        if (!head.calculated) return toolResult(notCalculatedText(head), structured);

        const label = { branch: 'Branch', department: 'Department', position: 'Position' }[key];
        const lines = [`## ${head.study.name}: total cost by ${key}`, '', ...headLines(head)];
        if (groups.length) {
          const withExpenses = groups.some(group => group.totalCostWithExpenses !== undefined);
          lines.push('', markdownTable(
            [label, head.study.headcount ? 'People' : 'Employees', 'Total cost', 'Share',
              ...(withExpenses ? ['With expenses'] : []), 'Gross', 'Net'],
            groups.map(group => [
              group.name,
              group.employees,
              formatTry(group.totalCost),
              `${group.share}%`,
              ...(withExpenses ? [formatTry(group.totalCostWithExpenses)] : []),
              formatTry(group.gross),
              formatTry(group.net),
            ]),
          ));
          if (totals) lines.push('', `Total: ${formatTry(totals.totalCost)} for ${totals.employees} employee(s).`);
          if (structured.truncated) lines.push('', `Showing the ${groups.length} largest of ${groupCount} groups.`);
        }
        lines.push('', `Report in the Teamso web app: ${head.reportUrl}`);
        return toolResult(lines.join('\n'), structured);
      } catch (error) {
        return apiErrorResult(error, COST_FORECAST_HINTS);
      }
    },
  );
}
