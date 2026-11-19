import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_INSTRUCTIONS, TOOLSETS, TOOL_NAMES } from '../dist/server.js';
import { callsTo, envelope, json, textOf, withMcp } from './helpers.mjs';

const PROVISIONING_TOOLS = [
  'list_provisioning_flows',
  'get_provisioning_flow',
  'list_my_provisioning_tasks',
  'complete_provisioning_task',
  'add_provisioning_task_comment',
  'preview_provisioning',
];

/** What the API sends for a row: the tools copy only the listed fields. */
const ROW = {
  id: 'plan-1',
  kind: 'ONBOARDING',
  userId: 'u-1',
  pending: false,
  name: 'Ayşe Yılmaz',
  position: 'Satış uzmanı',
  department: 'Satış',
  date: '2026-11-20',
  daysLeft: 3,
  total: 5,
  done: 3,
  late: 1,
  urgent: 0,
  critical: 1,
  noAssignee: 0,
  requestMissing: 0,
  returnsOpen: 0,
  returnsLate: false,
  missing: ['Dizüstü bilgisayar', 'Giriş kartı'],
  status: 'ACTIVE',
  source: 'E_KARSILAMA',
  restarted: false,
  canRestart: false,
  readiness: 'ATTENTION',
};

const LEAVER = {
  ...ROW,
  id: 'plan-2',
  kind: 'OFFBOARDING',
  name: 'Mehmet Kaya',
  date: '2026-11-02',
  daysLeft: -15,
  total: 3,
  done: 1,
  late: 2,
  missing: ['Cep telefonu iadesi'],
  returnsOpen: 2,
  returnsLate: true,
  readiness: 'AT_RISK',
};

const FLOWS = {
  rows: [ROW, LEAVER],
  total: 2,
  page: 0,
  size: 20,
  counts: { ACTIVE: 2, LATE: 2, COMPLETED: 4, CANCELLED: 1 },
  cards: { STARTING_WEEK: 1, LEAVING_WEEK: 0, LATE: 2, RETURNS: 1 },
  canManage: true,
  teamOnly: false,
  enabled: true,
  setupDone: true,
};

/** The flow page answer, with the HR-only parts the tools must never pass on. */
const FLOW = {
  ...LEAVER,
  employee: { id: 'u-2', name: 'Mehmet Kaya', branch: 'İstanbul' },
  managerName: 'Zeynep Demir',
  hrOwnerName: 'Elif Ak',
  cancelReason: 'Gizli neden',
  immediate: false,
  canManage: true,
  hr: true,
  tasks: [
    {
      id: 't-1',
      title: 'Dizüstü bilgisayar iadesi',
      source: 'RETURN',
      category: 'Cihazlar',
      status: 'DONE',
      dueDate: '2026-11-02',
      late: false,
      lateDays: 0,
      critical: false,
      urgent: false,
      escalated: false,
      completedAt: '2026-11-02T09:15:00.000+00:00',
      completedByName: 'BT Destek',
      note: 'Ekranda çizik var',
      output: { returnState: 'FAULTY', km: '120000', licenceWarning: 'B sınıfı süresi dolmuş', value: 42000 },
      warning: 'licence',
      people: [{ type: 'TEAM', name: 'BT' }],
      mine: false,
    },
    {
      id: 't-2',
      title: 'Cep telefonu iadesi',
      source: 'RETURN',
      category: 'Cihazlar',
      status: 'OPEN',
      dueDate: '2026-11-02',
      late: true,
      lateDays: 15,
      critical: true,
      urgent: false,
      escalated: true,
      noAssigneeReason: null,
      people: [{ type: 'TEAM', name: 'İdari işler' }, { type: 'PERSON', userId: 'u-me', name: 'Ben' }],
      mine: true,
    },
  ],
  events: [{ type: 'ASSET_VALUE_SET', detail: { value: 42000 } }],
  restart: { allowed: false },
};

