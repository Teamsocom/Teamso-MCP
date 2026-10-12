import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import Ajv2020 from 'ajv/dist/2020.js';
import { TeamsoClient } from '../dist/client.js';
import { createMcpServer } from '../dist/server.js';

export const API_BASE = 'https://api.teamso.test/v1';
export const HELP_BASE = 'https://help.teamso.test';
export const TOKEN = 'tms_pat_test_token';
export const VALID_OTP = '123456';

export function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** A Teamso `BaseResponseVO`. */
export function envelope(result, messageCode = 'GET_SUCCESS', extra = {}) {
  return {
    code: 1,
    message: messageCode,
    message_code: messageCode,
    ...(result === undefined ? {} : { result }),
    ...extra,
  };
}

/** HTTP 200 + `code: 1` that is still a failure. */
export function softFailure(messageCode, message = messageCode, result) {
  return envelope(result, messageCode, { message });
}

/** HTTP 400 + `code: 0`. */
export function hardFailure(message, messageCode, status = 400) {
  return json({ code: 0, message, message_code: messageCode }, status);
}

// ------------------------------------------------------------------ fixtures

export const ME = {
  id: 'u-1',
  name: 'Ayşe',
  surname: 'Yılmaz',
  fullname: 'Ayşe Yılmaz',
  email: 'ayse@acme.test',
  personnelId: 'P-001',
  companyId: 'c-1',
  companyName: 'Acme',
  identificationNumber: '12345678901',
  company: { id: 'c-1', name: 'Acme', taxNumber: 'secret' },
  roles: [{ id: 'r-1', name: 'COMPANY_USER' }],
  permissions: [
    { id: 'p1', code: 'LEAVE_ADD' },
    { id: 'p2', code: 'LEAVE_ADD' },
    { id: 'p3', code: 'PEOPLE_READ' },
  ],
  userTask: { userPosition: { name: 'Engineer', department: { name: 'R&D' } } },
  userManager: { id: 'u-9', fullname: 'Mehmet Demir' },
  branchName: { id: 'b-1', name: 'İstanbul' },
  payrollManager: false,
};

export const POLICIES = [
  { activated: false, leavePolicyUserId: 'lpu-old', leavePolicy: { id: 'lp-0', name: 'Old' } },
  { activated: true, leavePolicyUserId: 'lpu-1', leavePolicy: { id: 'lp-1', name: 'Standart' } },
];

export const BALANCES = [
  {
    leaveTypeRequestModel: {
      id: 'lt-annual',
      name: 'Yıllık İzin',
      primary: true,
      paid: true,
      leastDayCount: '',
      mostDayCount: '10',
      documentRequired: false,
      descriptionRequired: false,
      overriddenHolidays: false,
    },
    right: 14,
  },
  {
    leaveTypeRequestModel: { id: 'lt-sick', name: 'Rapor', paid: true, documentRequired: true },
    right: 0,
  },
  {
    leaveTypeRequestModel: { id: 'lt-calendar', name: 'Doğum İzni', paid: true, overriddenHolidays: true },
    right: 112,
  },
];

export const WORKING_DAYS = {
  id: 'wd-1',
  workingDaysDetailRequestModels: [
    { dayName: 'SUNDAY', visible: false },
    { dayName: 'MONDAY', shiftStart: '08:30:00', shiftEnd: '17:30:00', visible: true },
  ],
};

// Real listAllLeavesAdvancedPagination items: the owner is in `user`, the flat
// `userId` and `leaveTypeId` are null.
export const MY_LEAVE = {
  id: 'l-1',
  userId: null,
  user: { id: 'u-1', name: 'Ayşe', surname: 'Yılmaz' },
  leaveTypeId: null,
  leaveTypeRequestModel: { id: 'lt-annual', name: 'Yıllık İzin' },
  totalLeaveDay: 2,
  state: 0,
  approvalQueue: 1,
  startDate: '2026-10-20 08:30',
  endDate: '2026-10-21 17:30',
  canApprove: false,
  createdAt: '2026-10-01T09:00:00.000+03:00',
};

export const NEW_LEAVE = {
  ...MY_LEAVE,
  id: 'l-new',
  totalLeaveDay: 3,
  startDate: '2026-11-02 08:30',
  endDate: '2026-11-04 17:30',
};

export const TEAM_LEAVE = {
  id: 'l-2',
  userId: null,
  user: { id: 'u-2', name: 'Can', surname: 'Öztürk' },
  leaveTypeRequestModel: { id: 'lt-annual', name: 'Yıllık İzin' },
  totalLeaveDay: 1,
  state: 0,
  approvalQueue: 1,
  description: 'Family visit',
  startDate: '2026-10-22 08:30',
  endDate: '2026-10-22 17:30',
  canApprove: true,
};

