import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_INSTRUCTIONS, TOOLSETS, TOOL_NAMES } from '../dist/server.js';
import { VALID_OTP, envelope, hardFailure, json, softFailure, textOf, withMcp } from './helpers.mjs';

/** Calls to exactly this path (no prefix match: `/pdks-qr/corrections` is not `/pdks-qr/corrections/me`). */
function exact(calls, method, path) {
  return calls.filter(call => call.method === method && call.path === path);
}

/** HTTP 400 refusal of the Refused-style services: the code in `message`. */
function refused(code) {
  return json({ code: 0, message: code, message_code: 'INVALID_INPUT_PARAMETERS' }, 400);
}

const NEW_TOOLSETS = {
  pdks: ['get_my_attendance_today', 'get_team_attendance_today', 'list_my_missed_scans', 'request_missed_scan',
    'list_missed_scan_requests', 'decide_missed_scan_request'],
  timesheet: ['list_my_timesheets', 'approve_my_timesheet', 'dispute_my_timesheet', 'get_timesheet_approval_status'],
  shift: ['list_my_shifts'],
  expense: ['list_expense_types', 'list_my_expenses', 'create_expense'],
  ats: ['list_job_postings', 'list_job_candidates'],
  onboarding: ['list_onboarding_candidates'],
};
const WRITES = ['request_missed_scan', 'decide_missed_scan_request', 'approve_my_timesheet', 'dispute_my_timesheet',
  'create_expense'];

// ---------------------------------------------------------------- catalog

test('the workforce tools are six toolsets after payroll, before the generic API tools', async () => {
  for (const [name, tools] of Object.entries(NEW_TOOLSETS)) assert.deepEqual([...TOOLSETS[name]], tools, name);
  const all = Object.values(NEW_TOOLSETS).flat();
  const at = TOOL_NAMES.indexOf('get_my_attendance_today');
  assert.equal(TOOL_NAMES[at - 1], 'get_payslip_pdf');
  assert.deepEqual(TOOL_NAMES.slice(at, at + all.length), all);
  assert.equal(TOOL_NAMES[at + all.length], 'find_api_endpoints');
  for (const name of all) assert.match(DEFAULT_INSTRUCTIONS, new RegExp(`\\b${name}\\b`), name);
  assert.match(DEFAULT_INSTRUCTIONS, /"puantaj", "mutabakat"/);
  await withMcp([], async ({ tools }) => {
    for (const name of all) {
      const tool = tools.find(item => item.name === name);
      assert.ok(tool, name);
      if (WRITES.includes(name)) {
        assert.equal(tool.annotations.readOnlyHint, false, name);
      } else {
        assert.equal(tool.annotations.readOnlyHint, true, name);
        assert.equal(tool.annotations.destructiveHint, false, name);
      }
    }
    // the irreversible decisions are marked destructive
    for (const name of ['decide_missed_scan_request', 'approve_my_timesheet']) {
      assert.equal(tools.find(item => item.name === name).annotations.destructiveHint, true, name);
    }
    // writes without an SMS code preview by default; SMS-protected ones send the code only on request
    for (const name of ['request_missed_scan', 'decide_missed_scan_request', 'dispute_my_timesheet']) {
      assert.equal(tools.find(item => item.name === name).inputSchema.properties.confirm.default, false, name);
    }
    for (const name of ['approve_my_timesheet', 'create_expense']) {
      const props = tools.find(item => item.name === name).inputSchema.properties;
      assert.equal(props.send_sms_code.default, false, name);
      assert.ok(props.otp_code, name);
    }
  });
});

test('each new toolset serves only its own tools', async () => {
  for (const [name, tools] of Object.entries(NEW_TOOLSETS)) {
    await withMcp([], async ({ tools: listed }) => {
      assert.deepEqual(listed.map(tool => tool.name), tools, name);
    }, {}, { toolsets: name });
  }
});

// ------------------------------------------------------------------- PDKS

const MY_STATUS = {
  moduleActive: true,
  userName: 'Ayşe Yılmaz',
  serverTime: '09:42',
  timezone: 'Europe/Istanbul',
  shift: { hasPlan: true, start: '09:00', end: '18:00' },
  today: { checkIn: '09:12', checkOut: null, onBreak: false, late: true, next: 'CHECK_OUT', breakStartedAt: null },
  locations: [{ id: 'loc-1', name: 'Merkez' }],
  pendingExcuses: [{ anomalyId: 'an-1', type: 'LATE', date: '2026-11-13', minutes: 12, requested: false }],
};

test('get_my_attendance_today shows the caller\'s own day', async () => {
  await withMcp([['GET /pdks-qr/my-status', () => envelope(MY_STATUS)]], async ({ call, calls }) => {
    const result = await call('get_my_attendance_today');
    assert.notEqual(result.isError, true, textOf(result));
    const { shift, today, excusesToSend } = result.structuredContent;
    assert.deepEqual(shift, { planned: true, start: '09:00', end: '18:00' });
    assert.equal(today.checkedInAt, '09:12');
    assert.equal(today.late, true);
    assert.equal(today.nextScan, 'CHECK_OUT');
    assert.equal(today.checkedOutAt, undefined);
    assert.deepEqual(excusesToSend, [{ anomalyId: 'an-1', type: 'LATE', date: '2026-11-13', minutes: 12 }]);
    assert.match(textOf(result), /09:12 \(late\)/);
    assert.equal(exact(calls, 'GET', '/pdks-qr/my-status').length, 1);
  });
});

