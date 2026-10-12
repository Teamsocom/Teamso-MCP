import assert from 'node:assert/strict';
import test from 'node:test';
import { JSON_SCHEMA_2020_12, TOOL_NAMES } from '../dist/server.js';
import {
  ME,
  MY_LEAVE,
  PDF_BYTES,
  VALID_OTP,
  callsTo,
  envelope,
  hardFailure,
  json,
  softFailure,
  textOf,
  withMcp,
} from './helpers.mjs';

const EXPECTED_TOOLS = [
  'search_help_articles', 'get_help_article', 'list_help_modules',
  'get_me',
  'list_leave_types', 'get_my_leave_balance', 'calculate_leave_days', 'request_leave_otp',
  'create_leave_request', 'list_my_leaves', 'cancel_leave_request',
  'list_pending_approvals', 'approve_or_reject_leave',
  'search_employees', 'get_employee_profile',
  'list_performance_periods', 'list_my_goals', 'list_team_goals', 'create_user_goal',
  'send_goals_to_approval', 'approve_goal', 'revise_and_approve_goal', 'update_goal_actual_value',
  'update_manager_actual_value', 'approve_goal_evaluation',
  'list_announcements',
  'list_my_payslips', 'get_payslip_pdf',
];

// ------------------------------------------------------------------ catalog

test('tools/list exposes exactly TOOL_NAMES with schemas and annotations', async () => {
  assert.deepEqual([...TOOL_NAMES], EXPECTED_TOOLS);
  await withMcp([], async ({ tools }) => {
    assert.deepEqual(tools.map(tool => tool.name), EXPECTED_TOOLS);
    for (const tool of tools) {
      assert.ok(tool.title, `${tool.name} has a title`);
      assert.ok(tool.description && tool.description.length > 40, `${tool.name} has a description`);
      assert.equal(tool.inputSchema.type, 'object', `${tool.name} inputSchema`);
      assert.equal(tool.inputSchema.$schema, JSON_SCHEMA_2020_12, `${tool.name} input dialect`);
      assert.equal(tool.outputSchema?.type, 'object', `${tool.name} outputSchema`);
      assert.equal(tool.outputSchema.$schema, JSON_SCHEMA_2020_12, `${tool.name} output dialect`);
      assert.doesNotMatch(JSON.stringify(tool), /draft-07|#\/definitions\//, `${tool.name} has no draft-07 leftovers`);
      for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
        assert.equal(typeof tool.annotations?.[hint], 'boolean', `${tool.name} ${hint}`);
      }
    }
    const readOnly = tools.filter(tool => tool.annotations.readOnlyHint).map(tool => tool.name);
    assert.ok(!readOnly.includes('create_leave_request'));
    assert.ok(!readOnly.includes('request_leave_otp'));
    const destructive = tools.filter(tool => tool.annotations.destructiveHint).map(tool => tool.name);
    assert.ok(destructive.includes('cancel_leave_request'));
    assert.ok(destructive.includes('approve_or_reject_leave'));
  });
});

test('every tool sends the PAT and the client header', async () => {
  await withMcp([], async ({ call, calls }) => {
    await call('get_me');
    const [request] = calls;
    assert.equal(request.headers.get('authorization'), 'Bearer tms_pat_test_token');
    assert.equal(request.headers.get('accept'), 'application/json');
    assert.match(request.headers.get('x-teamso-client'), /^teamso-mcp\/\d+\.\d+\.\d+/);
  });
});

// --------------------------------------------------------------------- help

test('search_help_articles ranks the task article above the overview', async () => {
  await withMcp([], async ({ call, calls }) => {
    const result = await call('search_help_articles', { query: 'Hedef nasıl girilir' });
    assert.notEqual(result.isError, true);
    const ids = result.structuredContent.results.map(hit => hit.id);
    assert.deepEqual(ids.slice(0, 2), ['performance.goal-entry-employee', 'performance.overview']);
    assert.equal(result.structuredContent.results[1].url,
      'https://help.teamso.test/dashboard/help?article=performance.overview');
    assert.equal(result.structuredContent.results[0].resource, 'teamso://how-to/tr/performance.goal-entry-employee');
    assert.deepEqual(result.structuredContent.nextAction, {
      tool: 'get_help_article',
      arguments: { id: 'performance.goal-entry-employee', lang: 'tr' },
      reason: 'Read the best match before answering, and cite its url.',
    });
    assert.equal(calls[0].headers.get('authorization'), null, 'help bundle is fetched without the token');

    const filtered = await call('search_help_articles', { query: 'hedef', role: 'MANAGER', module: 'performance' });
    assert.deepEqual(filtered.structuredContent.results.map(hit => hit.id), ['performance.overview']);
    assert.equal(callsTo(calls, 'GET', 'help.teamso.test').length, 1, 'bundle is cached');
  });
});

test('search_help_articles reports an unavailable bundle as an error', async () => {
  await withMcp([['GET help.teamso.test/how-to/bundle.tr.json', () => new Response('down', { status: 503 })]], async ({ call }) => {
    const result = await call('search_help_articles', { query: 'izin' });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /could not be loaded/);
  });
});

