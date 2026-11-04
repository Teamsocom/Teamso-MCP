import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_INSTRUCTIONS, TOOLSETS } from '../dist/server.js';
import { callsTo, envelope, hardFailure, json, textOf, withMcp } from './helpers.mjs';

const assignment = (overrides = {}) => ({
  assignmentUserId: 'au-1',
  assignmentId: 'as-1',
  contentType: 'SCENARIO',
  scenarioId: 'sc-angry',
  trackId: null,
  trackItemId: null,
  title: 'Kızgın müşteri: geciken kargo',
  dueDate: '2026-11-20',
  status: 'NOT_STARTED',
  bestScore: null,
  attempts: 0,
  maxAttempts: 3,
  passScore: 70,
  examMode: false,
  allowedModes: 'BOTH',
  difficulty: 'MEDIUM',
  note: 'Bu hafta bitirelim',
  overdue: false,
  ...overrides,
});

const ASSIGNMENTS = [
  assignment(),
  assignment({
    assignmentUserId: 'au-2', assignmentId: 'as-2', contentType: 'TRACK', scenarioId: null, trackId: 'tr-1',
    trackItemId: 'ti-1', title: 'Satış yolu', dueDate: '2026-11-05', status: 'IN_PROGRESS', bestScore: 55,
    attempts: 2, maxAttempts: 0, examMode: true, overdue: true, note: null,
  }),
  assignment({ assignmentUserId: 'au-3', title: 'Kapanmış', status: 'PASSED', bestScore: 88, attempts: 1, dueDate: '2026-10-01' }),
  assignment({ assignmentUserId: 'au-4', title: 'Tarihsiz', status: 'OVERDUE', dueDate: null, overdue: true }),
  assignment({ assignmentUserId: 'au-5', title: 'İptal', status: 'CANCELLED' }),
];

const attempt = (overrides = {}) => ({
  id: 'at-1',
  scenarioId: 'sc-angry',
  scenarioTitle: 'Kızgın müşteri: geciken kargo',
  mode: 'TEXT',
  difficulty: 'MEDIUM',
  kind: 'PRACTICE',
  status: 'SCORED',
  totalScore: 78,
  passed: true,
  startedAt: '2026-11-02T09:15:00Z',
  durationSec: 380,
  reviewState: 'NONE',
  overridden: false,
  ...overrides,
});

const TRANSCRIPT_LINE = 'Siparişim hâlâ gelmedi, bu kaçıncı gecikme!';

const RESULT = {
  totalScore: 78,
  passed: true,
  outcome: 'SUCCESS',
  criticalFailed: false,
  passScore: 70,
  criteria: [{
    key: 'empathy',
    name: 'Empati',
    skillTag: 'EMPATHY',
    weight: 30,
    level: 3,
    score: 75,
    rationale: 'Müşterinin hissini adıyla karşıladı.',
    evidence: [{ turn: 2, quote: 'Beklemenin ne kadar can sıkıcı olduğunu anlıyorum.' }],
    overridden: false,
  }, {
    key: 'solution',
    name: 'Çözüm önerisi',
    skillTag: 'PROBLEM_SOLVING',
    weight: 40,
    level: 4,
    score: 90,
    rationale: null,
    evidence: [],
    overridden: true,
  }],
  strengths: ['Sakin ton', ''],
  priorities: ['Somut bir tarih ver'],
  betterReplies: [{ turn: 4, text: 'Kargonuz yarın 12:00\'ye kadar elinizde olacak.' }],
  nextPracticeSkill: 'NEGOTIATION',
  scenario: { id: 'sc-angry', title: 'Kızgın müşteri: geciken kargo' },
  user: { id: 'u-1', name: 'Ayşe Yılmaz' },
  durationSec: 380,
  attempt: {
    id: 'at-1',
    mode: 'TEXT',
    difficulty: 'MEDIUM',
    startedAt: '2026-11-02T09:15:00Z',
    turns: [{ turn: 1, role: 'PERSONA', text: TRANSCRIPT_LINE }],
  },
};