test('get_team_attendance_today gives the counts and the people of the chosen card', async () => {
  const dashboard = { cameToday: 18, atWork: 15, noShow: 2, notStarted: 1, late: 3, earlyLeave: 1, onBreak: 2,
    activeNow: 15, openAnomalies: 4, pendingExcuses: 1, locationCount: 2 };
  const routes = [
    ['GET /pdks-qr/dashboard', () => envelope(dashboard)],
    ['GET /pdks-qr/dashboard/detail/late', () => envelope({
      rows: [
        { userId: 'u-2', userName: 'Can Öztürk', dateTime: '2026-11-16T09:24:00', minutes: 24, locationName: 'Merkez' },
        { userId: 'u-3', userName: 'Şule Kaya', dateTime: [2026, 11, 16, 9, 5], minutes: 5, locationName: '-' },
      ],
      movements: [],
    })],
    ['GET /pdks-qr/dashboard/detail/no-show', () => envelope({
      rows: [{ userId: 'u-4', userName: 'Ali Veli', plannedWindow: '09:00 - 18:00' }],
    })],
  ];
  await withMcp(routes, async ({ call, calls }) => {
    const result = await call('get_team_attendance_today');
    assert.notEqual(result.isError, true, textOf(result));
    const { counts, people, list, total } = result.structuredContent;
    assert.equal(list, 'late');
    assert.equal(counts.late, 3);
    assert.equal(counts.openDiscrepancies, 4);
    assert.equal(total, 2);
    assert.deepEqual(people[0], { userId: 'u-2', name: 'Can Öztürk', at: '2026-11-16 09:24', minutes: 24, location: 'Merkez' });
    assert.equal(people[1].at, '2026-11-16 09:05');
    assert.equal(people[1].location, undefined);

    const absent = await call('get_team_attendance_today', { list: 'no_show', limit: 1 });
    assert.equal(absent.structuredContent.people[0].plannedWindow, '09:00 - 18:00');
    assert.equal(exact(calls, 'GET', '/pdks-qr/dashboard/detail/no-show').length, 1);
  });
});

test('get_team_attendance_today explains the PDKS manager responsibility on 403', async () => {
  const forbidden = () => json({ code: 0, message: 'Access is denied', message_code: 'ACCESS_DENIED' }, 403);
  await withMcp([['GET /pdks-qr/dashboard', forbidden]], async ({ call }) => {
    const result = await call('get_team_attendance_today');
    assert.equal(result.isError, true);
    assert.match(textOf(result), /PDKS manager or admin responsibility/);
  });
});

const MY_CORRECTIONS = {
  missing: [{ day: '2026-11-13', type: 'CHECK_OUT', suggestedAt: '2026-11-13T18:00:00', otherMovementAt: '2026-11-13T09:01:00' }],
  requests: [{ id: 'cr-1', day: '2026-11-10', type: 'CHECK_IN', requestedAt: '2026-11-10T08:55:00', reason: 'FORGOT',
    status: 'APPROVED', decisionNote: null, decidedAt: '2026-11-11T10:00:00' }],
  limits: { maxDaysBack: 7, monthlyLimit: 3, usedThisMonth: 1 },
  reasons: ['FORGOT', 'PHONE_ISSUE', 'NO_SIGNAL', 'QR_UNAVAILABLE', 'OTHER'],
};

test('list_my_missed_scans lists the gaps, the requests and the limits, and suggests the request', async () => {
  await withMcp([['GET /pdks-qr/corrections/me', () => envelope(MY_CORRECTIONS)]], async ({ call }) => {
    const result = await call('list_my_missed_scans');
    assert.notEqual(result.isError, true, textOf(result));
    const { missing, requests, limits, nextAction } = result.structuredContent;
    assert.deepEqual(missing, [{ day: '2026-11-13', type: 'CHECK_OUT', suggestedAt: '2026-11-13 18:00', otherMovementAt: '2026-11-13 09:01' }]);
    assert.equal(requests[0].status, 'APPROVED');
    assert.equal(requests[0].requestedAt, '2026-11-10 08:55');
    assert.deepEqual(limits, { maxDaysBack: 7, monthlyLimit: 3, usedThisMonth: 1 });
    assert.equal(nextAction.tool, 'request_missed_scan');
    assert.deepEqual(nextAction.arguments, { day: '2026-11-13', type: 'CHECK_OUT', time: '18:00', reason: 'FORGOT' });
    assert.match(textOf(result), /Used 1 of 3 requests/);
  });
});