test('get_help_article returns Markdown with absolute links', async () => {
  await withMcp([], async ({ call }) => {
    const result = await call('get_help_article', { id: 'performance.goal-entry-employee' });
    assert.notEqual(result.isError, true);
    const text = textOf(result);
    assert.match(text, /^# Çalışan olarak hedef girişi/);
    assert.match(text, /\]\(https:\/\/help\.teamso\.test\/how-to\/performance\/goal\.png\)/);
    assert.match(text, /\]\(teamso:\/\/how-to\/tr\/performance\.overview\)/);
    assert.match(text, /Source: https:\/\/help\.teamso\.com\/tr\/articles\/1-hedef-girisi/);
    assert.deepEqual(result.structuredContent.article.related, ['performance.overview']);

    const missing = await call('get_help_article', { id: 'performance.nope' });
    assert.equal(missing.isError, true);
    assert.match(textOf(missing), /search_help_articles/);
  });
});

test('list_help_modules lists modules with known articles only', async () => {
  await withMcp([], async ({ call }) => {
    const result = await call('list_help_modules', {});
    assert.deepEqual(result.structuredContent.modules.map(module => module.dir), ['performance']);
    assert.deepEqual(result.structuredContent.modules[0].articles.map(article => article.id),
      ['performance.overview', 'performance.goal-entry-employee']);
  });
  await withMcp([['GET help.teamso.test/how-to/bundle.en.json', () => ({ lang: 'en' })]], async ({ call }) => {
    const result = await call('list_help_modules', { lang: 'en' });
    assert.equal(result.isError, true);
  });
});

// ------------------------------------------------------------------ account

test('get_me projects the profile without sensitive fields', async () => {
  await withMcp([], async ({ call }) => {
    const result = await call('get_me');
    const { user } = result.structuredContent;
    assert.equal(user.fullName, 'Ayşe Yılmaz');
    assert.deepEqual(user.company, { id: 'c-1', name: 'Acme' });
    assert.deepEqual(user.permissions, ['LEAVE_ADD', 'PEOPLE_READ']);
    assert.deepEqual(user.manager, { id: 'u-9', fullName: 'Mehmet Demir' });
    assert.equal(user.department, 'R&D');
    assert.doesNotMatch(JSON.stringify(result), /12345678901|taxNumber/);
  });
});

test('get_me explains a rejected token', async () => {
  const unauthorized = () => json({ status: 401, error: 'Unauthorized', message_code: 'UNAUTHORIZED', path: '/v1/user' }, 401);
  await withMcp([['GET /user', unauthorized]], async ({ call }) => {
    const result = await call('get_me');
    assert.equal(result.isError, true);
    assert.match(textOf(result), /teamso\.com\/dashboard\/mcp-access/);
    assert.match(textOf(result), /UNAUTHORIZED/);
  });
});

// -------------------------------------------------------------------- leave

test('list_leave_types uses the active policy and maps type rules', async () => {
  await withMcp([], async ({ call, calls }) => {
    const result = await call('list_leave_types');
    assert.equal(callsTo(calls, 'GET', '/leave-policy/getDetailLeavePolicyForUser/lpu-1').length, 1);
    const { policy, leaveTypes } = result.structuredContent;
    assert.deepEqual(policy, { leavePolicyUserId: 'lpu-1', id: 'lp-1', name: 'Standart' });
    assert.deepEqual(leaveTypes[0], {
      id: 'lt-annual',
      name: 'Yıllık İzin',
      remainingDays: 14,
      isDefault: true,
      paid: true,
      maxDaysPerRequest: 10,
      documentRequired: false,
      descriptionRequired: false,
      birthdayLeave: false,
      countsCalendarDays: false,
    });
    assert.equal(leaveTypes[2].countsCalendarDays, true);
  });
});

test('list_leave_types treats ITEM_NOT_FOUND with HTTP 200 as an error', async () => {
  await withMcp([['GET /leave-policy/getDetailLeavePolicyForUser/lpu-1', () => softFailure('ITEM_NOT_FOUND')]], async ({ call }) => {
    const result = await call('list_leave_types');
    assert.equal(result.isError, true);
    assert.match(textOf(result), /No leave types are set up/);
    assert.match(textOf(result), /HTTP 200/);
  });
});

test('get_my_leave_balance lists remaining days', async () => {
  await withMcp([], async ({ call }) => {
    const result = await call('get_my_leave_balance');
    assert.deepEqual(result.structuredContent.balances.map(balance => balance.remainingDays), [14, 0, 112]);
  });
  await withMcp([['GET /leave-policy/getListAllLeavePolicyForUser', () => envelope([])]], async ({ call }) => {
    const result = await call('get_my_leave_balance');
    assert.equal(result.isError, true);
    assert.match(textOf(result), /No leave policy is assigned/);
  });
});

