import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TeamsoClient } from '../client.js';
import { registerGetMe } from './account.js';
import {
  registerCallApiRead,
  registerCallApiWrite,
  registerDescribeApiEndpoint,
  registerFindApiEndpoints,
  registerListApiModules,
  registerRequestSmsCode,
} from './api.js';
import { registerApproveOrRejectLeave, registerListPendingApprovals } from './approvals.js';
import { registerGiveBadge, registerListBadges, registerListMyBadges } from './badges.js';
import { registerListAnnouncements } from './communication.js';
import { registerGetEmployeeProfile, registerSearchEmployees } from './employees.js';
import {
  registerGetHelpArticle,
  registerListHelpModules,
  registerSearchHelpArticles,
} from './help.js';
import {
  registerCalculateLeaveDays,
  registerCancelLeaveRequest,
  registerCreateLeaveRequest,
  registerGetMyLeaveBalance,
  registerListLeaveTypes,
  registerListMyLeaves,
  registerRequestLeaveOtp,
} from './leave.js';
import { registerGetPayslipPdf, registerListMyPayslips } from './payroll.js';
import {
  registerApproveGoal,
  registerApproveGoalEvaluation,
  registerCreateUserGoal,
  registerListMyGoals,
  registerListPerformancePeriods,
  registerListTeamGoals,
  registerReviseAndApproveGoal,
  registerSendGoalsToApproval,
  registerUpdateGoalActualValue,
  registerUpdateManagerActualValue,
} from './performance.js';

type ToolRegistrar = (server: McpServer, client: TeamsoClient) => void;

/**
 * Every tool this package serves, in registration order. The names are a
 * contract: the hosted server routes any other tool name to the backend MCP,
 * and the documentation pages list exactly these.
 */
const REGISTRARS = {
  search_help_articles: registerSearchHelpArticles,
  get_help_article: registerGetHelpArticle,
  list_help_modules: registerListHelpModules,
  get_me: registerGetMe,
  list_leave_types: registerListLeaveTypes,
  get_my_leave_balance: registerGetMyLeaveBalance,
  calculate_leave_days: registerCalculateLeaveDays,
  request_leave_otp: registerRequestLeaveOtp,
  create_leave_request: registerCreateLeaveRequest,
  list_my_leaves: registerListMyLeaves,
  cancel_leave_request: registerCancelLeaveRequest,
  list_pending_approvals: registerListPendingApprovals,
  approve_or_reject_leave: registerApproveOrRejectLeave,
  search_employees: registerSearchEmployees,
  get_employee_profile: registerGetEmployeeProfile,
  list_performance_periods: registerListPerformancePeriods,
  list_my_goals: registerListMyGoals,
  list_team_goals: registerListTeamGoals,
  create_user_goal: registerCreateUserGoal,
  send_goals_to_approval: registerSendGoalsToApproval,
  approve_goal: registerApproveGoal,
  revise_and_approve_goal: registerReviseAndApproveGoal,
  update_goal_actual_value: registerUpdateGoalActualValue,
  update_manager_actual_value: registerUpdateManagerActualValue,
  approve_goal_evaluation: registerApproveGoalEvaluation,
  list_badges: registerListBadges,
  give_badge: registerGiveBadge,
  list_my_badges: registerListMyBadges,
  list_announcements: registerListAnnouncements,
  list_my_payslips: registerListMyPayslips,
  get_payslip_pdf: registerGetPayslipPdf,
  find_api_endpoints: registerFindApiEndpoints,
  list_api_modules: registerListApiModules,
  describe_api_endpoint: registerDescribeApiEndpoint,
  call_api_read: registerCallApiRead,
  call_api_write: registerCallApiWrite,
  request_sms_code: registerRequestSmsCode,
} as const satisfies Record<string, ToolRegistrar>;

export type ToolName = keyof typeof REGISTRARS;

export const TOOL_NAMES: readonly ToolName[] = Object.freeze(Object.keys(REGISTRARS) as ToolName[]);

/**
 * Tool groups for `TEAMSO_TOOLSETS` / the `toolsets` option. Every tool is in
 * exactly one group; `api` holds the generic tools that reach every module.
 */