test('request_missed_scan previews without sending, sends with confirm, and explains refusals', async () => {
  let refusal = null;
  const routes = [['POST /pdks-qr/corrections', call => (refusal ? refused(refusal)
    : envelope({ id: 'cr-9', day: call.body.day, type: call.body.type, status: 'PENDING', reason: call.body.reason },
      'INSERT_SUCCESS'))]];
  await withMcp(routes, async ({ call, calls }) => {
    const args = { day: '2026-11-13', type: 'CHECK_OUT', time: '18:05', reason: 'FORGOT' };
    const preview = await call('request_missed_scan', args);
    assert.notEqual(preview.isError, true, textOf(preview));
    assert.equal(preview.structuredContent.submitted, false);
    assert.deepEqual(preview.structuredContent.nextAction.arguments, { ...args, confirm: true });
    assert.equal(exact(calls, 'POST', '/pdks-qr/corrections').length, 0);

    const sent = await call('request_missed_scan', { ...args, confirm: true });
    assert.notEqual(sent.isError, true, textOf(sent));
    assert.equal(sent.structuredContent.submitted, true);
    assert.equal(sent.structuredContent.correction.id, 'cr-9');
    assert.deepEqual(exact(calls, 'POST', '/pdks-qr/corrections')[0].body, args);

    refusal = 'ALREADY_PENDING';
    const twice = await call('request_missed_scan', { ...args, confirm: true });
    assert.equal(twice.isError, true);
    assert.match(textOf(twice), /already waiting for the manager/);

    const noNote = await call('request_missed_scan', { ...args, reason: 'OTHER', confirm: true });
    assert.equal(noNote.isError, true);
    assert.match(textOf(noNote), /note/);
    assert.equal(exact(calls, 'POST', '/pdks-qr/corrections').length, 2);
  });
});

const PENDING_CORRECTIONS = [
  { id: 'cr-2', day: '2026-11-13', type: 'CHECK_OUT', requestedAt: '2026-11-13T18:05:00', reason: 'FORGOT', status: 'PENDING',
    user: { id: 'u-2', name: 'Can', surname: 'Öztürk' }, canDecide: true },
  { id: 'cr-3', day: '2026-11-12', type: 'CHECK_IN', requestedAt: '2026-11-12T08:50:00', reason: 'NO_SIGNAL', status: 'PENDING',
    user: { id: 'u-3', name: 'Şule', surname: 'Kaya' }, canDecide: false },
];

test('list_missed_scan_requests lists the team\'s requests with canDecide and sends the status', async () => {
  await withMcp([['GET /pdks-qr/corrections', () => envelope(PENDING_CORRECTIONS)]], async ({ call, calls }) => {
    const result = await call('list_missed_scan_requests');
    assert.notEqual(result.isError, true, textOf(result));
    const { requests, total, nextAction } = result.structuredContent;
    assert.equal(total, 2);
    assert.deepEqual(requests[0].employee, { id: 'u-2', fullName: 'Can Öztürk' });
    assert.equal(requests[1].canDecide, false);
    assert.deepEqual(nextAction.arguments, { request_id: 'cr-2' });
    assert.equal(exact(calls, 'GET', '/pdks-qr/corrections')[0].query.status, 'PENDING');
    await call('list_missed_scan_requests', { status: 'ALL' });
    assert.equal(exact(calls, 'GET', '/pdks-qr/corrections')[1].query.status, 'ALL');
  });
});

test('decide_missed_scan_request previews, needs a note to reject and refuses requests the caller cannot decide', async () => {
  const routes = [
    ['GET /pdks-qr/corrections', () => envelope(PENDING_CORRECTIONS)],
    ['PUT /pdks-qr/corrections/cr-2/reject', call => envelope({ id: 'cr-2', status: 'REJECTED', decisionNote: call.body.note },
      'UPDATE_SUCCESS')],
    ['PUT /pdks-qr/corrections/cr-2/approve', () => envelope({ id: 'cr-2', status: 'APPROVED' }, 'UPDATE_SUCCESS')],
  ];
  await withMcp(routes, async ({ call, calls }) => {
    const noNote = await call('decide_missed_scan_request', { request_id: 'cr-2', approve: false, confirm: true });
    assert.equal(noNote.isError, true);
    assert.match(textOf(noNote), /note/);

    const preview = await call('decide_missed_scan_request', { request_id: 'cr-2', approve: false, note: 'O gün izinliydin' });
    assert.equal(preview.structuredContent.decided, false);
    assert.equal(calls.filter(c => c.method === 'PUT').length, 0);

    const done = await call('decide_missed_scan_request', { request_id: 'cr-2', approve: false, note: 'O gün izinliydin', confirm: true });
    assert.notEqual(done.isError, true, textOf(done));
    assert.equal(done.structuredContent.decided, true);
    assert.equal(done.structuredContent.request.status, 'REJECTED');
    assert.deepEqual(exact(calls, 'PUT', '/pdks-qr/corrections/cr-2/reject')[0].body, { note: 'O gün izinliydin' });

    const other = await call('decide_missed_scan_request', { request_id: 'cr-3', approve: true, confirm: true });
    assert.equal(other.isError, true);
    assert.match(textOf(other), /another manager decides it/);

    const unknown = await call('decide_missed_scan_request', { request_id: 'cr-x', approve: true, confirm: true });
    assert.equal(unknown.isError, true);
    assert.match(textOf(unknown), /not waiting for a decision/);
    assert.equal(calls.filter(c => c.method === 'PUT').length, 1);
  });
});

// -------------------------------------------------------------- timesheet

const MONTHS = [
  { id: 'att-10', year: 2026, month: 10, status: 'PENDING', reapproval: false, version: 1, sentAt: '2026-11-02T07:00:00.000+00:00',
    openDisputes: 0, disputedDays: [], totals: { workedDays: 20, missingDays: 1, leaveDays: 1, workedMinutes: 9600,
      plannedMinutes: 10080, overtimeMinutes: 90, waitingOvertimeMinutes: 0 } },
  { id: 'att-9', year: 2026, month: 9, status: 'APPROVED', reapproval: false, version: 1, openDisputes: 0, disputedDays: [],
    totals: { workedDays: 22, missingDays: 0, workedMinutes: 10560 } },
];