const MY_TASKS = {
  todo: [{
    id: 't-9',
    planId: 'plan-1',
    kind: 'ONBOARDING',
    source: 'ITEM',
    title: 'E-posta hesabı',
    itemId: 'EMAIL',
    employeeId: 'u-1',
    employeeName: 'Ayşe Yılmaz',
    position: 'Satış uzmanı',
    date: '2026-11-20',
    status: 'OPEN',
    dueDate: '2026-11-19',
    urgent: false,
    critical: true,
    late: false,
    requestMissing: false,
    quickComplete: false,
    group: 'WEEK',
  }],
  upcoming: [{ id: 't-10', planId: 'plan-1', kind: 'ONBOARDING', title: 'Giriş kartı', employeeName: 'Ayşe Yılmaz', status: 'PLANNED', openAt: '2026-11-18T06:00:00.000+00:00', quickComplete: true }],
  done: [{ id: 't-8', planId: 'plan-3', kind: 'OFFBOARDING', title: 'Hat kapatma', employeeName: 'Ali Veli', status: 'DONE', quickComplete: false, completedAt: '2026-11-10T08:00:00.000+00:00' }],
  late: 0,
  items: { EMAIL: 'E-posta hesabı' },
  enabled: true,
};

const PREVIEW = {
  enabled: true,
  setupDone: true,
  canManage: true,
  refusal: null,
  tasks: [
    {
      itemId: 'i-laptop',
      name: 'Dizüstü bilgisayar',
      categoryId: 'c-1',
      categoryName: 'Cihazlar',
      quantity: 1,
      status: 'PLANNED',
      openAt: '2026-11-24T09:00',
      dueDate: '2026-11-30',
      urgent: false,
      waitsFor: null,
      addedByHand: false,
      assignees: [{ type: 'TEAM', name: 'BT', count: 3 }],
      noAssigneeReason: null,
      form: [{ key: 'os', label: 'İşletim sistemi' }],
      request: { os: 'macOS' },
      requestMissing: false,
    },
    {
      itemId: 'i-accounts',
      name: 'Uygulama hesapları',
      categoryName: 'BT',
      status: 'WAITING',
      dueDate: '2026-11-30',
      urgent: true,
      waitsFor: 'E-posta hesabı',
      assignees: [],
      noAssigneeReason: 'TEAM_EMPTY',
    },
  ],
  excluded: [{ itemId: 'i-car', name: 'Araç', categoryName: 'Araç', reason: 'CONDITION' }],
  urgentCount: 1,
  noAssigneeCount: 1,
  daysToStart: 14,
  startDate: '2026-12-01',
};

const ROUTES = [
  ['GET /provisioning/flows', () => envelope(FLOWS)],
  ['GET /provisioning/flows/plan-2', () => envelope(FLOW)],
  ['GET /provisioning/tasks/me', () => envelope(MY_TASKS)],
  ['POST /provisioning/tasks/t-2/complete', () => envelope({ id: 't-2', title: 'Cep telefonu iadesi', status: 'DONE' }, 'UPDATE_SUCCESS')],
  ['POST /provisioning/tasks/t-2/comments', () => envelope({ id: 't-2' }, 'UPDATE_SUCCESS')],
  ['POST /provisioning/preview', () => envelope(PREVIEW)],
];

/** A refused provisioning request: HTTP 400, the code as `message`, as ProvisionController.refusal answers. */
function refused(code, messageCode = 'INVALID_INPUT_PARAMETERS', status = 400) {
  return json({ code: 0, message: code, message_code: messageCode, result: { code, field: null } }, status);
}

const MODULE_OFF = () => json({ error: 'MODULE_DISABLED', message_code: 'MODULE_DISABLED', module: 'ONOFFBOARDING' }, 403);