test('calculate_leave_days applies shift times and runs the pre-check', async () => {
  await withMcp([], async ({ call, calls }) => {
    const result = await call('calculate_leave_days', {
      leave_type_id: 'lt-annual',
      start: '2026-11-02',
      end: '2026-11-04',
    });
    assert.notEqual(result.isError, true);
    const [calc] = callsTo(calls, 'GET', '/leave/dayCalculator/');
    assert.equal(calc.url.pathname,
      '/v1/leave/dayCalculator/wd-1/ph-1/lt-annual/2026-11-02%2008:30/2026-11-04%2017:30');
    const [control] = callsTo(calls, 'POST', '/leave/controlToAddLeave');
    assert.deepEqual(control.body, ['u-1']);
    assert.deepEqual(control.query, {
      leaveTypeId: 'lt-annual',
      addedDay: '3',
      startDate: '2026-11-02 08:30',
      endDate: '2026-11-04 17:30',
      leavePolicyUserId: 'lpu-1',
    });
    const content = result.structuredContent;
    assert.equal(content.request.workingDays, 3);
    assert.equal(content.request.returnToWorkDate, '2026-11-05 08:30');
    assert.equal(content.remainingAfterRequest, 11);
    assert.equal(content.canRequest, true);
    assert.equal(content.nextAction.tool, 'request_leave_otp');
  });
});

test('calculate_leave_days sends 00:00 for calendar-day types and explicit times as given', async () => {
  await withMcp([], async ({ call, calls }) => {
    await call('calculate_leave_days', { leave_type_id: 'lt-calendar', start: '2026-11-02 10:00', end: '2026-11-03' });
    await call('calculate_leave_days', { leave_type_id: 'lt-annual', start: '2026-11-02 13:00', end: '2026-11-02T17:00' });
    const [first, second] = callsTo(calls, 'GET', '/leave/dayCalculator/');
    assert.match(first.url.pathname, /2026-11-02%2000:00\/2026-11-03%2000:00$/);
    assert.match(second.url.pathname, /2026-11-02%2013:00\/2026-11-02%2017:00$/);
  });
});

test('calculate_leave_days reports per-request limits and pre-check refusals', async () => {
  await withMcp([[/^GET \/leave\/dayCalculator\//, () => envelope('most_day_count', 'GET_ERROR')]], async ({ call }) => {
    const result = await call('calculate_leave_days', { leave_type_id: 'lt-annual', start: '2026-11-02', end: '2026-11-30' });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /at most 10 working days per request/);
  });
  await withMcp([['POST /leave/controlToAddLeave', () => envelope({
    allUserError: [],
    singleUserError: [{ userResponseDto: { id: 'u-1' }, title: ['leave_available_for_dates'] }],
  })]], async ({ call }) => {
    const result = await call('calculate_leave_days', { leave_type_id: 'lt-annual', start: '2026-11-02', end: '2026-11-04' });
    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent.canRequest, false);
    assert.match(result.structuredContent.problems[0], /already have leave/);
    assert.equal(result.structuredContent.nextAction, undefined);
  });
  await withMcp([], async ({ call }) => {
    const unknown = await call('calculate_leave_days', { leave_type_id: 'lt-x', start: '2026-11-02', end: '2026-11-04' });
    assert.equal(unknown.isError, true);
    assert.match(textOf(unknown), /lt-annual/);
    const badDate = await call('calculate_leave_days', { leave_type_id: 'lt-annual', start: '02.11.2026', end: '2026-11-04' });
    assert.equal(badDate.isError, true);
    assert.match(textOf(badDate), /yyyy-MM-dd/);
  });
});

test('request_leave_otp sends the SMS and points to create_leave_request', async () => {
  await withMcp([], async ({ call, calls }) => {
    const result = await call('request_leave_otp');
    assert.equal(callsTo(calls, 'GET', '/sms/generateToken')[0].query.checkCredit, 'true');
    assert.equal(result.structuredContent.validForSeconds, 180);
    assert.equal(result.structuredContent.nextAction.tool, 'create_leave_request');
  });
  await withMcp([['GET /sms/generateToken', () => softFailure('CREDIT_INSUFFICIENT', 'Your digital credit is insufficient.')]], async ({ call }) => {
    const result = await call('request_leave_otp');
    assert.equal(result.isError, true);
    assert.match(textOf(result), /digital \(SMS\) credit/);
  });
});