test('list_my_timesheets maps the months with totals in hours and points at the waiting one', async () => {
  await withMcp([['GET /timesheet-attestation/mcp/me', () => envelope(MONTHS)]], async ({ call, calls }) => {
    const result = await call('list_my_timesheets');
    assert.notEqual(result.isError, true, textOf(result));
    const { months, nextAction } = result.structuredContent;
    assert.equal(months[0].period, '2026-10');
    assert.equal(months[0].sentAt, '2026-11-02 10:00');
    assert.deepEqual(months[0].totals, { workedDays: 20, missingDays: 1, leaveDays: 1, workedHours: 160, plannedHours: 168,
      overtimeHours: 1.5, waitingOvertimeHours: 0 });
    assert.equal(nextAction.tool, 'approve_my_timesheet');
    assert.deepEqual(nextAction.arguments, { timesheet_id: 'att-10' });
    // the as-stored read, never the refreshing /me
    assert.equal(exact(calls, 'GET', '/timesheet-attestation/me').length, 0);
  });
});

test('approve_my_timesheet previews, sends the SMS code only on request and approves with the code', async () => {
  const routes = [
    ['GET /timesheet-attestation/mcp/me', () => envelope(MONTHS)],
    ['POST /timesheet-attestation/me/att-10/approve', () => envelope({ id: 'att-10', status: 'APPROVED' }, 'APPROVE_SUCCESS')],
  ];
  await withMcp(routes, async ({ call, calls }) => {
    const preview = await call('approve_my_timesheet', { timesheet_id: 'att-10' });
    assert.notEqual(preview.isError, true, textOf(preview));
    assert.equal(preview.structuredContent.approved, false);
    assert.equal(preview.structuredContent.smsSent, false);
    assert.deepEqual(preview.structuredContent.nextAction.arguments, { timesheet_id: 'att-10', send_sms_code: true });
    assert.equal(exact(calls, 'GET', '/sms/generateToken').length, 0);

    const sms = await call('approve_my_timesheet', { timesheet_id: 'att-10', send_sms_code: true });
    assert.equal(sms.structuredContent.smsSent, true);
    assert.equal(exact(calls, 'GET', '/sms/generateToken').length, 1);
    assert.equal(exact(calls, 'POST', '/timesheet-attestation/me/att-10/approve').length, 0);

    const done = await call('approve_my_timesheet', { timesheet_id: 'att-10', otp_code: VALID_OTP });
    assert.notEqual(done.isError, true, textOf(done));
    assert.equal(done.structuredContent.approved, true);
    assert.equal(done.structuredContent.status, 'APPROVED');
    const order = calls.map(c => `${c.method} ${c.path}`);
    assert.ok(order.indexOf(`GET /sms/checkToken/${VALID_OTP}`) < order.indexOf('POST /timesheet-attestation/me/att-10/approve'));

    const approved = await call('approve_my_timesheet', { timesheet_id: 'att-9', otp_code: VALID_OTP });
    assert.equal(approved.isError, true);
    assert.match(textOf(approved), /APPROVED; only a waiting one/);

    const wrong = await call('approve_my_timesheet', { timesheet_id: 'att-10', otp_code: '999999' });
    assert.equal(wrong.isError, true);
    assert.match(textOf(wrong), /SMS code is wrong/);
    assert.equal(exact(calls, 'POST', '/timesheet-attestation/me/att-10/approve').length, 1);
  });
});

test('approve_my_timesheet names the new version when the month changed', async () => {
  const routes = [
    ['GET /timesheet-attestation/mcp/me', () => envelope(MONTHS)],
    ['POST /timesheet-attestation/me/att-10/approve', () => json({ code: 0, message: 'CHANGED',
      message_code: 'INVALID_INPUT_PARAMETERS', result: { id: 'att-10b' } }, 400)],
  ];
  await withMcp(routes, async ({ call }) => {
    const result = await call('approve_my_timesheet', { timesheet_id: 'att-10', otp_code: VALID_OTP });
    assert.notEqual(result.isError, true, textOf(result));
    assert.equal(result.structuredContent.approved, false);
    assert.equal(result.structuredContent.newTimesheetId, 'att-10b');
    assert.equal(result.structuredContent.nextAction.tool, 'list_my_timesheets');
  });
});

test('dispute_my_timesheet previews, checks the days and sends them with confirm', async () => {
  const routes = [
    ['GET /timesheet-attestation/mcp/me', () => envelope(MONTHS)],
    ['POST /timesheet-attestation/me/att-10/dispute', call => envelope({ id: 'att-10', status: 'DISPUTED',
      days: call.body.days.length }, 'UPDATE_SUCCESS')],
  ];
  await withMcp(routes, async ({ call, calls }) => {
    const days = [{ day: '2026-10-14', note: 'O gün sahadaydım' }];
    const preview = await call('dispute_my_timesheet', { timesheet_id: 'att-10', days });
    assert.equal(preview.structuredContent.disputed, false);
    assert.equal(exact(calls, 'POST', '/timesheet-attestation/me/att-10/dispute').length, 0);

    const outside = await call('dispute_my_timesheet', { timesheet_id: 'att-10', days: [{ day: '2026-11-02', note: 'Yanlış' }],
      confirm: true });
    assert.equal(outside.isError, true);
    assert.match(textOf(outside), /not in 2026-10/);

    const sent = await call('dispute_my_timesheet', { timesheet_id: 'att-10', days, note: 'Lütfen bakın', confirm: true });
    assert.notEqual(sent.isError, true, textOf(sent));
    assert.equal(sent.structuredContent.disputed, true);
    assert.equal(sent.structuredContent.status, 'DISPUTED');
    assert.deepEqual(exact(calls, 'POST', '/timesheet-attestation/me/att-10/dispute')[0].body, { days, note: 'Lütfen bakın' });
  });
});