const scenario = (id, overrides = {}) => ({
  scenarioId: id,
  title: `Senaryo ${id}`,
  description: 'Açıklama',
  sector: 'RETAIL',
  language: 'tr',
  direction: 'INBOUND',
  modes: ['TEXT', 'VOICE'],
  difficulties: ['EASY', 'MEDIUM'],
  estMinutes: 8,
  persona: { name: 'Mehmet', age: 45, occupation: 'Esnaf', city: 'İzmir' },
  myBestScore: null,
  myAttempts: 0,
  assignment: null,
  ...overrides,
});

const CATALOG = {
  shelves: [
    { key: 'ASSIGNED', items: [scenario('sc-angry', { myBestScore: 78, myAttempts: 2, assignment: { assignmentUserId: 'au-1', dueDate: '2026-11-20', status: 'IN_PROGRESS', overdue: false } })] },
    { key: 'RETAIL', items: [scenario('sc-angry'), scenario('sc-upsell', { modes: 'TEXT', difficulties: 'HARD', persona: null })] },
    { key: 'NEW', items: [scenario('sc-upsell'), scenario('sc-bank', { sector: 'BANKING' })] },
  ],
};

const ROUTES = [
  ['GET /simulation/assignments/mine', () => envelope(ASSIGNMENTS)],
  ['GET /simulation/attempts/mine', call => envelope({
    items: [attempt(), attempt({ id: 'at-0', status: 'SCORING', totalScore: null, passed: null, startedAt: '2026-11-01T21:30:00Z' })],
    total: 2,
    page: Number(call.query.page),
    size: Number(call.query.size),
  })],
  ['GET /simulation/attempts', call => envelope({
    items: [attempt({ id: 'at-7', userId: 'u-2', userName: 'Can Öztürk', passed: false, totalScore: 52 })],
    total: 41,
    page: Number(call.query.page),
    size: Number(call.query.size),
  })],
  ['GET /simulation/attempts/at-1/result', () => envelope(RESULT)],
  ['GET /simulation/catalog', () => envelope(CATALOG)],
];

test('simulation tools are their own toolset after badges, read-only, and the instructions point to the web app', async () => {
  assert.deepEqual([...TOOLSETS.simulation], ['list_simulation_assignments', 'get_simulation_results', 'list_simulations']);
  const names = Object.keys(TOOLSETS);
  assert.equal(names.indexOf('simulation'), names.indexOf('badges') + 1);
  assert.equal(names.at(-1), 'api');
  assert.match(DEFAULT_INSTRUCTIONS, /list_simulation_assignments/);
  assert.match(DEFAULT_INSTRUCTIONS, /Teamso web app \(\/dashboard\/simulation\)/);
  await withMcp(ROUTES, async ({ tools }) => {
    for (const name of TOOLSETS.simulation) {
      const tool = tools.find(item => item.name === name);
      assert.equal(tool.annotations.readOnlyHint, true, name);
      assert.equal(tool.annotations.destructiveHint, false, name);
    }
  });
});

test('list_simulation_assignments lists the open ones by due date, with attempts left', async () => {
  await withMcp(ROUTES, async ({ call }) => {
    const result = await call('list_simulation_assignments');
    assert.notEqual(result.isError, true, textOf(result));
    const { assignments, total, includeClosed, practiceUrl } = result.structuredContent;
    assert.equal(includeClosed, false);
    assert.equal(practiceUrl, 'https://teamso.com/dashboard/simulation');
    assert.deepEqual(assignments.map(item => item.assignmentUserId), ['au-2', 'au-1', 'au-4']);
    assert.equal(total, 3);
    assert.deepEqual(assignments[1], {
      assignmentUserId: 'au-1',
      assignmentId: 'as-1',
      contentType: 'SCENARIO',
      scenarioId: 'sc-angry',
      title: 'Kızgın müşteri: geciken kargo',
      dueDate: '2026-11-20',
      status: 'NOT_STARTED',
      overdue: false,
      attempts: 0,
      maxAttempts: 3,
      attemptsLeft: 3,
      passScore: 70,
      examMode: false,
      allowedModes: 'BOTH',
      difficulty: 'MEDIUM',
      note: 'Bu hafta bitirelim',
    });
    // maxAttempts 0 is unlimited: no attemptsLeft
    assert.equal(assignments[0].maxAttempts, 0);
    assert.equal(assignments[0].attemptsLeft, undefined);
    assert.equal(assignments[0].trackId, 'tr-1');
    const text = textOf(result);
    assert.match(text, /Satış yolu \(exam\) \| 2026-11-05 \| IN_PROGRESS \(overdue\) \| 55 \| 2 \|/);
    assert.match(text, /\| 0 of 3 \|/);
    assert.match(text, /Teamso web app: https:\/\/teamso\.com\/dashboard\/simulation/);
    assert.doesNotMatch(text, /Kapanmış|İptal/);
  });
});