export const OTHER_PENDING_LEAVE = { ...TEAM_LEAVE, id: 'l-3', canApprove: false, approvalQueue: 2 };

export const PERIOD = {
  id: 'per-1',
  title: 'Q4 2026',
  startDate: '2026-10-01T00:00:00.000+00:00',
  endDate: '2026-12-31T00:00:00.000+00:00',
  targetEntryStartDate: '2026-10-01T00:00:00.000+00:00',
  targetEntryEndDate: '2026-10-31T00:00:00.000+00:00',
  goalEntryBy: 'EMPLOYEE',
  employeeCanSelectOther: true,
  evaluationScale: [
    { label: 'Beklenen', value: 100, minPercentage: 80, maxPercentage: 110, displayOrder: 2 },
    { label: 'Gelişmeli', value: 50, minPercentage: 0, maxPercentage: 80, displayOrder: 1 },
  ],
  status: 'ACTIVE',
  isTargetEntryOpen: true,
  isTargetEntryLocked: false,
};

export function goal(overrides = {}) {
  return {
    id: 'g-1',
    userId: 'u-1',
    userFullName: 'Ayşe Yılmaz',
    name: 'Bayi satışı',
    description: 'Q4 bayi satış hedefi',
    type: 'PERSONAL',
    weight: 40,
    periodName: 'Q4 2026',
    status: 'PENDING',
    targetValueDefinition: {
      scaleCriterion: 'QUANTITY',
      scores: [
        { text: 'Hedeflenen Performans', value: 120, key: 'targetedPerformance' },
        { text: 'Gelişmeli', value: 50 },
      ],
    },
    canApprove: false,
    canApproveGoal: false,
    canEnterActualValue: false,
    canReviseGoal: false,
    ...overrides,
  };
}

export const HELP_BUNDLE = {
  lang: 'tr',
  helpCenter: 'https://help.teamso.com/tr/',
  modules: [
    {
      dir: 'performance',
      code: 'PERFORMANCE',
      title: 'Performans',
      description: 'Hedefler ve değerlendirme.',
      articles: ['performance.overview', 'performance.goal-entry-employee', 'performance.missing'],
    },
    { dir: 'empty', code: 'EMPTY', title: 'Boş modül', articles: [] },
  ],
  articles: [
    {
      id: 'performance.overview',
      lang: 'tr',
      module: 'PERFORMANCE',
      dir: 'performance',
      title: 'Performans modülüne genel bakış: hedef girişi',
      summary: 'Hedef girişi, onay ve değerlendirme.',
      roles: ['ADMIN', 'MANAGER', 'EMPLOYEE'],
      routes: ['/dashboard/goal'],
      related: ['performance.goal-entry-employee'],
      order: 0,
      verified: '2026-10-12',
      url: '/dashboard/help?article=performance.overview',
      body: '## Genel\n\nHedef ekranı.',
    },
    {
      id: 'performance.goal-entry-employee',
      lang: 'tr',
      module: 'PERFORMANCE',
      dir: 'performance',
      title: 'Çalışan olarak hedef girişi',
      summary: 'Kendi hedeflerinizi girip onaya gönderin.',
      roles: ['EMPLOYEE'],
      routes: ['/dashboard/goal'],
      related: ['performance.overview'],
      order: 1,
      verified: '2026-10-12',
      url: 'https://help.teamso.com/tr/articles/1-hedef-girisi',
      body: '## Adımlar\n\n1. Hedef ekle.\n\n![Ekran](/how-to/performance/goal.png)\n\n'
        + 'Bkz. [genel bakış](how-to:performance.overview).',
    },
    {
      id: 'leave.request',
      lang: 'tr',
      module: 'LEAVE',
      dir: 'leave',
      title: 'İzin talebi oluşturma',
      summary: 'Yıllık izin talebi.',
      roles: ['EMPLOYEE'],
      order: 0,
      url: '/dashboard/help?article=leave.request',
      body: 'İzin talebi adımları.',
    },
  ],
};

// ----------------------------------------------------------------- mock API