test('create_leave_request verifies the OTP, then posts the exact leave payload', async () => {
  await withMcp([], async ({ call, calls }) => {
    const result = await call('create_leave_request', {
      leave_type_id: 'lt-annual',
      start: '2026-11-02',
      end: '2026-11-04',
      description: 'Tatil',
      otp_code: VALID_OTP,
    });
    assert.notEqual(result.isError, true, textOf(result));

    const order = calls.map(request => `${request.method} ${request.path}`);
    const verifyAt = order.indexOf(`GET /sms/checkToken/${VALID_OTP}`);
    const createAt = order.indexOf('POST /leave');
    assert.ok(order.indexOf('POST /leave/controlToAddLeave') < verifyAt, 'pre-check runs before the OTP is used');
    assert.ok(verifyAt >= 0 && verifyAt < createAt, 'OTP is verified right before creating');

    assert.deepEqual(calls[createAt].body, {
      leaveType: 'lt-annual',
      personnelId: ['u-1'],
      leavePolicyUserId: 'lpu-1',
      startDate: '2026-11-02 08:30',
      endDate: '2026-11-04 17:30',
      returnToWorkDate: '2026-11-05 08:30',
      totalLeaveDay: 3,
      description: 'Tatil',
      documentAttached: false,
      approveAndContinue: false,
    });
    assert.equal(result.structuredContent.created, true);
    assert.equal(result.structuredContent.leave.id, 'l-new');
    assert.equal(result.structuredContent.leave.status, 'pending_approval');
  });
});

test('create_leave_request surfaces OTP_NOT_DONE sent with HTTP 200', async () => {
  await withMcp([['POST /leave', () => softFailure('OTP_NOT_DONE', 'Otp not done.')]], async ({ call }) => {
    const result = await call('create_leave_request', {
      leave_type_id: 'lt-annual', start: '2026-11-02', end: '2026-11-04', otp_code: VALID_OTP,
    });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /request_leave_otp/);
    assert.match(textOf(result), /OTP_NOT_DONE/);
  });
});

test('create_leave_request stops at a wrong code or a refused request', async () => {
  await withMcp([], async ({ call, calls }) => {
    const wrong = await call('create_leave_request', {
      leave_type_id: 'lt-annual', start: '2026-11-02', end: '2026-11-04', otp_code: '999999',
    });
    assert.equal(wrong.isError, true);
    assert.match(textOf(wrong), /SMS code is wrong/);
    assert.equal(callsTo(calls, 'POST', '/leave').filter(request => request.path === '/leave').length, 0);

    const document = await call('create_leave_request', {
      leave_type_id: 'lt-sick', start: '2026-11-02', end: '2026-11-04', otp_code: VALID_OTP,
    });
    assert.equal(document.isError, true);
    assert.match(textOf(document), /supporting document/);
    assert.equal(callsTo(calls, 'GET', `/sms/checkToken/${VALID_OTP}`).length, 0, 'code is kept for a valid retry');
  });
});

test('list_my_leaves keeps only the caller\'s leaves and filters by status', async () => {
  await withMcp([], async ({ call, calls }) => {
    const result = await call('list_my_leaves', { from: '2026-10-01', to: '2026-12-31' });
    assert.deepEqual(result.structuredContent.leaves.map(leave => leave.id), ['l-new', 'l-1']);
    assert.equal(result.structuredContent.leaves[1].createdAt, '2026-10-01 09:00', 'Turkey wall clock');
    const [list] = callsTo(calls, 'GET', '/leave/listAllLeavesAdvancedPagination');
    assert.equal(list.query.rangeStart, '2026-10-01');
    assert.equal(list.query.rangeEnd, '2026-12-31');
    assert.equal(list.query.sortKey, 'createdAt');

    const pending = await call('list_my_leaves', { status: 'pending_approval', limit: 1 });
    assert.deepEqual(pending.structuredContent.leaves.map(leave => leave.id), ['l-1']);
    assert.equal(callsTo(calls, 'GET', '/leave/listAllLeavesAdvancedPagination')[1].query.searchValue, '0');
  });
  const forbidden = () => json({ status: 403, error: 'ACCESS_DENIED', message_code: 'ACCESS_DENIED' }, 403);
  await withMcp([['GET /leave/listAllLeavesAdvancedPagination', forbidden]], async ({ call }) => {
    const result = await call('list_my_leaves', {});
    assert.equal(result.isError, true);
    assert.match(textOf(result), /LEAVE_ADD/);
  });
});

test('cancel_leave_request deletes only the caller\'s leave after the OTP check', async () => {
  await withMcp([], async ({ call, calls }) => {
    const result = await call('cancel_leave_request', { leave_id: 'l-1', otp_code: VALID_OTP });
    assert.notEqual(result.isError, true, textOf(result));
    const order = calls.map(request => `${request.method} ${request.path}`);
    assert.ok(order.indexOf(`GET /sms/checkToken/${VALID_OTP}`) < order.indexOf('DELETE /leave/l-1'));
    assert.equal(result.structuredContent.leave.id, MY_LEAVE.id);
    assert.deepEqual(result.structuredContent.closedPayrollPeriods, []);

    const notMine = await call('cancel_leave_request', { leave_id: 'l-2', otp_code: VALID_OTP });
    assert.equal(notMine.isError, true);
    assert.match(textOf(notMine), /not one of your leave requests/);
    assert.equal(callsTo(calls, 'DELETE', '/leave/l-2').length, 0);
  });
});

// ---------------------------------------------------------------- approvals

