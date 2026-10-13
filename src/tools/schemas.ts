import { z } from 'zod';

/**
 * Output schemas (zod raw shapes) for every tool. MCP clients validate
 * `structuredContent` against the JSON Schema generated from these, which
 * forbids unknown keys, so projections in `utils/structured.ts` must produce
 * exactly these fields.
 */

export const nextActionSchema = z.object({
  tool: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  reason: z.string(),
});

const languageSchema = z.enum(['tr', 'en']);

// ------------------------------------------------------------------- help

export const helpArticleSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  module: z.string(),
  roles: z.array(z.string()),
  url: z.string(),
  resource: z.string(),
});

export const helpSearchOutputSchema = {
  lang: languageSchema,
  query: z.string(),
  results: z.array(helpArticleSummarySchema.extend({ score: z.number() })),
  nextAction: nextActionSchema.optional(),
};

export const helpArticleOutputSchema = {
  lang: languageSchema,
  article: helpArticleSummarySchema.extend({
    verified: z.string().optional(),
    routes: z.array(z.string()),
    related: z.array(z.string()),
  }),
};

export const helpModulesOutputSchema = {
  lang: languageSchema,
  modules: z.array(z.object({
    dir: z.string(),
    title: z.string(),
    description: z.string().optional(),
    articles: z.array(z.object({ id: z.string(), title: z.string() })),
  })),
};

// ---------------------------------------------------------------- account

const personRefSchema = z.object({
  id: z.string(),
  fullName: z.string(),
});

export const meOutputSchema = {
  user: z.object({
    id: z.string(),
    fullName: z.string(),
    name: z.string().optional(),
    surname: z.string().optional(),
    email: z.string().optional(),
    personnelId: z.string().optional(),
    company: z.object({ id: z.string().optional(), name: z.string().optional() }),
    department: z.string().optional(),
    position: z.string().optional(),
    branch: z.string().optional(),
    manager: personRefSchema.nullable(),
    roles: z.array(z.string()),
    permissions: z.array(z.string()),
    payrollManager: z.boolean(),
  }),
};

// ------------------------------------------------------------------ leave

const leavePolicySchema = z.object({
  leavePolicyUserId: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
});

export const leaveTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  remainingDays: z.number(),
  isDefault: z.boolean(),
  paid: z.boolean(),
  limitation: z.string().optional(),
  dayLimit: z.number().optional(),
  minDaysPerRequest: z.number().optional(),
  maxDaysPerRequest: z.number().optional(),
  documentRequired: z.boolean(),
  descriptionRequired: z.boolean(),
  birthdayLeave: z.boolean(),
  countsCalendarDays: z.boolean(),
});

export const leaveTypesOutputSchema = {
  policy: leavePolicySchema,
  leaveTypes: z.array(leaveTypeSchema),
};

export const leaveBalanceOutputSchema = {
  policy: leavePolicySchema,
  balances: z.array(z.object({
    leaveTypeId: z.string(),
    leaveTypeName: z.string(),
    remainingDays: z.number(),
    isDefault: z.boolean(),
  })),
};

const leaveRequestDraftSchema = z.object({
  leaveTypeId: z.string(),
  leaveTypeName: z.string(),
  start: z.string(),
  end: z.string(),
  workingDays: z.number(),
  returnToWorkDate: z.string().optional(),
});

export const leaveCalculationOutputSchema = {
  request: leaveRequestDraftSchema,
  remainingDays: z.number(),
  remainingAfterRequest: z.number(),
  canRequest: z.boolean(),
  problems: z.array(z.string()),
  nextAction: nextActionSchema.optional(),
};

export const otpOutputSchema = {
  sent: z.boolean(),
  validForSeconds: z.number(),
  message: z.string(),
  nextAction: nextActionSchema,
};

export const leaveSummarySchema = z.object({
  id: z.string(),
  leaveTypeId: z.string().optional(),
  leaveTypeName: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  workingDays: z.number().optional(),
  status: z.string(),
  statusCode: z.number().optional(),
  description: z.string().optional(),
  answer: z.string().optional(),
  createdAt: z.string().optional(),
});

export const leaveCreatedOutputSchema = {
  created: z.boolean(),
  request: leaveRequestDraftSchema,
  leave: leaveSummarySchema.nullable(),
  message: z.string(),
};

export const leaveListOutputSchema = {
  leaves: z.array(leaveSummarySchema),
  total: z.number(),
  truncated: z.boolean(),
};

export const leaveCancelledOutputSchema = {
  cancelled: z.boolean(),
  leave: leaveSummarySchema,
  closedPayrollPeriods: z.array(z.string()),
  message: z.string(),
};

// -------------------------------------------------------------- approvals