test('provisioning tools are their own toolset after the budget tools; instructions name them', async () => {
  assert.deepEqual([...TOOLSETS.provisioning], PROVISIONING_TOOLS);
  const at = TOOL_NAMES.indexOf('list_provisioning_flows');
  assert.equal(TOOL_NAMES[at - 1], 'get_cost_forecast_breakdown');
  assert.deepEqual(TOOL_NAMES.slice(at, at + 6), PROVISIONING_TOOLS);
  for (const name of PROVISIONING_TOOLS) assert.match(DEFAULT_INSTRUCTIONS, new RegExp(name));
  assert.match(DEFAULT_INSTRUCTIONS, /closing a preparation task/);
  await withMcp([], async ({ tools }) => {
    const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
    for (const name of ['list_provisioning_flows', 'get_provisioning_flow', 'list_my_provisioning_tasks', 'preview_provisioning']) {
      assert.equal(byName[name].annotations.readOnlyHint, true, name);
      assert.equal(byName[name].annotations.destructiveHint, false, name);
    }
    // closing writes onto the employee card and asset records: the approval-needing class
    assert.equal(byName.complete_provisioning_task.annotations.readOnlyHint, false);
    assert.equal(byName.complete_provisioning_task.annotations.destructiveHint, true);
    assert.equal(byName.add_provisioning_task_comment.annotations.readOnlyHint, false);
    assert.equal(byName.add_provisioning_task_comment.annotations.destructiveHint, false);
    // the description carries an example
    assert.match(byName.complete_provisioning_task.description, /WORK_EMAIL/);
    assert.match(byName.preview_provisioning.description, /"start_date": "2026-12-01"/);
    // no input lets a caller send a price or a new asset
    assert.doesNotMatch(JSON.stringify(byName.complete_provisioning_task.inputSchema), /price|newAsset/);
  });
  await withMcp([], async ({ tools }) => {
    assert.deepEqual(tools.map(tool => tool.name), PROVISIONING_TOOLS);
  }, {}, { toolsets: 'provisioning' });
});

test('list_provisioning_flows sends the filters, maps the rows and the week counts', async () => {
  await withMcp(ROUTES, async ({ call, calls }) => {
    const result = await call('list_provisioning_flows', {
      status: 'LATE', kind: 'ONBOARDING', focus: 'STARTING_WEEK', from: '2026-11-01', to: '2026-11-30', query: 'ayşe', limit: 10,
    });
    assert.notEqual(result.isError, true, textOf(result));
    assert.deepEqual(callsTo(calls, 'GET', '/provisioning/flows')[0].query, {
      tab: 'LATE', kind: 'ONBOARDING', card: 'STARTING_WEEK', from: '2026-11-01', to: '2026-11-30', q: 'ayşe', page: '0', size: '10',
    });
    const s = result.structuredContent;
    assert.equal(s.total, 2);
    assert.deepEqual(s.counts, { ACTIVE: 2, LATE: 2, COMPLETED: 4, CANCELLED: 1 });
    assert.deepEqual(s.thisWeek, { starting: 1, leaving: 0, withLateTasks: 2, unreturnedAfterLastDay: 1 });
    assert.deepEqual(s.flows[0], {
      id: 'plan-1',
      kind: 'ONBOARDING',
      name: 'Ayşe Yılmaz',
      pending: false,
      position: 'Satış uzmanı',
      department: 'Satış',
      date: '2026-11-20',
      daysLeft: 3,
      done: 3,
      total: 5,
      late: 1,
      urgent: 0,
      critical: 1,
      returnsOpen: 0,
      status: 'ACTIVE',
      readiness: 'ATTENTION',
      missing: ['Dizüstü bilgisayar', 'Giriş kartı'],
      flowUrl: 'https://teamso.com/dashboard/onoffboarding/status?plan=plan-1',
    });
    assert.deepEqual(s.nextAction.arguments, { flow_id: 'plan-1' });
    const text = textOf(result);
    assert.match(text, /\| Ayşe Yılmaz \| entry \| 2026-11-20 \| in 3 day\(s\) \| 3\/5 \| 1 \| needs attention \| Dizüstü bilgisayar, Giriş kartı \| `plan-1` \|/);
    assert.match(text, /\| Mehmet Kaya \| exit \| 2026-11-02 \| 15 day\(s\) ago \| 1\/3 \| 2 \| at risk \|/);
  });
  // defaults: active, 20 per page
  await withMcp(ROUTES, async ({ call, calls }) => {
    await call('list_provisioning_flows');
    assert.deepEqual(callsTo(calls, 'GET', '/provisioning/flows')[0].query, { tab: 'ACTIVE', page: '0', size: '20' });
  });
});