test('list_simulation_assignments include_closed adds closed ones; an empty open list says how many are closed', async () => {
  await withMcp(ROUTES, async ({ call }) => {
    const result = await call('list_simulation_assignments', { include_closed: true });
    assert.equal(result.structuredContent.total, 5);
    assert.equal(result.structuredContent.includeClosed, true);
    assert.match(textOf(result), /Kapanmış/);
  });
  const closedOnly = [['GET /simulation/assignments/mine', () => envelope([ASSIGNMENTS[2], ASSIGNMENTS[4]])]];
  await withMcp(closedOnly, async ({ call }) => {
    const result = await call('list_simulation_assignments');
    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent.total, 0);
    assert.match(textOf(result), /no open AI Simulation assignments \(2 closed; `include_closed: true` lists them\)/);
  });
});

test('get_simulation_results lists the caller\'s own attempts, pages from 1, and points to the first scored one', async () => {
  await withMcp(ROUTES, async ({ call, calls }) => {
    const result = await call('get_simulation_results', { status: 'SCORED', scenario_id: 'sc-angry', page: 2, limit: 10 });
    assert.notEqual(result.isError, true, textOf(result));
    assert.deepEqual(callsTo(calls, 'GET', '/simulation/attempts/mine')[0].query, {
      page: '1', size: '10', status: 'SCORED', scenarioId: 'sc-angry',
    });
    const { scope, attempts, nextAction } = result.structuredContent;
    assert.equal(scope, 'mine');
    assert.deepEqual(attempts[0], {
      id: 'at-1',
      scenarioId: 'sc-angry',
      scenarioTitle: 'Kızgın müşteri: geciken kargo',
      mode: 'TEXT',
      difficulty: 'MEDIUM',
      kind: 'PRACTICE',
      status: 'SCORED',
      totalScore: 78,
      passed: true,
      startedAt: '2026-11-02 12:15',
      durationSec: 380,
      reviewState: 'NONE',
      overridden: false,
    });
    assert.equal(attempts[1].passed, undefined);
    assert.equal(attempts[1].startedAt, '2026-11-02 00:30');
    assert.deepEqual(nextAction, {
      tool: 'get_simulation_results',
      arguments: { attempt_id: 'at-1' },
      reason: 'Score, criteria and feedback of one attempt.',
    });
    assert.match(textOf(result), /\| 2026-11-02 12:15 \| Kızgın müşteri: geciken kargo \| TEXT \| MEDIUM \| SCORED \| 78 \| passed \| `at-1` \|/);
  });
});

test('get_simulation_results scope team sends the filters and shows the person', async () => {
  await withMcp(ROUTES, async ({ call, calls }) => {
    const result = await call('get_simulation_results', {
      scope: 'team', from: '2026-10-01', to: '2026-10-31', user_id: 'u-2', mode: 'VOICE', result: 'FAILED',
    });
    assert.notEqual(result.isError, true, textOf(result));
    assert.deepEqual(callsTo(calls, 'GET', '/simulation/attempts')[0].query, {
      from: '2026-10-01', to: '2026-10-31', userId: 'u-2', mode: 'VOICE', result: 'FAILED', page: '0', size: '20',
    });
    assert.equal(result.structuredContent.scope, 'team');
    assert.equal(result.structuredContent.total, 41);
    assert.equal(result.structuredContent.attempts[0].userName, 'Can Öztürk');
    assert.match(textOf(result), /\| Can Öztürk \|.*\| failed \|/);
    assert.match(textOf(result), /Page 1 of 3 \(41 attempts\)/);
  });
});