export const pendingApprovalSchema = z.object({
  leaveId: z.string(),
  requester: personRefSchema.nullable(),
  leaveTypeName: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  workingDays: z.number().optional(),
  description: z.string().optional(),
  approvalStep: z.number().optional(),
  createdAt: z.string().optional(),
});

export const pendingApprovalsOutputSchema = {
  approvals: z.array(pendingApprovalSchema),
  total: z.number(),
  truncated: z.boolean(),
  nextAction: nextActionSchema.optional(),
};

export const leaveDecisionOutputSchema = {
  leaveId: z.string(),
  decision: z.enum(['approved', 'rejected']),
  status: z.string(),
  statusCode: z.number().optional(),
  reason: z.string().optional(),
  closedPayrollPeriods: z.array(z.string()),
  message: z.string(),
};

// -------------------------------------------------------------- employees

export const employeeSummarySchema = z.object({
  id: z.string(),
  fullName: z.string(),
  email: z.string().optional(),
  personnelId: z.string().optional(),
  department: z.string().optional(),
  position: z.string().optional(),
  branch: z.string().optional(),
});

export const employeeSearchOutputSchema = {
  query: z.string(),
  source: z.enum(['directory', 'authorized_employees']),
  employees: z.array(employeeSummarySchema),
  total: z.number(),
  nextAction: nextActionSchema.optional(),
};

export const employeeProfileOutputSchema = {
  employee: z.object({
    id: z.string(),
    fullName: z.string(),
    email: z.string().optional(),
    phone: z.string().optional(),
    branch: z.string().optional(),
    department: z.string().optional(),
    position: z.string().optional(),
    manager: z.object({ id: z.string().optional(), fullName: z.string() }).nullable(),
    workLocation: z.string().optional(),
    workplace: z.string().optional(),
  }),
};

// ------------------------------------------------------------ performance

export const performancePeriodSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  targetEntryStartDate: z.string().optional(),
  targetEntryEndDate: z.string().optional(),
  targetEntryOpen: z.boolean(),
  targetEntryLocked: z.boolean(),
  goalEntryBy: z.string().optional(),
  successCriteriaEntryBy: z.string().optional(),
  minimumGoalCount: z.number().optional(),
  employeeCanSelectOther: z.boolean(),
  evaluationScale: z.array(z.object({
    label: z.string(),
    value: z.number().optional(),
    minPercentage: z.number().optional(),
    maxPercentage: z.number().optional(),
  })),
});

export const performancePeriodsOutputSchema = {
  periods: z.array(performancePeriodSchema),
};

export const goalSchema = z.object({
  id: z.string(),
  userId: z.string().optional(),
  userFullName: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  type: z.string().optional(),
  period: z.string().optional(),
  status: z.string(),
  weight: z.number().optional(),
  scaleCriterion: z.string().optional(),
  currency: z.string().optional(),
  otherText: z.string().optional(),
  targetValue: z.number().optional(),
  actualValue: z.number().optional(),
  actualText: z.string().optional(),
  managerActualValue: z.number().optional(),
  managerActualText: z.string().optional(),
  achievementPercentage: z.number().optional(),
  score: z.number().optional(),
  weightedScore: z.number().optional(),
  finalScore: z.number().optional(),
  finalScoreText: z.string().optional(),
  canApproveGoal: z.boolean(),
  canReviseGoal: z.boolean(),
  canEnterActualValue: z.boolean(),
  canApproveEvaluation: z.boolean(),
});

export const goalListOutputSchema = {
  period: z.string(),
  canAddGoal: z.boolean(),
  goals: z.array(goalSchema),
  total: z.number(),
  nextAction: nextActionSchema.optional(),
};

export const goalOutputSchema = {
  goal: goalSchema,
  message: z.string(),
  nextAction: nextActionSchema.optional(),
};

export const goalsSentOutputSchema = {
  goals: z.array(goalSchema),
  message: z.string(),
};

export const evaluationApprovalOutputSchema = {
  period: z.string(),
  userId: z.string(),
  newStatus: z.string().optional(),
  finalScore: z.number().optional(),
  finalScoreText: z.string().optional(),
  goals: z.array(goalSchema),
  message: z.string(),
};

// ---------------------------------------------------------- communication

export const announcementsOutputSchema = {
  announcements: z.array(z.object({
    id: z.string(),
    type: z.string().optional(),
    text: z.string(),
    date: z.string().optional(),
    sharedBy: z.string().optional(),
    coverPhotoUrl: z.string().optional(),
  })),
  total: z.number(),
};

// ---------------------------------------------------------------- payroll

export const payslipSchema = z.object({
  id: z.string(),
  term: z.string().optional(),
  status: z.string().optional(),
  sentToEmployeeAt: z.string().optional(),
  createdAt: z.string().optional(),
  canAnswer: z.boolean(),
  userAnswer: z.string().optional(),
  managerAnswer: z.string().optional(),
});