test('list_provisioning_flows: a switched-off flow and a module that is off give a clear answer', async () => {
  await withMcp([['GET /provisioning/flows', () => envelope({ ...FLOWS, rows: [], total: 0, enabled: false })]], async ({ call }) => {
    const result = await call('list_provisioning_flows');
    assert.equal(result.isError, true);
    assert.match(textOf(result), /preparation and return flow is switched off/);
  });
  await withMcp([['GET /provisioning/flows', MODULE_OFF]], async ({ call }) => {
    const result = await call('list_provisioning_flows');
    assert.equal(result.isError, true);
    assert.match(textOf(result), /Onboarding and offboarding module .* is switched off/);
    assert.match(textOf(result), /MODULE_DISABLED/);
  });
  await withMcp([['GET /provisioning/flows', () => json({ code: 0, message: 'ACCESS_DENIED', message_code: 'ACCESS_DENIED' }, 403)]], async ({ call }) => {
    const result = await call('list_provisioning_flows');
    assert.equal(result.isError, true);
    assert.match(textOf(result), /not allowed/);
  });
});

test('get_provisioning_flow returns the items and who is on them, never outputs, notes, values or the log', async () => {
  await withMcp(ROUTES, async ({ call }) => {
    const result = await call('get_provisioning_flow', { flow_id: 'plan-2' });
    assert.notEqual(result.isError, true, textOf(result));
    const s = result.structuredContent;
    assert.equal(s.flow.name, 'Mehmet Kaya');
    assert.equal(s.flow.kind, 'OFFBOARDING');
    assert.equal(s.flow.managerName, 'Zeynep Demir');
    assert.equal(s.flow.missing, undefined);
    assert.deepEqual(s.tasks[1], {
      id: 't-2',
      title: 'Cep telefonu iadesi',
      source: 'RETURN',
      category: 'Cihazlar',
      status: 'OPEN',
      dueDate: '2026-11-02',
      late: true,
      lateDays: 15,
      urgent: false,
      critical: true,
      escalated: true,
      noAssignee: false,
      people: [{ type: 'TEAM', name: 'İdari işler' }, { type: 'PERSON', name: 'Ben' }],
      mine: true,
    });
    assert.equal(s.tasks[0].completedBy, 'BT Destek');
    assert.equal(s.nextAction.tool, 'complete_provisioning_task');
    assert.deepEqual(s.nextAction.arguments, { task_id: 't-2' });
    const everything = JSON.stringify(result);
    for (const secret of ['42000', 'licence', 'B sınıfı', 'Ekranda çizik', 'FAULTY', '120000', 'Gizli neden', 'ASSET_VALUE_SET', 'İstanbul', 'Elif Ak']) {
      assert.ok(!everything.includes(secret), `${secret} must not reach the assistant`);
    }
    assert.match(textOf(result), /\| Cep telefonu iadesi \(critical\) \| open \| 2026-11-02 \| 15 day\(s\) \| İdari işler, Ben \(you\) \| `t-2` \|/);
  });
  await withMcp([['GET /provisioning/flows/plan-x', () => refused('ITEM_NOT_FOUND', 'ITEM_NOT_FOUND', 404)]], async ({ call }) => {
    const result = await call('get_provisioning_flow', { flow_id: 'plan-x' });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /not visible to you: HR sees the flows of their branches/);
  });
  await withMcp([], async ({ call }) => {
    const bad = await call('get_provisioning_flow', { flow_id: '../flows' });
    assert.equal(bad.isError, true);
  });
});