test('get_timesheet_approval_status reads the stored status table of a month', async () => {
  const rounds = {
    year: 2026, month: 10, counts: { total: 3, APPROVED: 1, PENDING: 1, DISPUTED: 1 },
    rows: [
      { id: 'att-a', userId: 'u-2', name: 'Can Öztürk', branchName: 'Merkez', status: 'DISPUTED', reapproval: false,
        openDisputes: 1, disputedDays: ['2026-10-14'], totals: { missingDays: 2 } },
      { id: 'att-b', userId: 'u-3', name: 'Şule Kaya', branchName: 'Merkez', status: 'PENDING', reapproval: true,
        openDisputes: 0, disputedDays: [], totals: { missingDays: 0 } },
    ],
    notSent: 4, monthOver: true, canSend: true,
  };
  await withMcp([['GET /timesheet-attestation/mcp/rounds', () => envelope(rounds)]], async ({ call, calls }) => {
    const result = await call('get_timesheet_approval_status', { year: 2026, month: 10, limit: 1 });
    assert.notEqual(result.isError, true, textOf(result));
    const { period, counts, notSent, employees, total, truncated } = result.structuredContent;
    assert.equal(period, '2026-10');
    assert.deepEqual(counts, { total: 3, approved: 1, pending: 1, disputed: 1 });
    assert.equal(notSent, 4);
    assert.equal(employees[0].missingDays, 2);
    assert.deepEqual(employees[0].disputedDays, ['2026-10-14']);
    assert.equal(total, 2);
    assert.equal(truncated, true);
    assert.deepEqual(exact(calls, 'GET', '/timesheet-attestation/mcp/rounds')[0].query, { year: '2026', month: '10' });
    await call('get_timesheet_approval_status', {});
    const query = exact(calls, 'GET', '/timesheet-attestation/mcp/rounds')[1].query;
    assert.match(query.year, /^\d{4}$/);
    assert.match(query.month, /^([1-9]|1[0-2])$/);
  });
});

// ------------------------------------------------------------------ shift

test('list_my_shifts lists the caller\'s shared shifts with breaks', async () => {
  const answer = {
    from: '2026-11-16', to: '2026-11-22', total: 2,
    shifts: [
      { id: 's-1', date: '2026-11-16', dayName: 'MONDAY', working: true, start: '09:00', end: '18:00', overnight: false,
        branchId: 'b-1', branchName: 'Merkez', note: null, breaks: [{ start: '12:30', end: '13:30' }] },
      { id: 's-2', date: '2026-11-17', dayName: 'TUESDAY', working: false, start: null, end: null, overnight: false,
        branchName: null, breaks: [] },
    ],
  };
  await withMcp([['GET /shift/mcp/my-shifts', () => envelope(answer)]], async ({ call, calls }) => {
    const result = await call('list_my_shifts', { from: '2026-11-16', to: '2026-11-22' });
    assert.notEqual(result.isError, true, textOf(result));
    const { shifts, total } = result.structuredContent;
    assert.equal(total, 2);
    assert.deepEqual(shifts[0].breaks, [{ start: '12:30', end: '13:30' }]);
    assert.equal(shifts[1].working, false);
    assert.match(textOf(result), /Day off/);
    assert.deepEqual(exact(calls, 'GET', '/shift/mcp/my-shifts')[0].query, { startDate: '2026-11-16', endDate: '2026-11-22' });
  });
  await withMcp([['GET /shift/mcp/my-shifts', () => refused('RANGE_TOO_LONG')]], async ({ call }) => {
    const result = await call('list_my_shifts', { from: '2026-01-01', to: '2026-04-01' });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /62 days/);
  });
});

// ---------------------------------------------------------------- expense

const EXPENSE_TYPES = [
  { id: 'et-taxi', name: 'Taksi', status: true, maxAmount: 1500, currency: 'TRY' },
  { id: 'et-hotel', name: 'Otel', status: true, maxAmount: -1, currency: '-1', allowLimitOverrun: true },
];

test('list_expense_types maps the types and treats GET_ERROR as an empty list', async () => {
  await withMcp([['GET /expense-type/listAllByActive', () => envelope(EXPENSE_TYPES)]], async ({ call }) => {
    const result = await call('list_expense_types');
    assert.notEqual(result.isError, true, textOf(result));
    assert.deepEqual(result.structuredContent.expenseTypes, [
      { id: 'et-taxi', name: 'Taksi', currency: 'TRY', maxAmount: 1500 },
      { id: 'et-hotel', name: 'Otel', allowLimitOverrun: true },
    ]);
  });
  await withMcp([['GET /expense-type/listAllByActive', () => softFailure('GET_ERROR')]], async ({ call }) => {
    const result = await call('list_expense_types');
    assert.notEqual(result.isError, true, textOf(result));
    assert.deepEqual(result.structuredContent.expenseTypes, []);
  });
});