export const TOOLSETS = Object.freeze({
  core: Object.freeze(['get_me']),
  help: Object.freeze(['search_help_articles', 'get_help_article', 'list_help_modules']),
  leave: Object.freeze([
    'list_leave_types',
    'get_my_leave_balance',
    'calculate_leave_days',
    'request_leave_otp',
    'create_leave_request',
    'list_my_leaves',
    'cancel_leave_request',
  ]),
  approvals: Object.freeze(['list_pending_approvals', 'approve_or_reject_leave']),
  employees: Object.freeze(['search_employees', 'get_employee_profile']),
  performance: Object.freeze([
    'list_performance_periods',
    'list_my_goals',
    'list_team_goals',
    'create_user_goal',
    'send_goals_to_approval',
    'approve_goal',
    'revise_and_approve_goal',
    'update_goal_actual_value',
    'update_manager_actual_value',
    'approve_goal_evaluation',
  ]),
  badges: Object.freeze(['list_badges', 'give_badge', 'list_my_badges']),
  communication: Object.freeze(['list_announcements']),
  payroll: Object.freeze(['list_my_payslips', 'get_payslip_pdf']),
  api: Object.freeze([
    'find_api_endpoints',
    'list_api_modules',
    'describe_api_endpoint',
    'call_api_read',
    'call_api_write',
    'request_sms_code',
  ]),
} as const satisfies Record<string, readonly ToolName[]>);

export type ToolsetName = keyof typeof TOOLSETS;

export const TOOLSET_NAMES: readonly ToolsetName[] = Object.freeze(Object.keys(TOOLSETS) as ToolsetName[]);

export interface RegisterToolsOptions {
  /**
   * Tool groups to serve (see TOOLSETS): an array or a comma-separated list such as
   * `"core,leave,api"`. `all`, an empty list or undefined serve every tool.
   */
  toolsets?: string | readonly string[];
}

/**
 * Tool names for a toolset selection, in TOOL_NAMES order. Throws on unknown
 * toolset names so a typo in `TEAMSO_TOOLSETS` is not silently ignored.
 */
export function resolveToolsets(toolsets?: string | readonly string[]): ToolName[] {
  const requested = (typeof toolsets === 'string' ? toolsets.split(',') : [...(toolsets ?? [])])
    .map(name => name.trim().toLowerCase())
    .filter(Boolean);
  if (requested.length === 0 || requested.includes('all')) return [...TOOL_NAMES];
  const unknown = requested.filter(name => !(TOOLSET_NAMES as readonly string[]).includes(name));
  if (unknown.length) {
    throw new Error(`Unknown Teamso toolset(s): ${unknown.join(', ')}. `
      + `Valid toolsets: ${TOOLSET_NAMES.join(', ')} (or all).`);
  }
  const selected = new Set<string>(requested.flatMap(name => TOOLSETS[name as ToolsetName]));
  return TOOL_NAMES.filter(name => selected.has(name));
}

export function registerTools(server: McpServer, client: TeamsoClient, options: RegisterToolsOptions = {}): void {
  for (const name of resolveToolsets(options.toolsets)) {
    REGISTRARS[name](server, client);
  }
}

export {
  registerSearchHelpArticles,
  registerGetHelpArticle,
  registerListHelpModules,
  registerGetMe,
  registerListLeaveTypes,
  registerGetMyLeaveBalance,
  registerCalculateLeaveDays,
  registerRequestLeaveOtp,
  registerCreateLeaveRequest,
  registerListMyLeaves,
  registerCancelLeaveRequest,
  registerListPendingApprovals,
  registerApproveOrRejectLeave,
  registerSearchEmployees,
  registerGetEmployeeProfile,
  registerListPerformancePeriods,
  registerListMyGoals,
  registerListTeamGoals,
  registerCreateUserGoal,
  registerSendGoalsToApproval,
  registerApproveGoal,
  registerReviseAndApproveGoal,
  registerUpdateGoalActualValue,
  registerUpdateManagerActualValue,
  registerApproveGoalEvaluation,
  registerListBadges,
  registerGiveBadge,
  registerListMyBadges,
  registerListAnnouncements,
  registerListMyPayslips,
  registerGetPayslipPdf,
  registerFindApiEndpoints,
  registerListApiModules,
  registerDescribeApiEndpoint,
  registerCallApiRead,
  registerCallApiWrite,
  registerRequestSmsCode,
};
