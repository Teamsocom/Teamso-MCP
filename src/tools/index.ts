import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TeamsoClient } from '../client.js';
import { registerGetMe } from './account.js';
import { registerApproveOrRejectLeave, registerListPendingApprovals } from './approvals.js';
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
  list_announcements: registerListAnnouncements,
  list_my_payslips: registerListMyPayslips,
  get_payslip_pdf: registerGetPayslipPdf,
} as const satisfies Record<string, ToolRegistrar>;

export type ToolName = keyof typeof REGISTRARS;

export const TOOL_NAMES: readonly ToolName[] = Object.freeze(Object.keys(REGISTRARS) as ToolName[]);

export function registerTools(server: McpServer, client: TeamsoClient): void {
  for (const name of TOOL_NAMES) {
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
  registerListAnnouncements,
  registerListMyPayslips,
  registerGetPayslipPdf,
};