test('list_pending_approvals returns only leaves the caller can decide', async () => {
  await withMcp([], async ({ call, calls }) => {
    const result = await call('list_pending_approvals');
    assert.deepEqual(result.structuredContent.approvals.map(item => item.leaveId), ['l-2']);
    assert.deepEqual(result.structuredContent.approvals[0].requester, { id: 'u-2', fullName: 'Can Öztürk' });
    assert.deepEqual(result.structuredContent.nextAction.arguments, { leave_id: 'l-2' },
      'the hint never pre-fills a decision');
    assert.equal(callsTo(calls, 'GET', '/dashboard/').length, 0, 'the side-effecting dashboard endpoint is not used');
  });
  await withMcp([['GET /leave/listAllLeavesAdvancedPagination', () => new Response('', { status: 500 })]], async ({ call }) => {
    const result = await call('list_pending_approvals');
    assert.equal(result.isError, true);
    assert.match(textOf(result), /server error/);
  });
});

test('approve_or_reject_leave checks canApprove and sends a path-safe reason', async () => {
  await withMcp([], async ({ call, calls }) => {
    const rejected = await call('approve_or_reject_leave', {
      leave_id: 'l-2',
      approve: false,
      reason: 'Yoğun dönem; 50% ekip izinde / tekrar planla',
    });
    assert.notEqual(rejected.isError, true, textOf(rejected));
    const [put] = callsTo(calls, 'PUT', '/leave/state/');
    assert.equal(put.url.pathname,
      `/v1/leave/state/l-2/false/${encodeURIComponent('Yoğun dönem 50 ekip izinde tekrar planla')}`);
    assert.equal(rejected.structuredContent.decision, 'rejected');
    assert.equal(rejected.structuredContent.status, 'rejected');

    const approved = await call('approve_or_reject_leave', { leave_id: 'l-2', approve: true });
    assert.equal(callsTo(calls, 'PUT', '/leave/state/')[1].url.pathname, '/v1/leave/state/l-2/true/-');
    assert.equal(approved.structuredContent.status, 'approved');
  });
});

test('approve_or_reject_leave refuses leaves outside the caller\'s step', async () => {
  await withMcp([], async ({ call, calls }) => {
    const other = await call('approve_or_reject_leave', { leave_id: 'l-3', approve: true });
    assert.equal(other.isError, true);
    assert.match(textOf(other), /not waiting for your decision/);
    const noReason = await call('approve_or_reject_leave', { leave_id: 'l-2', approve: false });
    assert.equal(noReason.isError, true);
    assert.match(textOf(noReason), /reason/);
    const onlySymbols = await call('approve_or_reject_leave', { leave_id: 'l-2', approve: false, reason: ' / ; % ' });
    assert.equal(onlySymbols.isError, true, 'a reason that is empty in the URL is no reason');
    assert.equal(callsTo(calls, 'PUT', '/leave/state/').length, 0);
  });
});

// ---------------------------------------------------------------- employees

test('search_employees uses the directory search', async () => {
  await withMcp([], async ({ call, calls }) => {
    const result = await call('search_employees', { query: 'can ozturk' });
    const [search] = callsTo(calls, 'GET', '/user/list-pagination');
    assert.deepEqual(
      { searchKey: search.query.searchKey, searchValue: search.query.searchValue, activeFilter: search.query.activeFilter },
      { searchKey: 'user', searchValue: 'can ozturk', activeFilter: 'true' },
    );
    assert.equal(result.structuredContent.source, 'directory');
    assert.deepEqual(result.structuredContent.employees[0], {
      id: 'u-2',
      fullName: 'Can Öztürk',
      email: 'can@acme.test',
      department: 'Satış',
      position: 'Sales',
      branch: 'İstanbul',
    });
    assert.equal(result.structuredContent.nextAction.tool, 'get_employee_profile');
  });
});

test('search_employees falls back to authorized employees without PEOPLE_READ', async () => {
  const forbidden = () => json({ status: 403, error: 'ACCESS_DENIED', message_code: 'ACCESS_DENIED' }, 403);
  await withMcp([['GET /user/list-pagination', forbidden]], async ({ call }) => {
    const result = await call('search_employees', { query: 'sule' });
    assert.equal(result.structuredContent.source, 'authorized_employees');
    assert.deepEqual(result.structuredContent.employees.map(employee => employee.id), ['u-3']);
  });
  await withMcp([['GET /user/list-pagination', () => json({ message_code: 'UNAUTHORIZED' }, 401)]], async ({ call }) => {
    const result = await call('search_employees', { query: 'sule' });
    assert.equal(result.isError, true);
  });
});

test('search_employees reports an IP allowlist block instead of falling back', async () => {
  const blocked = () => json({ status: 403, error: 'IP_NOT_ALLOWED', message_code: 'IP_NOT_ALLOWED' }, 403);
  await withMcp([['GET /user/list-pagination', blocked]], async ({ call, calls }) => {
    const result = await call('search_employees', { query: 'sule' });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /approved IP addresses/);
    assert.equal(callsTo(calls, 'GET', '/authorized-employee/').length, 0);
  });
});