export function defaultRoutes() {
  return [
    [`GET ${new URL(HELP_BASE).host}/how-to/bundle.tr.json`, () => HELP_BUNDLE],
    ['GET /user', () => envelope(ME)],
    ['GET /leave-policy/getListAllLeavePolicyForUser', () => envelope(POLICIES)],
    ['GET /leave-policy/getDetailLeavePolicyForUser/lpu-1', () => envelope(BALANCES)],
    ['GET /working-days/getWorkingDaysByMe', () => envelope(WORKING_DAYS)],
    ['GET /public-holiday/getPublicHolidayByMe', () => envelope({ id: 'ph-1', name: 'Resmi tatiller' })],
    [/^GET \/leave\/dayCalculator\//, () => envelope({ totalWorkingDays: 3, returnToWorkDate: '2026-11-05 08:30' })],
    ['POST /leave/controlToAddLeave', () => envelope({ allUserError: [], singleUserError: [] })],
    ['GET /sms/generateToken', () => envelope(undefined, 'INSERT_SUCCESS', { message: 'Insert Success' })],
    [`GET /sms/checkToken/${VALID_OTP}`, () => envelope(undefined, 'INSERT_SUCCESS', { message: 'validation successful' })],
    [/^GET \/sms\/checkToken\//, () => hardFailure('validation error.The token is not correct.', 'ITEM_NOT_FOUND')],
    ['POST /leave', () => envelope(undefined, 'INSERT_SUCCESS', { message: null })],
    ['GET /leave/listAllLeavesAdvancedPagination', call => {
      const items = call.query.searchKey === 'state'
        ? [TEAM_LEAVE, OTHER_PENDING_LEAVE, MY_LEAVE]
        : [NEW_LEAVE, TEAM_LEAVE, MY_LEAVE];
      return envelope({
        items,
        pagination: { currentPage: 0, pageSize: 100, totalRecords: items.length, totalPages: 1, hasNext: false },
      });
    }],
    ['DELETE /leave/l-1', () => envelope({ closedPayrollPeriods: [] }, 'DELETE_SUCCESS')],
    [/^PUT \/leave\/state\/l-2\//, call => envelope(
      { id: 'l-2', status: call.path.split('/')[4] === 'true' ? 2 : 3, approvalQueue: 1 },
      'ANSWER_SUCCESS',
    )],
    ['GET /dashboard/getPendingTransactionsByRequestOwner', () => envelope([])],
    ['GET /user/list-pagination', () => envelope({
      items: [{
        id: 'u-2',
        name: 'Can',
        surname: 'Öztürk',
        fullname: 'Can Öztürk',
        email: 'can@acme.test',
        branch: { id: 'b-1', name: 'İstanbul' },
        userTask: { userPosition: { name: 'Sales', department: { name: 'Satış' } } },
      }],
      pagination: { totalRecords: 1, hasNext: false },
    })],
    ['GET /authorized-employee/list', () => envelope([
      { id: 'u-2', name: 'Can', surname: 'Öztürk', fullName: 'Can Öztürk', email: 'can@acme.test', active: true },
      { id: 'u-3', name: 'Şule', surname: 'Kaya', fullName: 'Şule Kaya', active: true },
    ])],
    ['GET /user/getUserSummaryByUserId/u-2', () => envelope({
      id: 'u-2',
      fullname: 'Can Öztürk',
      branchName: 'İstanbul',
      departmentName: 'Satış',
      positionName: 'Sales',
      tel: '*** *** ** 12',
      email: 'can@acme.test',
      manager: 'Ayşe Yılmaz',
      managerId: 'u-1',
      workPlaceName: 'Merkez',
    })],
    ['GET /performance-settings', () => envelope({ id: 's-1', periods: [PERIOD] })],
    ['GET /user-goal/my', () => envelope({
      goals: [goal()],
      canAddGoal: true,
      pagination: { currentPage: 0, totalPages: 1, hasNext: false },
    })],
    ['GET /user-goal/assigned', () => envelope({
      goals: [goal({
        id: 'g-2',
        userId: 'u-2',
        userFullName: 'Can Öztürk',
        status: 'WAITING_APPROVAL',
        canApproveGoal: true,
        canReviseGoal: true,
      })],
      canAddGoal: true,
      pagination: { hasNext: false },
    })],
    ['GET /user-goal/g-1', () => envelope(goal())],
    ['GET /user-goal/g-2', () => envelope(goal({ id: 'g-2', userId: 'u-2', status: 'WAITING_APPROVAL' }))],
    ['POST /user-goal', call => envelope(goal({
      id: 'g-new',
      name: call.body.name,
      weight: call.body.weight,
      targetValueDefinition: call.body.targetValueDefinition,
    }), 'INSERT_SUCCESS')],
    ['POST /user-goal/send-to-approval', () => envelope([goal({ status: 'WAITING_APPROVAL' })], 'UPDATE_SUCCESS', {
      message: 'SEND_TO_APPROVAL_SUCCESS',
    })],
    ['GET /user-goal/approve/g-2', () => envelope(goal({ id: 'g-2', status: 'APPROVED' }), 'UPDATE_SUCCESS', {
      message: 'APPROVE_SUCCESS',
    })],
    ['PUT /user-goal/revise-and-approve/g-2', call => envelope(goal({
      id: 'g-2',
      status: 'REVISED_AND_APPROVED',
      weight: call.body.weight ?? 40,
      targetValueDefinition: call.body.targetValueDefinition ?? goal().targetValueDefinition,
    }), 'UPDATE_SUCCESS')],
    ['PUT /user-goal/g-1/actual-value', call => envelope(goal({
      status: 'EVALUATED',
      actualValue: Number(call.query.actualValue),
    }), 'UPDATE_SUCCESS')],
    ['PUT /user-goal/g-2/manager-actual-value', call => envelope(goal({
      id: 'g-2',
      status: 'EVALUATED',
      managerActualValue: Number(call.query.managerActualValue),
    }), 'UPDATE_SUCCESS')],
    ['POST /user-goal/approve-evaluation-process', () => envelope({
      goals: [goal({ id: 'g-2', status: 'COMPLETED', score: 4.2 })],
      newStatus: 'COMPLETED',
      periodName: 'Q4 2026',
      userId: 'u-2',
      finalScore: 4.2,
      finalScoreText: 'Beklenen',
    }, 'UPDATE_SUCCESS', { message: 'EVALUATION_PROCESS_APPROVED' })],
    ['GET /dashboard/getAnnouncements', () => envelope({
      canAdd: false,
      announcementListResponseDto: [
        {
          id: 'a-1',
          announcementType: 'companyAnnouncement',
          announcement: '<p>Yeni&nbsp;<b>ofis</b> açıldı</p><p>Detaylar &amp; saatler</p>',
          date: '2026-10-10',
          sharedUser: { id: 'u-5', name: 'İK', surname: 'Ekibi' },
          relatingTo: [],
        },
        { id: 'a-2', announcementType: 'busAnnouncement', announcement: 'Servis 08:00', date: '2026-10-09' },
      ],
    })],
    ['GET /payroll/getPayrollsByMe-pagination', () => envelope({
      content: [{
        id: 'pay-1',
        term: '2026-09',
        status: 'SENT_TO_EMPLOYEE',
        canAnswer: true,
        sentToEmployeeAt: '2026-10-01 10:00:00',
        createdAt: '2026-09-30',
        pdfList: [],
      }],
      pagination: { currentPage: 0, pageSize: 12, totalElements: 1, totalPages: 1, hasNext: false },
    })],
    ['GET /payroll/download-file/pay-1', () => new Response(PDF_BYTES, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="bordro-2026-09.pdf"',
      },
    })],
  ];
}