test('list_my_expenses maps statuses and sends scope and status', async () => {
  const page = {
    items: [{ id: 'eg-1', title: 'İzmir ziyareti', status: 'EXPENSE_APPROVAL_PROCESS', owner: { id: 'u-1', fullName: 'Ayşe Yılmaz' },
      receiptCount: 2, totals: [{ currency: 'TRY', amount: 1250.456, payable: 1250.456 }], createdAt: '2026-11-10T08:00:00.000+00:00',
      currentStepLabel: 'Adım 1', limitOverrun: false }],
    pagination: { page: 0, size: 20, totalRecords: 1, totalPages: 1 },
  };
  await withMcp([['GET /expense-management/groups', () => envelope(page)]], async ({ call, calls }) => {
    const result = await call('list_my_expenses', { status: 'in_approval' });
    assert.notEqual(result.isError, true, textOf(result));
    const [group] = result.structuredContent.groups;
    assert.equal(group.status, 'in_approval');
    assert.equal(group.statusCode, 'EXPENSE_APPROVAL_PROCESS');
    assert.deepEqual(group.totals, [{ currency: 'TRY', amount: 1250.46, payable: 1250.46 }]);
    assert.equal(group.createdAt, '2026-11-10 11:00');
    assert.deepEqual(exact(calls, 'GET', '/expense-management/groups')[0].query,
      { scope: 'mine', status: 'EXPENSE_APPROVAL_PROCESS', page: '0', size: '20' });
    await call('list_my_expenses', { scope: 'approval' });
    assert.equal(exact(calls, 'GET', '/expense-management/groups')[1].query.scope, 'approval');
  });
});

function expenseRoutes(state = {}) {
  return [
    ['GET /expense-type/listAllByActive', () => envelope(EXPENSE_TYPES)],
    ['GET /file-upload/my-uploads/expenseForm', () => envelope(state.leftovers ?? [])],
    ['POST /expense-form', () => envelope({ id: 'eg-new', status: 'EXPENSE_PENDING' }, 'INSERT_SUCCESS')],
    ['POST /file-upload/expenseForm', () => envelope({ fileName: 'x.jpg' }, 'INSERT_SUCCESS')],
    ['POST /expense-form-detail', () => envelope({ id: 'ed-1' }, 'INSERT_SUCCESS')],
    ['GET /expense-form/eg-new/limit-check', () => envelope(state.limits ?? { overrun: false, blocked: false, warnings: [] })],
    ['POST /expense-form/eg-new/finalize', () => (state.finalizeFails
      ? softFailure('SMTIMESTAMP_ERROR', 'Timestamp validation failed.')
      : envelope(undefined, 'UPDATE_SUCCESS'))],
    ['DELETE /expense-form/eg-new', () => envelope(undefined, 'DELETE_SUCCESS')],
  ];
}

const RECEIPTS = [
  { expense_type_id: 'et-taxi', amount: 450, date: '2026-11-12', description: 'Havalimanı taksi', tax_rate: 20 },
  { expense_type_id: 'et-hotel', amount: 120, currency: 'EUR', date: '2026-11-12', description: 'Otel', paid_by: 'company_card',
    file: { filename: 'otel.pdf', content_type: 'application/pdf', base64: Buffer.from('%PDF-1.4').toString('base64') } },
];

test('create_expense previews and checks the receipts against the types without creating anything', async () => {
  await withMcp(expenseRoutes(), async ({ call, calls }) => {
    const preview = await call('create_expense', { title: 'İzmir ziyareti', receipts: RECEIPTS });
    assert.notEqual(preview.isError, true, textOf(preview));
    const { submitted, smsSent, receipts, totals, problems, nextAction } = preview.structuredContent;
    assert.equal(submitted, false);
    assert.equal(smsSent, false);
    assert.deepEqual(problems, []);
    assert.equal(receipts[0].currency, 'TRY');
    assert.equal(receipts[1].paidBy, 'company_card');
    assert.equal(receipts[1].file, 'otel.pdf');
    assert.deepEqual(totals, [{ currency: 'TRY', amount: 450 }, { currency: 'EUR', amount: 120 }]);
    assert.deepEqual(nextAction.arguments, { send_sms_code: true });

    const bad = await call('create_expense', { title: 'x', receipts: [
      { expense_type_id: 'et-taxi', amount: 2000, currency: 'USD', date: '2026-11-12', description: 'Taksi' },
      { expense_type_id: 'et-gone', amount: 10, date: '2026-11-12', description: 'Yok' },
    ], send_sms_code: true });
    assert.notEqual(bad.isError, true, textOf(bad));
    assert.equal(bad.structuredContent.smsSent, false);
    assert.equal(bad.structuredContent.problems.length, 3);
    assert.match(bad.structuredContent.problems.join(' '), /takes TRY, not USD/);
    assert.match(bad.structuredContent.problems.join(' '), /at most 1500/);
    assert.match(bad.structuredContent.problems.join(' '), /not an active expense type/);
    assert.equal(exact(calls, 'GET', '/sms/generateToken').length, 0);

    const sms = await call('create_expense', { title: 'İzmir ziyareti', receipts: RECEIPTS, send_sms_code: true });
    assert.equal(sms.structuredContent.smsSent, true);
    assert.equal(exact(calls, 'GET', '/sms/generateToken').length, 1);
    assert.equal(exact(calls, 'POST', '/expense-form').length, 0);
  });
});