test('get_employee_profile returns the work profile', async () => {
  await withMcp([], async ({ call }) => {
    const result = await call('get_employee_profile', { user_id: 'u-2' });
    assert.deepEqual(result.structuredContent.employee.manager, { id: 'u-1', fullName: 'Ayşe Yılmaz' });
    assert.equal(result.structuredContent.employee.workplace, 'Merkez');
  });
  await withMcp([['GET /user/getUserSummaryByUserId/u-404', () => softFailure('USER_NOT_FOUND', 'Get failed')]], async ({ call }) => {
    const result = await call('get_employee_profile', { user_id: 'u-404' });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /search_employees/);
  });
});

// -------------------------------------------------------------- performance

test('list_performance_periods returns ISO days and the ordered scale', async () => {
  await withMcp([], async ({ call }) => {
    const result = await call('list_performance_periods');
    const [period] = result.structuredContent.periods;
    assert.equal(period.title, 'Q4 2026');
    assert.equal(period.startDate, '2026-10-01');
    assert.equal(period.targetEntryOpen, true);
    assert.deepEqual(period.evaluationScale.map(item => item.label), ['Gelişmeli', 'Beklenen']);
  });
  await withMcp([['GET /performance-settings', () => new Response('boom', { status: 500 })]], async ({ call }) => {
    assert.equal((await call('list_performance_periods')).isError, true);
  });
});

test('list_my_goals suggests sending drafts and rejects unknown periods', async () => {
  await withMcp([], async ({ call, calls }) => {
    const result = await call('list_my_goals', { period: 'Q4 2026' });
    assert.equal(callsTo(calls, 'GET', '/user-goal/my')[0].query.periodName, 'Q4 2026');
    assert.equal(result.structuredContent.goals[0].targetValue, 120);
    assert.deepEqual(result.structuredContent.nextAction.arguments, { goal_ids: ['g-1'] });
  });
  await withMcp([['GET /user-goal/my', () => envelope({ goals: [], canAddGoal: false, pagination: { hasNext: false } })]], async ({ call }) => {
    const result = await call('list_my_goals', { period: 'Q5 2026' });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /"Q4 2026"/);
  });
});

test('goal lists retry with the exact period title when only the spelling differs', async () => {
  await withMcp([['GET /user-goal/my', call => envelope({
    goals: call.query.periodName === 'Q4 2026' ? [{ id: 'g-1', name: 'Bayi satışı', status: 'APPROVED' }] : [],
    canAddGoal: false,
    pagination: { hasNext: false },
  })]], async ({ call, calls }) => {
    const result = await call('list_my_goals', { period: 'q4 2026' });
    assert.notEqual(result.isError, true, textOf(result));
    assert.deepEqual(callsTo(calls, 'GET', '/user-goal/my').map(request => request.query.periodName), ['q4 2026', 'Q4 2026']);
    assert.equal(result.structuredContent.period, 'Q4 2026');
    assert.equal(result.structuredContent.total, 1);
  });
});

test('list_team_goals passes the status filter and points to approve_goal', async () => {
  await withMcp([], async ({ call, calls }) => {
    const result = await call('list_team_goals', { period: 'Q4 2026', status: 'WAITING_APPROVAL' });
    assert.equal(callsTo(calls, 'GET', '/user-goal/assigned')[0].query.status, 'WAITING_APPROVAL');
    assert.equal(result.structuredContent.nextAction.tool, 'approve_goal');
  });
  await withMcp([['GET /user-goal/assigned', () => hardFailure('NOT_AUTHORIZED', 'PERMISSION_DENIED', 400)]], async ({ call }) => {
    const result = await call('list_team_goals', { period: 'Q4 2026' });
    assert.equal(result.isError, true);
  });
});

test('create_user_goal sends the web app\'s goal payload', async () => {
  await withMcp([], async ({ call, calls }) => {
    const result = await call('create_user_goal', {
      period: 'q4 2026',
      name: 'Bayi satışı',
      scale_criterion: 'CURRENCY',
      currency: 'try',
      weight: 40,
      target_value: 250000,
    });
    assert.notEqual(result.isError, true, textOf(result));
    const [create] = callsTo(calls, 'POST', '/user-goal').filter(request => request.path === '/user-goal');
    assert.deepEqual(create.body, {
      userId: 'u-1',
      name: 'Bayi satışı',
      type: 'PERSONAL',
      weight: 40,
      periodName: 'Q4 2026',
      periodStartDate: '2026-10-01',
      periodEndDate: '2026-12-31',
      targetValueDefinition: {
        scaleCriterion: 'CURRENCY',
        currency: 'TRY',
        scores: [
          { text: 'Hedeflenen Performans', value: 250000, key: 'targetedPerformance' },
          { text: 'Gelişmeli', value: 50 },
          { text: 'Beklenen', value: 100 },
        ],
      },
    });
    assert.equal(result.structuredContent.goal.targetValue, 250000);
    assert.equal(result.structuredContent.nextAction.tool, 'send_goals_to_approval');
  });
});