test('get_simulation_results checks the filters before calling', async () => {
  await withMcp(ROUTES, async ({ call, calls }) => {
    const mine = await call('get_simulation_results', { from: '2026-10-01', result: 'PASSED' });
    assert.equal(mine.isError, true);
    assert.match(textOf(mine), /`from`, `result` work with `scope: "team"` only/);
    const status = await call('get_simulation_results', { scope: 'team', status: 'SCORED' });
    assert.equal(status.isError, true);
    assert.match(textOf(status), /`status` works for your own attempts only/);
    const reversed = await call('get_simulation_results', { scope: 'team', from: '2026-10-31', to: '2026-10-01' });
    assert.equal(reversed.isError, true);
    assert.match(textOf(reversed), /is after `to`/);
    const badDay = await call('get_simulation_results', { scope: 'team', from: '2026-02-30' });
    assert.equal(badDay.isError, true);
    assert.match(textOf(badDay), /not a real calendar date/);
    assert.equal(calls.filter(item => item.path.startsWith('/simulation')).length, 0);
  });
});

test('get_simulation_results attempt_id returns the score and feedback, never the transcript', async () => {
  await withMcp(ROUTES, async ({ call }) => {
    const result = await call('get_simulation_results', { attempt_id: 'at-1' });
    assert.notEqual(result.isError, true, textOf(result));
    assert.equal(result.structuredContent.scope, 'attempt');
    assert.deepEqual(result.structuredContent.result, {
      attemptId: 'at-1',
      scenarioTitle: 'Kızgın müşteri: geciken kargo',
      userName: 'Ayşe Yılmaz',
      mode: 'TEXT',
      difficulty: 'MEDIUM',
      startedAt: '2026-11-02 12:15',
      durationSec: 380,
      totalScore: 78,
      passScore: 70,
      passed: true,
      outcome: 'SUCCESS',
      criticalFailed: false,
      criteria: [{
        key: 'empathy',
        name: 'Empati',
        skillTag: 'EMPATHY',
        weight: 30,
        level: 3,
        score: 75,
        rationale: 'Müşterinin hissini adıyla karşıladı.',
        evidence: [{ turn: 2, quote: 'Beklemenin ne kadar can sıkıcı olduğunu anlıyorum.' }],
        overridden: false,
      }, {
        key: 'solution',
        name: 'Çözüm önerisi',
        skillTag: 'PROBLEM_SOLVING',
        weight: 40,
        level: 4,
        score: 90,
        evidence: [],
        overridden: true,
      }],
      strengths: ['Sakin ton'],
      priorities: ['Somut bir tarih ver'],
      betterReplies: [{ turn: 4, text: 'Kargonuz yarın 12:00\'ye kadar elinizde olacak.' }],
      nextPracticeSkill: 'NEGOTIATION',
    });
    const everything = JSON.stringify(result);
    assert.doesNotMatch(everything, /turns/);
    assert.ok(!everything.includes(TRANSCRIPT_LINE), 'the transcript must not leave the API');
    const text = textOf(result);
    assert.match(text, /^## Kızgın müşteri: geciken kargo, Ayşe Yılmaz/);
    assert.match(text, /Duration: 6 min 20 s/);
    assert.match(text, /Score: 78 \(pass score 70\), passed\./);
    assert.match(text, /\| Çözüm önerisi \(reviewed\) \| PROBLEM_SOLVING \| 40 \| 4 \| 90 \|/);
    assert.match(text, /- Turn 4: Kargonuz yarın/);
    assert.match(text, /Next skill to practise: NEGOTIATION/);
  });
  const pending = [['GET /simulation/attempts/at-2/result', () => envelope({ criticalFailed: true, criteria: [], attempt: { id: 'at-2' } })]];
  await withMcp(pending, async ({ call }) => {
    const result = await call('get_simulation_results', { attempt_id: 'at-2' });
    assert.notEqual(result.isError, true, textOf(result));
    assert.match(textOf(result), /no score yet/);
    assert.match(textOf(result), /critical criterion failed/);
  });
});

test('list_simulations flattens the shelves, one entry per scenario with its shelves, and sends the filters', async () => {
  await withMcp(ROUTES, async ({ call, calls }) => {
    const result = await call('list_simulations', { query: 'kargo', sector: 'RETAIL', mode: 'TEXT', difficulty: 'MEDIUM', language: 'tr' });
    assert.notEqual(result.isError, true, textOf(result));
    assert.deepEqual(callsTo(calls, 'GET', '/simulation/catalog')[0].query, {
      query: 'kargo', sector: 'RETAIL', mode: 'TEXT', difficulty: 'MEDIUM', language: 'tr',
    });
    const { simulations, total, shelves } = result.structuredContent;
    assert.equal(total, 3);
    assert.deepEqual(simulations.map(item => [item.scenarioId, item.shelves]), [
      ['sc-angry', ['ASSIGNED', 'RETAIL']],
      ['sc-upsell', ['RETAIL', 'NEW']],
      ['sc-bank', ['NEW']],
    ]);
    assert.deepEqual(shelves, [{ key: 'ASSIGNED', count: 1 }, { key: 'RETAIL', count: 2 }, { key: 'NEW', count: 2 }]);
    assert.deepEqual(simulations[0], {
      scenarioId: 'sc-angry',
      title: 'Senaryo sc-angry',
      description: 'Açıklama',
      sector: 'RETAIL',
      language: 'tr',
      direction: 'INBOUND',
      modes: ['TEXT', 'VOICE'],
      difficulties: ['EASY', 'MEDIUM'],
      estMinutes: 8,
      persona: { name: 'Mehmet', age: 45, occupation: 'Esnaf', city: 'İzmir' },
      myBestScore: 78,
      myAttempts: 2,
      assignment: { assignmentUserId: 'au-1', dueDate: '2026-11-20', status: 'IN_PROGRESS', overdue: false },
      shelves: ['ASSIGNED', 'RETAIL'],
    });
    assert.deepEqual(simulations[1].modes, ['TEXT']);
    assert.equal(simulations[1].persona, undefined);
    assert.equal(simulations[1].assignment, null);
    assert.match(textOf(result), /\| Senaryo sc-angry \| `sc-angry` \| RETAIL \| TEXT, VOICE \| EASY, MEDIUM \| 8 \| 78 \| due 2026-11-20 \|/);
  });
  await withMcp(ROUTES, async ({ call }) => {
    const result = await call('list_simulations', { limit: 1 });
    assert.equal(result.structuredContent.simulations.length, 1);
    assert.equal(result.structuredContent.total, 3);
    assert.match(textOf(result), /Showing 1 of 3/);
  });
  await withMcp([['GET /simulation/catalog', () => envelope({ shelves: [] })]], async ({ call }) => {
    const result = await call('list_simulations', { sector: 'BANKING' });
    assert.notEqual(result.isError, true);
    assert.match(textOf(result), /No AI Simulation scenario matches these filters/);
  });
});

test('simulation tools explain the API refusals (module off, not found, forbidden)', async () => {
  const cases = [
    ['list_simulations', {}, 'GET /simulation/catalog', hardFailure('MODULE_DISABLED', 'PERMISSION_DENIED', 403), /AI Simulation is not enabled for your company/],
    ['list_simulation_assignments', {}, 'GET /simulation/assignments/mine', hardFailure('MODULE_DISABLED', 'INVALID_DATA', 400), /package has not been bought/],
    ['get_simulation_results', { attempt_id: 'at-9' }, 'GET /simulation/attempts/at-9/result', hardFailure('SIMULATION_NOT_FOUND', 'ITEM_NOT_FOUND', 404), /could not find that simulation or attempt in your company/],
    ['get_simulation_results', { attempt_id: 'at-9' }, 'GET /simulation/attempts/at-9/result', hardFailure('SIMULATION_FORBIDDEN', 'PERMISSION_DENIED', 403), /managers the results of their team/],
    ['get_simulation_results', { scope: 'team' }, 'GET /simulation/attempts', json({ code: 0, message: 'ACCESS_DENIED', message_code: 'ACCESS_DENIED' }, 403), /Team results \(`scope: "team"`\) are for managers/],
  ];
  for (const [tool, args, route, response, pattern] of cases) {
    await withMcp([[route, () => response]], async ({ call }) => {
      const result = await call(tool, args);
      assert.equal(result.isError, true, tool);
      assert.match(textOf(result), pattern);
    });
  }
});