test('create_expense creates the group, uploads the file, checks the limits, verifies the code and sends it', async () => {
  await withMcp(expenseRoutes(), async ({ call, calls }) => {
    const result = await call('create_expense', { title: 'İzmir ziyareti', description: 'Müşteri', receipts: RECEIPTS,
      otp_code: VALID_OTP });
    assert.notEqual(result.isError, true, textOf(result));
    assert.equal(result.structuredContent.submitted, true);
    assert.equal(result.structuredContent.groupId, 'eg-new');
    const order = calls.map(c => `${c.method} ${c.path}`).filter(key => !key.startsWith('GET /expense-type')
      && !key.startsWith('GET /file-upload'));
    assert.deepEqual(order, [
      'POST /expense-form',
      'POST /expense-form-detail',
      'POST /file-upload/expenseForm',
      'POST /expense-form-detail',
      'GET /expense-form/eg-new/limit-check',
      `GET /sms/checkToken/${VALID_OTP}`,
      'POST /expense-form/eg-new/finalize',
    ]);
    const [taxi, hotel] = exact(calls, 'POST', '/expense-form-detail').map(c => c.body);
    assert.deepEqual(taxi, { expenseFormId: 'eg-new', expenseTypeId: 'et-taxi', receiptAmount: 450, currencyType: 'TRY',
      taxRate: 20, receiptDate: '2026-11-12', expenseDescription: 'Havalimanı taksi', paidAmountToEmployee: 450,
      paidAmountByCompanyCard: 0, advancePaymentAmount: 0 });
    assert.equal(hotel.paidAmountToEmployee, 0);
    assert.equal(hotel.paidAmountByCompanyCard, 120);
    assert.ok(exact(calls, 'POST', '/file-upload/expenseForm')[0].rawBody instanceof FormData);
    assert.deepEqual(exact(calls, 'POST', '/expense-form')[0].body, { title: 'İzmir ziyareti', description: 'Müşteri' });
    assert.deepEqual(exact(calls, 'POST', '/expense-form/eg-new/finalize')[0].body, { acknowledgeLimitOverrun: false });
    assert.equal(exact(calls, 'DELETE', '/expense-form/eg-new').length, 0);
  });
});

test('create_expense removes the draft when a limit is over, the code is wrong or sending fails', async () => {
  const overrun = { limits: { overrun: true, blocked: false, warnings: [{ departmentId: 'd-1' }] } };
  await withMcp(expenseRoutes(overrun), async ({ call, calls }) => {
    const result = await call('create_expense', { title: 'x', receipts: [RECEIPTS[0]], otp_code: VALID_OTP });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /acknowledge_limit_overrun: true/);
    assert.equal(exact(calls, 'DELETE', '/expense-form/eg-new').length, 1);
    assert.equal(calls.filter(c => c.path.startsWith('/sms/checkToken')).length, 0);

    const acknowledged = await call('create_expense', { title: 'x', receipts: [RECEIPTS[0]], otp_code: VALID_OTP,
      acknowledge_limit_overrun: true });
    assert.notEqual(acknowledged.isError, true, textOf(acknowledged));
    assert.equal(acknowledged.structuredContent.limitWarnings, 1);
    assert.deepEqual(exact(calls, 'POST', '/expense-form/eg-new/finalize')[0].body, { acknowledgeLimitOverrun: true });
  });
  await withMcp(expenseRoutes({ limits: { overrun: true, blocked: true, warnings: [{}] } }), async ({ call, calls }) => {
    const result = await call('create_expense', { title: 'x', receipts: [RECEIPTS[0]], otp_code: VALID_OTP });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /cannot be exceeded/);
    assert.equal(exact(calls, 'DELETE', '/expense-form/eg-new').length, 1);
  });
  await withMcp(expenseRoutes(), async ({ call, calls }) => {
    const result = await call('create_expense', { title: 'x', receipts: [RECEIPTS[0]], otp_code: '999999' });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /SMS code is wrong/);
    assert.equal(exact(calls, 'DELETE', '/expense-form/eg-new').length, 1);
    assert.equal(exact(calls, 'POST', '/expense-form/eg-new/finalize').length, 0);
  });
  await withMcp(expenseRoutes({ finalizeFails: true }), async ({ call, calls }) => {
    const result = await call('create_expense', { title: 'x', receipts: [RECEIPTS[0]], otp_code: VALID_OTP });
    assert.equal(result.isError, true);
    assert.equal(exact(calls, 'DELETE', '/expense-form/eg-new').length, 1);
  });
});

test('create_expense refuses while receipt files of an unfinished form are waiting', async () => {
  await withMcp(expenseRoutes({ leftovers: [{ fileName: 'eski.jpg' }] }), async ({ call, calls }) => {
    const preview = await call('create_expense', { title: 'x', receipts: [RECEIPTS[0]] });
    assert.match(preview.structuredContent.problems.join(' '), /1 receipt file/);
    const result = await call('create_expense', { title: 'x', receipts: [RECEIPTS[0]], otp_code: VALID_OTP });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /SMS code was not used/);
    assert.equal(exact(calls, 'POST', '/expense-form').length, 0);
  });
});

// -------------------------------------------------------------------- ATS