test('create_user_goal validates input and respects canAddGoal', async () => {
  await withMcp([['GET /user-goal/my', () => envelope({ goals: [], canAddGoal: false })]], async ({ call, calls }) => {
    const missingWeight = await call('create_user_goal', {
      period: 'Q4 2026', name: 'X', scale_criterion: 'POINTS', target_value: 5,
    });
    assert.equal(missingWeight.isError, true);
    assert.match(textOf(missingWeight), /weight/);

    const closed = await call('create_user_goal', {
      period: 'Q4 2026', name: 'X', scale_criterion: 'OTHER', other_text: 'Süreci yaz',
    });
    assert.equal(closed.isError, true);
    assert.match(textOf(closed), /cannot add goals/);
    assert.equal(calls.filter(request => request.method === 'POST' && request.path === '/user-goal').length, 0);
  });
});

test('create_user_goal for someone else needs a direct report or the performance admin permission', async () => {
  const goalFor = { period: 'Q4 2026', name: 'X', scale_criterion: 'POINTS', weight: 20, target_value: 5 };
  await withMcp([], async ({ call, calls }) => {
    const report = await call('create_user_goal', { ...goalFor, user_id: 'u-2' });
    assert.notEqual(report.isError, true, textOf(report));
    assert.equal(callsTo(calls, 'POST', '/user-goal').filter(request => request.path === '/user-goal')[0].body.userId, 'u-2');
  });
  await withMcp([['GET /user/getUserSummaryByUserId/u-3', () => envelope({ id: 'u-3', fullname: 'Şule Kaya', managerId: 'u-9' })]],
    async ({ call, calls }) => {
      const stranger = await call('create_user_goal', { ...goalFor, user_id: 'u-3' });
      assert.equal(stranger.isError, true);
      assert.match(textOf(stranger), /direct reports/);
      assert.equal(calls.filter(request => request.method === 'POST' && request.path === '/user-goal').length, 0);
    });
  const admin = { ...ME, permissions: [...ME.permissions, { id: 'p9', code: 'PERFORMANCE_MANAGEMENT_ADMIN' }] };
  await withMcp([['GET /user', () => envelope(admin)]], async ({ call, calls }) => {
    const result = await call('create_user_goal', { ...goalFor, user_id: 'u-3' });
    assert.notEqual(result.isError, true, textOf(result));
    assert.equal(callsTo(calls, 'GET', '/user/getUserSummaryByUserId/').length, 0);
  });
});

test('send_goals_to_approval posts the id list', async () => {
  await withMcp([], async ({ call, calls }) => {
    const result = await call('send_goals_to_approval', { goal_ids: ['g-1'] });
    assert.deepEqual(callsTo(calls, 'POST', '/user-goal/send-to-approval')[0].body, ['g-1']);
    assert.equal(result.structuredContent.goals[0].status, 'WAITING_APPROVAL');
  });
  await withMcp([['POST /user-goal/send-to-approval', () => hardFailure('NO_PENDING_GOALS', 'INVALID_DATA')]], async ({ call }) => {
    const result = await call('send_goals_to_approval', { goal_ids: ['g-9'] });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /draft \(`PENDING`\)/);
  });
});

test('approve_goal approves and explains NOT_AUTHORIZED_TO_APPROVE', async () => {
  await withMcp([], async ({ call }) => {
    const result = await call('approve_goal', { goal_id: 'g-2' });
    assert.equal(result.structuredContent.goal.status, 'APPROVED');
  });
  await withMcp([['GET /user-goal/approve/g-2', () => hardFailure('NOT_AUTHORIZED_TO_APPROVE', 'PERMISSION_DENIED')]], async ({ call }) => {
    const result = await call('approve_goal', { goal_id: 'g-2' });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /not the approver/);
  });
});

test('revise_and_approve_goal rewrites only the target score', async () => {
  await withMcp([], async ({ call, calls }) => {
    const result = await call('revise_and_approve_goal', { goal_id: 'g-2', weight: 30, target_value: 150 });
    assert.notEqual(result.isError, true, textOf(result));
    const [put] = callsTo(calls, 'PUT', '/user-goal/revise-and-approve/g-2');
    assert.deepEqual(put.body, {
      weight: 30,
      targetValueDefinition: {
        scaleCriterion: 'QUANTITY',
        scores: [
          { text: 'Hedeflenen Performans', value: 150, key: 'targetedPerformance' },
          { text: 'Gelişmeli', value: 50 },
        ],
      },
    });
    assert.equal(result.structuredContent.goal.status, 'REVISED_AND_APPROVED');

    const empty = await call('revise_and_approve_goal', { goal_id: 'g-2' });
    assert.equal(empty.isError, true);
    assert.match(textOf(empty), /approve_goal/);
  });
});