test('list_my_provisioning_tasks lists the open tasks, and on request upcoming and done ones', async () => {
  await withMcp(ROUTES, async ({ call, calls }) => {
    const result = await call('list_my_provisioning_tasks', { kind: 'ONBOARDING', query: 'ayşe' });
    assert.notEqual(result.isError, true, textOf(result));
    assert.deepEqual(callsTo(calls, 'GET', '/provisioning/tasks/me')[0].query, { kind: 'ONBOARDING', q: 'ayşe' });
    const s = result.structuredContent;
    assert.deepEqual(s.tasks[0], {
      id: 't-9',
      flowId: 'plan-1',
      kind: 'ONBOARDING',
      title: 'E-posta hesabı',
      employeeName: 'Ayşe Yılmaz',
      position: 'Satış uzmanı',
      date: '2026-11-20',
      status: 'OPEN',
      dueDate: '2026-11-19',
      group: 'WEEK',
      late: false,
      urgent: false,
      critical: true,
      needsValues: true,
      formMissing: false,
    });
    assert.deepEqual(s.upcoming, []);
    assert.deepEqual(s.done, []);
    assert.equal(s.nextAction.tool, 'complete_provisioning_task');
    assert.match(s.nextAction.reason, /with the value it writes/);
    const all = await call('list_my_provisioning_tasks', { include_upcoming: true, include_done: true });
    assert.equal(all.structuredContent.upcoming[0].opensAt, '2026-11-18 09:00');
    assert.equal(all.structuredContent.done[0].kind, 'OFFBOARDING');
    assert.match(textOf(all), /### Opening later/);
  });
  await withMcp([['GET /provisioning/tasks/me', () => envelope({ todo: [], upcoming: [], done: [], late: 0, enabled: false })]], async ({ call }) => {
    const result = await call('list_my_provisioning_tasks');
    assert.equal(result.isError, true);
    assert.match(textOf(result), /switched off/);
  });
  await withMcp([['GET /provisioning/tasks/me', MODULE_OFF]], async ({ call }) => {
    const result = await call('list_my_provisioning_tasks');
    assert.equal(result.isError, true);
    assert.match(textOf(result), /module .* is switched off/);
  });
});

test('complete_provisioning_task sends only the listed values and reports the result', async () => {
  await withMcp(ROUTES, async ({ call, calls }) => {
    const result = await call('complete_provisioning_task', {
      task_id: 't-2',
      fields: { WORK_EMAIL: 'ayse.yilmaz@firma.com' },
      return_state: 'GOOD',
      note: 'Teslim alındı',
    });
    assert.notEqual(result.isError, true, textOf(result));
    const sent = callsTo(calls, 'POST', '/provisioning/tasks/t-2/complete')[0].body;
    assert.deepEqual(sent, {
      values: { fields: { WORK_EMAIL: 'ayse.yilmaz@firma.com' }, returnState: 'GOOD' },
      note: 'Teslim alındı',
      early: null,
    });
    assert.deepEqual(result.structuredContent, {
      taskId: 't-2',
      title: 'Cep telefonu iadesi',
      status: 'DONE',
      message: 'The task is closed and its values were written.',
    });
    // a plain check task: no values at all
    await call('complete_provisioning_task', { task_id: 't-2' });
    assert.deepEqual(callsTo(calls, 'POST', '/provisioning/tasks/t-2/complete')[1].body, { values: null, note: null, early: null });
    // a car with its kilometre, a line handed over
    await call('complete_provisioning_task', { task_id: 't-2', car_id: 'car-1', km: 12000, line_outcome: 'HANDED_OVER', handed_to: 'Ali Veli', overwrite: true });
    assert.deepEqual(callsTo(calls, 'POST', '/provisioning/tasks/t-2/complete')[2].body.values, {
      carId: 'car-1', km: '12000', lineOutcome: 'HANDED_OVER', handedTo: 'Ali Veli', overwrite: true,
    });
  });
  // an unknown card field is refused before any request
  await withMcp(ROUTES, async ({ call, calls }) => {
    const result = await call('complete_provisioning_task', { task_id: 't-2', fields: { SALARY: '1' } });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /`fields.SALARY` is not a card field/);
    assert.equal(callsTo(calls, 'POST', '/provisioning/').length, 0);
  });
});

test('complete_provisioning_task explains the refusals (manager not on the task, done, value missing, module off)', async () => {
  const cases = [
    [refused('PERMISSION_DENIED', 'PERMISSION_DENIED'), /Only the people on a task and HR/],
    [refused('ALREADY_DONE'), /already closed/],
    [refused('VALUE_REQUIRED'), /needs its value before it can close/],
    [refused('VALUE_TAKEN'), /overwrite: true/],
    [refused('NOT_ACTIVE'), /no longer active/],
    [MODULE_OFF(), /module .* is switched off/],
  ];
  for (const [response, pattern] of cases) {
    await withMcp([['POST /provisioning/tasks/t-2/complete', () => response.clone()]], async ({ call }) => {
      const result = await call('complete_provisioning_task', { task_id: 't-2', fields: { WORK_EMAIL: 'a@b.co' } });
      assert.equal(result.isError, true);
      assert.match(textOf(result), pattern);
    });
  }
});