export const PDF_BYTES = new TextEncoder().encode('%PDF-1.4 test payslip');

/**
 * A fetch double that answers from `routes` (first match wins; `overrides`
 * come first) and records every request.
 */
export function createMockApi(overrides = []) {
  const routes = [...overrides, ...defaultRoutes()];
  const calls = [];
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const isApi = url.origin === new URL(API_BASE).origin;
    const path = isApi ? url.pathname.replace(/^\/v1/, '') : `${url.host}${url.pathname}`;
    const call = {
      method,
      path,
      url,
      query: Object.fromEntries(url.searchParams),
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const key = `${method} ${path}`;
    const route = routes.find(([matcher]) => (matcher instanceof RegExp ? matcher.test(key) : matcher === key));
    if (!route) throw new Error(`Unexpected request: ${key}`);
    const response = await route[1](call);
    return response instanceof Response ? response : json(response);
  };
  return { fetch, calls };
}

export function createTestClient(fetch, options = {}) {
  return new TeamsoClient(TOKEN, API_BASE, { fetch, helpBaseUrl: HELP_BASE, ...options });
}

const ajv = new Ajv2020({ strict: false, allErrors: true });

/**
 * Connects an MCP client to a fresh server over an in-memory transport and
 * lists the tools first, so the SDK client validates every `structuredContent`.
 */
export async function withMcp(overrides, callback) {
  const api = createMockApi(overrides);
  const server = createMcpServer(createTestClient(api.fetch));
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map(tool => [tool.name, tool]));
    const call = async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      if (!result.isError) assertMatchesOutputSchema(byName.get(name), result.structuredContent);
      return result;
    };
    await callback({ call, calls: api.calls, tools, client });
  } finally {
    await client.close();
    await server.close();
  }
}

/** Independent 2020-12 validation, as Claude performs it. */
export function assertMatchesOutputSchema(tool, structuredContent) {
  assert.ok(tool, 'tool must be listed');
  const validate = ajv.compile(tool.outputSchema);
  const valid = validate(structuredContent);
  assert.ok(valid, `${tool.name} structuredContent: ${ajv.errorsText(validate.errors)}`);
}

export function textOf(result) {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
}

export function callsTo(calls, method, pathPrefix) {
  return calls.filter(call => call.method === method && call.path.startsWith(pathPrefix));
}