export const payslipListOutputSchema = {
  payslips: z.array(payslipSchema),
  total: z.number(),
  nextAction: nextActionSchema.optional(),
};

export const payslipPdfOutputSchema = {
  payslipId: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  resourceUri: z.string(),
};

// ---------------------------------------------------------------- API catalog

const sideEffectSchema = z.enum(['read', 'write', 'delete', 'read_with_writes']);
const smsModeSchema = z.enum(['always', 'conditional', 'never']);
const httpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export const apiEndpointSummarySchema = z.object({
  id: z.string(),
  method: httpMethodSchema,
  path: z.string(),
  module: z.string().optional(),
  moduleTitle: z.string().optional(),
  summary: z.string().optional(),
  sideEffect: sideEffectSchema,
  smsCodeRequired: smsModeSchema,
  fileResponse: z.boolean(),
  multipart: z.boolean(),
  access: z.string().optional(),
  conditional: z.boolean().optional(),
});

const apiSmsSchema = z.object({
  mode: smsModeSchema,
  when: z.string().optional(),
  preVerify: z.boolean(),
  credits: z.string().optional(),
});

export const apiEndpointListOutputSchema = {
  query: z.string().optional(),
  module: z.string().optional(),
  method: httpMethodSchema.optional(),
  sideEffect: sideEffectSchema.optional(),
  page: z.number(),
  size: z.number(),
  total: z.number(),
  totalPages: z.number(),
  endpoints: z.array(apiEndpointSummarySchema),
  nextAction: nextActionSchema.optional(),
};

export const apiModulesOutputSchema = {
  modules: z.array(z.object({
    code: z.string(),
    title: z.string(),
    description: z.string().optional(),
    endpointCount: z.number(),
    allowedCount: z.number(),
  })),
  nextAction: nextActionSchema.optional(),
};

export const apiEndpointDescriptionOutputSchema = {
  endpoint: apiEndpointSummarySchema.extend({
    accessReason: z.string().optional(),
    permission: z.string().optional(),
    moduleDescription: z.string().optional(),
    responseKind: z.string().optional(),
    doc: z.string().optional(),
    webScreens: z.array(z.string()),
  }),
  sms: apiSmsSchema.nullable(),
  parameters: z.array(z.object({
    name: z.string(),
    in: z.string(),
    required: z.boolean(),
    schema: z.record(z.string(), z.unknown()),
  })),
  requestBody: z.object({
    required: z.boolean(),
    validated: z.boolean().optional(),
    contentType: z.string(),
    schema: z.record(z.string(), z.unknown()),
  }).nullable(),
  notes: z.array(z.string()),
  related: z.array(z.string()),
  example: z.object({
    tool: z.enum(['call_api_read', 'call_api_write']),
    arguments: z.record(z.string(), z.unknown()),
  }),
  nextAction: nextActionSchema,
};

const apiTruncationSchema = z.object({
  originalChars: z.number(),
  arrayPath: z.string().optional(),
  originalItems: z.number().optional(),
  returnedItems: z.number().optional(),
  hint: z.string(),
});

const apiFileSchema = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  resourceUri: z.string(),
});

const apiResponseFields = {
  responseType: z.enum(['json', 'file']),
  status: z.number(),
  messageCode: z.string().optional(),
  message: z.string().optional(),
  result: z.unknown().optional(),
  truncated: z.boolean(),
  truncation: apiTruncationSchema.optional(),
  resultPreview: z.string().optional(),
  file: apiFileSchema.optional(),
};

const apiRequestSchema = z.object({
  method: httpMethodSchema,
  path: z.string(),
});

export const apiReadOutputSchema = {
  endpoint: apiEndpointSummarySchema,
  request: apiRequestSchema,
  ...apiResponseFields,
  warnings: z.array(z.string()),
};

export const apiWriteOutputSchema = {
  mode: z.enum(['preview', 'executed']),
  endpoint: apiEndpointSummarySchema,
  request: apiRequestSchema,
  summary: z.string(),
  validation: z.object({
    checked: z.boolean(),
    valid: z.boolean(),
    errors: z.array(z.string()),
  }),
  sms: apiSmsSchema.nullable(),
  smsVerified: z.boolean().optional(),
  body: z.unknown().optional(),
  files: z.array(z.object({
    field: z.string(),
    filename: z.string(),
    contentType: z.string(),
    sizeBytes: z.number(),
  })),
  warnings: z.array(z.string()),
  ...Object.fromEntries(Object.entries(apiResponseFields).map(([key, schema]) => [key, schema.optional()])) as {
    [K in keyof typeof apiResponseFields]: z.ZodOptional<typeof apiResponseFields[K]>
  },
  nextAction: nextActionSchema.optional(),
};