test('add_provisioning_task_comment posts the note and explains refusals', async () => {
  await withMcp(ROUTES, async ({ call, calls }) => {
    const result = await call('add_provisioning_task_comment', { task_id: 't-2', text: 'Laptop sipariş edildi, perşembe geliyor.' });
    assert.notEqual(result.isError, true, textOf(result));
    assert.deepEqual(callsTo(calls, 'POST', '/provisioning/tasks/t-2/comments')[0].body, { body: 'Laptop sipariş edildi, perşembe geliyor.' });
    assert.deepEqual(result.structuredContent, { taskId: 't-2', commented: true, message: 'The note was added to the task.' });
    const empty = await call('add_provisioning_task_comment', { task_id: 't-2', text: '   ' });
    assert.equal(empty.isError, true);
    const long = await call('add_provisioning_task_comment', { task_id: 't-2', text: 'x'.repeat(2001) });
    assert.equal(long.isError, true);
  });
  await withMcp([['POST /provisioning/tasks/t-3/comments', () => refused('ITEM_NOT_FOUND', 'ITEM_NOT_FOUND', 404)]], async ({ call }) => {
    const result = await call('add_provisioning_task_comment', { task_id: 't-3', text: 'Not' });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /could not find that flow or task/);
  });
});

test('preview_provisioning shows the items, timing and people, never the form answers; nothing is saved', async () => {
  await withMcp(ROUTES, async ({ call, calls }) => {
    const result = await call('preview_provisioning', { position_id: 'pos-1', start_date: '2026-12-01', branch_id: 'br-1' });
    assert.notEqual(result.isError, true, textOf(result));
    assert.deepEqual(callsTo(calls, 'POST', '/provisioning/preview')[0].body, { positionId: 'pos-1', startDate: '2026-12-01', branchId: 'br-1' });
    const s = result.structuredContent;
    assert.equal(s.wouldStart, true);
    assert.equal(s.daysToStart, 14);
    assert.deepEqual(s.tasks[0], {
      itemId: 'i-laptop',
      name: 'Dizüstü bilgisayar',
      category: 'Cihazlar',
      quantity: 1,
      status: 'PLANNED',
      opensAt: '2026-11-24 09:00',
      dueDate: '2026-11-30',
      urgent: false,
      people: [{ type: 'TEAM', name: 'BT' }],
      noAssignee: false,
    });
    assert.equal(s.tasks[1].noAssignee, true);
    assert.equal(s.tasks[1].waitsFor, 'E-posta hesabı');
    assert.deepEqual(s.excluded, [{ name: 'Araç', category: 'Araç', reason: 'CONDITION' }]);
    assert.ok(!JSON.stringify(result).includes('macOS'), 'form answers stay out');
    const text = textOf(result);
    assert.match(text, /\| Uygulama hesapları \| .* \| nobody: HR gets it \| opens late \(urgent\); waits for E-posta hesabı \|/);
    assert.match(text, /Nothing was saved/);
  });
  await withMcp([['POST /provisioning/preview', () => envelope({ enabled: false, setupDone: false, canManage: true, refusal: 'OFF' })]], async ({ call }) => {
    const result = await call('preview_provisioning', { position_id: 'pos-1' });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /switched off/);
  });
  await withMcp([['POST /provisioning/preview', () => envelope({ ...PREVIEW, refusal: 'PAST_DATE', tasks: [] })]], async ({ call }) => {
    const result = await call('preview_provisioning', { position_id: 'pos-1', start_date: '2026-01-05' });
    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent.wouldStart, false);
    assert.match(textOf(result), /further in the past than the company setting allows/);
  });
  await withMcp([], async ({ call }) => {
    const bad = await call('preview_provisioning', { position_id: 'pos-1', start_date: '01.12.2026' });
    assert.equal(bad.isError, true);
  });
});