test('update_goal_actual_value refreshes period statuses first', async () => {
  await withMcp([], async ({ call, calls }) => {
    const result = await call('update_goal_actual_value', { goal_id: 'g-1', actual_value: 95 });
    const order = calls.map(request => `${request.method} ${request.path}`);
    assert.ok(order.indexOf('GET /performance-settings') < order.indexOf('PUT /user-goal/g-1/actual-value'));
    assert.equal(callsTo(calls, 'PUT', '/user-goal/g-1/actual-value')[0].query.actualValue, '95');
    assert.equal(result.structuredContent.goal.actualValue, 95);
  });
  await withMcp([['PUT /user-goal/g-1/actual-value', () => hardFailure('GOAL_NOT_EVALUATING', 'INVALID_DATA')]], async ({ call }) => {
    const result = await call('update_goal_actual_value', { goal_id: 'g-1', actual_value: 95 });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /being evaluated/);
  });
});

test('update_manager_actual_value sends the manager value', async () => {
  await withMcp([], async ({ call, calls }) => {
    const result = await call('update_manager_actual_value', { goal_id: 'g-2', value: 110 });
    assert.equal(callsTo(calls, 'PUT', '/user-goal/g-2/manager-actual-value')[0].query.managerActualValue, '110');
    assert.equal(result.structuredContent.goal.managerActualValue, 110);
    const both = await call('update_manager_actual_value', { goal_id: 'g-2', value: 1, text: 'x' });
    assert.equal(both.isError, true);
  });
  await withMcp([['PUT /user-goal/g-2/manager-actual-value', () => hardFailure('NOT_AUTHORIZED', 'PERMISSION_DENIED')]], async ({ call }) => {
    const result = await call('update_manager_actual_value', { goal_id: 'g-2', value: 110 });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /manager or an admin/);
  });
});

test('approve_goal_evaluation returns the final score', async () => {
  await withMcp([], async ({ call, calls }) => {
    const result = await call('approve_goal_evaluation', { period: 'q4 2026', user_id: 'u-2' });
    assert.deepEqual(callsTo(calls, 'POST', '/user-goal/approve-evaluation-process')[0].query,
      { periodName: 'Q4 2026', userId: 'u-2' }, 'the exact period title is sent');
    assert.equal(result.structuredContent.period, 'Q4 2026');
    assert.equal(result.structuredContent.finalScore, 4.2);
    assert.equal(result.structuredContent.newStatus, 'COMPLETED');
  });
  await withMcp([['POST /user-goal/approve-evaluation-process', () => hardFailure('NO_GOALS_IN_APPROVAL_PROCESS', 'ITEM_NOT_FOUND')]], async ({ call }) => {
    const result = await call('approve_goal_evaluation', { period: 'Q4 2026', user_id: 'u-2' });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /no goal evaluation waiting/);
  });
});

// ------------------------------------------------------------ communication

test('list_announcements strips HTML and honours the limit', async () => {
  await withMcp([], async ({ call }) => {
    const result = await call('list_announcements', { limit: 1 });
    assert.equal(result.structuredContent.total, 2);
    assert.deepEqual(result.structuredContent.announcements, [{
      id: 'a-1',
      type: 'companyAnnouncement',
      text: 'Yeni ofis açıldı\nDetaylar & saatler',
      date: '2026-10-10',
      sharedBy: 'İK Ekibi',
    }]);
  });
  await withMcp([['GET /dashboard/getAnnouncements', () => new Response('', { status: 502 })]], async ({ call }) => {
    assert.equal((await call('list_announcements', {})).isError, true);
  });
});

// ------------------------------------------------------------------ payroll

test('list_my_payslips filters by term', async () => {
  await withMcp([], async ({ call, calls }) => {
    const result = await call('list_my_payslips', { term: '2026-09' });
    const [list] = callsTo(calls, 'GET', '/payroll/getPayrollsByMe-pagination');
    assert.equal(list.query.searchKey, 'term');
    assert.equal(list.query.searchValue, '2026-09');
    assert.equal(result.structuredContent.payslips[0].id, 'pay-1');
    assert.equal(result.structuredContent.nextAction.tool, 'get_payslip_pdf');
  });
  await withMcp([['GET /payroll/getPayrollsByMe-pagination', () => softFailure('INVALID_INPUT_PARAMETERS')]], async ({ call }) => {
    const result = await call('list_my_payslips', {});
    assert.equal(result.isError, true);
  });
});

test('get_payslip_pdf embeds the PDF as a base64 resource', async () => {
  await withMcp([], async ({ call, calls }) => {
    const result = await call('get_payslip_pdf', { payslip_id: 'pay-1' });
    const resource = result.content.find(block => block.type === 'resource').resource;
    assert.equal(resource.mimeType, 'application/pdf');
    assert.deepEqual(Buffer.from(resource.blob, 'base64'), Buffer.from(PDF_BYTES));
    assert.equal(result.structuredContent.fileName, 'bordro-2026-09.pdf');
    assert.equal(result.structuredContent.sizeBytes, PDF_BYTES.byteLength);
    assert.match(callsTo(calls, 'GET', '/payroll/download-file/pay-1')[0].headers.get('accept'), /application\/pdf/);
  });
  await withMcp([['GET /payroll/download-file/pay-9', () => new Response(null, { status: 404 })]], async ({ call }) => {
    const result = await call('get_payslip_pdf', { payslip_id: 'pay-9' });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /list_my_payslips/);
  });
});