test('list_job_postings maps the postings and keeps the all-candidates row apart', async () => {
  const rows = [
    { id: '0', positionName: 'Tüm Adaylar / CVler', status: 'all', candidateCount: 120 },
    { id: 'jp-1', positionName: 'Satış Uzmanı', status: 'ACTIVE', candidateCount: 14, location: 'İstanbul, Türkiye',
      sharedDate: '2026-11-01', daysSinceShared: 14, workModel: 'HYBRID', workingType: 'FULL_TIME', departmentNames: ['Satış'] },
    { id: 'jp-2', positionName: 'Muhasebe', status: 'ACTIVE', candidateCount: 30, sharedDate: [2026, 10, 20], departmentNames: [] },
  ];
  await withMcp([['GET /job-posting/list-with-candidate-counts', () => envelope(rows)]], async ({ call, calls }) => {
    const result = await call('list_job_postings', { status: 'ACTIVE', position: 'Satış' });
    assert.notEqual(result.isError, true, textOf(result));
    const { postings, allCandidates, nextAction } = result.structuredContent;
    assert.equal(allCandidates, 120);
    assert.deepEqual(postings.map(p => p.id), ['jp-1', 'jp-2']);
    assert.equal(postings[0].publishedOn, '2026-11-01');
    assert.equal(postings[1].publishedOn, '2026-10-20');
    assert.deepEqual(nextAction.arguments, { job_posting_id: 'jp-2' });
    assert.deepEqual(exact(calls, 'GET', '/job-posting/list-with-candidate-counts')[0].query,
      { statusFilter: 'ACTIVE', searchKey: 'position', searchValue: 'Satış' });
  });
});

test('list_job_candidates gives stage and scores without contact details', async () => {
  const page = {
    items: [{ id: 'c-1', name: 'Deniz', surname: 'Ak', email: 'deniz@example.test', phone: '5551112233', status: 'INTERVIEW',
      subStatus: 'FIRST', cvScore: '82', criteriaFit: 75, isFavorite: true, createdAt: '2026-11-05T10:00:00.000+00:00' }],
    pagination: { currentPage: 0, pageSize: 20, totalRecords: 9, totalPages: 1 },
    filters: { statusCounts: { NEWCANDIDATE: 5, INTERVIEW: 3, HIRED: 1, ALL: 9 } },
  };
  await withMcp([['GET /job-posting/list-candidate/jp-1/pagination', () => envelope(page)]], async ({ call, calls }) => {
    const result = await call('list_job_candidates', { job_posting_id: 'jp-1', status: 'INTERVIEW' });
    assert.notEqual(result.isError, true, textOf(result));
    const { candidates, stageCounts, total, truncated } = result.structuredContent;
    assert.deepEqual(candidates[0], { id: 'c-1', fullName: 'Deniz Ak', status: 'INTERVIEW', subStatus: 'FIRST', cvScore: 82,
      criteriaFit: 75, favorite: true, appliedAt: '2026-11-05 13:00' });
    assert.equal(stageCounts.INTERVIEW, 3);
    assert.equal(total, 9);
    assert.equal(truncated, true);
    assert.doesNotMatch(JSON.stringify(result), /deniz@example|5551112233/);
    assert.equal(exact(calls, 'GET', '/job-posting/list-candidate/jp-1/pagination')[0].query.status, 'INTERVIEW');
  });
});

// ------------------------------------------------------------- onboarding

test('list_onboarding_candidates explains each stage and who has to act', async () => {
  const page = {
    items: [
      { id: 'on-1', name: 'Ece', surname: 'Demir', branch: { id: 'b-1', name: 'Merkez' }, status: 'AWAITING_DATA_ENTRY',
        isConfirmed: true, isConfirmedPhoneNumber: false, approvalQueue: 0, identificationNumber: '12345678901',
        startDateHistory: [{ id: 'h-1', startDate: '2026-12-01' }, { id: 'h-2', startDate: '2026-12-08' }] },
      { id: 'on-2', name: 'Mert', surname: 'Can', status: 'APPROVED', approvalQueue: 2, hasTransferFailure: false },
    ],
    pagination: { currentPage: 0, pageSize: 50, totalRecords: 2, totalPages: 1, hasNext: false },
  };
  await withMcp([['GET /onboarding/pagination', () => envelope(page)]], async ({ call, calls }) => {
    const result = await call('list_onboarding_candidates');
    assert.notEqual(result.isError, true, textOf(result));
    const [first] = result.structuredContent.candidates;
    assert.equal(first.waitingOn, 'candidate');
    assert.equal(first.startDate, '2026-12-08');
    assert.equal(first.emailConfirmed, true);
    assert.equal(first.phoneConfirmed, false);
    assert.doesNotMatch(JSON.stringify(result), /12345678901/);
    assert.equal(exact(calls, 'GET', '/onboarding/pagination')[0].query.active, 'true');

    const waiting = await call('list_onboarding_candidates', { waiting_only: true });
    assert.deepEqual(waiting.structuredContent.candidates.map(c => c.id), ['on-1']);

    await call('list_onboarding_candidates', { status: 'PENDING_APPROVAL' });
    const query = exact(calls, 'GET', '/onboarding/pagination')[2].query;
    assert.equal(query.searchKey, 'status');
    assert.equal(query.searchValue, 'PENDING_APPROVAL');
  });
  const forbidden = () => hardFailure('Access is denied', 'ACCESS_DENIED', 403);
  await withMcp([['GET /onboarding/pagination', forbidden]], async ({ call }) => {
    const result = await call('list_onboarding_candidates');
    assert.equal(result.isError, true);
    assert.match(textOf(result), /ONBOARDING_READ/);
  });
});
