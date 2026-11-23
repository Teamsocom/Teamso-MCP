import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_INSTRUCTIONS, TOOLSETS } from '../dist/server.js';
import { envelope, json, textOf, withMcp } from './helpers.mjs';

// TMS-5065: add_goal_progress, "hedefime ilerleme ekle"

/** HTTP 400 refusal of the Refused-style services: the code in `message`. */
function refused(code) {
  return json({ code: 0, message: code, message_code: 'INVALID_INPUT_PARAMETERS' }, 400);
}

function card(overrides = {}) {
  return {
    goalId: 'g-1',
    goalName: 'Yeni müşteri kazanımı',
    userId: 'u-1',
    periodName: 'Q4 2026',
    scaleCriterion: 'QUANTITY',
    isOther: false,
    targetValue: 40,
    open: true,
    canAddProgress: true,
    closedReason: null,
    elapsedPercent: 40,
    lastProgressValue: 12,
    lastProgressPercent: 30,
    lastProgressStatus: 'ON_TRACK',
    lastProgressAt: '2026-11-01T09:00:00Z',
    entries: [{ id: 'p-1', value: 12, percent: 30, status: 'ON_TRACK', comment: 'Ekim', createdAt: '2026-11-01T09:00:00Z', createdByName: 'Ayşe Kaya' }],
    ...overrides,
  };
}

const posts = calls => calls.filter(call => call.method === 'POST' && call.path === '/user-goal-progress/goal/g-1');

test('add_goal_progress is a performance write with confirm', async () => {
  assert.ok(TOOLSETS.performance.includes('add_goal_progress'));
  assert.match(DEFAULT_INSTRUCTIONS, /add_goal_progress/);
  await withMcp([], async ({ tools }) => {
    const tool = tools.find(t => t.name === 'add_goal_progress');
    assert.equal(tool.annotations.readOnlyHint, false);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.deepEqual(tool.inputSchema.required.sort(), ['goal_id', 'status']);
    assert.match(tool.description, /hedefime ilerleme ekle/);
  });
});

test('add_goal_progress previews first and saves only with confirm', async () => {
  const routes = [
    ['GET /user-goal-progress/goal/g-1', () => envelope(card())],
    ['POST /user-goal-progress/goal/g-1', call => envelope(card({
      lastProgressValue: call.body.value,
      lastProgressPercent: 45,
      lastProgressStatus: call.body.status,
      entries: [{ id: 'p-2', value: call.body.value, percent: 45, status: call.body.status, comment: call.body.comment, createdByName: 'Ayşe Kaya' }, ...card().entries],
    }), 'INSERT_SUCCESS')],
  ];
  await withMcp(routes, async ({ call, calls }) => {
    const preview = await call('add_goal_progress', { goal_id: 'g-1', value: 18, status: 'AT_RISK', comment: 'Fuar ertelendi' });
    assert.notEqual(preview.isError, true, textOf(preview));
    assert.equal(preview.structuredContent.saved, false);
    assert.equal(preview.structuredContent.progress.percent, 45);
    assert.equal(preview.structuredContent.target, 40);
    assert.deepEqual(preview.structuredContent.nextAction.arguments, {
      goal_id: 'g-1', status: 'AT_RISK', value: 18, comment: 'Fuar ertelendi', confirm: true,
    });
    assert.match(textOf(preview), /Nothing was saved/);
    assert.equal(posts(calls).length, 0);

    const saved = await call('add_goal_progress', { goal_id: 'g-1', value: 18, status: 'AT_RISK', comment: 'Fuar ertelendi', confirm: true });
    assert.notEqual(saved.isError, true, textOf(saved));
    assert.equal(saved.structuredContent.saved, true);
    const [post] = posts(calls);
    assert.deepEqual(post.body, { value: 18, status: 'AT_RISK', comment: 'Fuar ertelendi', withFile: false });
    assert.equal(saved.structuredContent.history.length, 2);
    assert.match(textOf(saved), /goals at risk/);
  });
});

test('add_goal_progress takes a percent for OTHER goals and checks the shape', async () => {
  const other = card({ isOther: true, scaleCriterion: 'OTHER', targetValue: null, entries: [] });
  await withMcp([
    ['GET /user-goal-progress/goal/g-1', () => envelope(other)],
    ['POST /user-goal-progress/goal/g-1', () => envelope({ ...other, entries: [{ id: 'p-3', percent: 60, status: 'ON_TRACK' }] }, 'INSERT_SUCCESS')],
  ], async ({ call, calls }) => {
    const wrong = await call('add_goal_progress', { goal_id: 'g-1', value: 5, status: 'ON_TRACK' });
    assert.equal(wrong.isError, true);
    assert.match(textOf(wrong), /OTHER/);
    const ok = await call('add_goal_progress', { goal_id: 'g-1', percent: 60, status: 'ON_TRACK', confirm: true });
    assert.notEqual(ok.isError, true, textOf(ok));
    assert.deepEqual(posts(calls)[0].body, { percent: 60, status: 'ON_TRACK', withFile: false });
    assert.equal(ok.structuredContent.progress.percent, 60);
  });
  await withMcp([['GET /user-goal-progress/goal/g-1', () => envelope(card())]], async ({ call }) => {
    const missing = await call('add_goal_progress', { goal_id: 'g-1', status: 'ON_TRACK' });
    assert.equal(missing.isError, true);
    assert.match(textOf(missing), /numeric goal/);
  });
});

test('add_goal_progress explains a closed goal and API refusals', async () => {
  await withMcp([['GET /user-goal-progress/goal/g-1', () => envelope(card({ canAddProgress: false, open: false, closedReason: 'PERIOD_NOT_ACTIVE' }))]], async ({ call, calls }) => {
    const result = await call('add_goal_progress', { goal_id: 'g-1', value: 1, status: 'ON_TRACK', confirm: true });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /period is not running/);
    assert.equal(posts(calls).length, 0);
  });
  await withMcp([['GET /user-goal-progress/goal/g-1', () => envelope(card({ canAddProgress: false, open: true }))]], async ({ call }) => {
    const result = await call('add_goal_progress', { goal_id: 'g-1', value: 1, status: 'ON_TRACK' });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /owner, their direct manager or a performance admin/);
  });
  await withMcp([
    ['GET /user-goal-progress/goal/g-1', () => envelope(card())],
    ['POST /user-goal-progress/goal/g-1', () => refused('GOAL_NOT_OPEN')],
  ], async ({ call }) => {
    const result = await call('add_goal_progress', { goal_id: 'g-1', value: 1, status: 'LATE', confirm: true });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /approved and until its actual value/);
  });
});
