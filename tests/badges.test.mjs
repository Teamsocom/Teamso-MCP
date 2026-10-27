import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_INSTRUCTIONS, TOOLSETS } from '../dist/server.js';
import { callsTo, envelope, hardFailure, json, textOf, withMcp } from './helpers.mjs';

const TEAM_PLAYER = {
  id: 'b-team',
  code: null,
  name: 'Takım Oyuncusu',
  description: 'Ekip çalışmasına katkı',
  category: 'TEAMWORK',
  iconKey: 'users',
  colorToken: 'ts-color-primary-600',
  tier: 'NONE',
  points: null,
  awardMode: 'MANUAL',
  givers: ['ADMINS', 'MANAGERS', 'EVERYONE'],
  requiresApproval: false,
  requireMessage: true,
  defaultVisibility: 'PUBLIC',
  maxPerRecipient: null,
  cooldownDays: 30,
};
const IDEA = { ...TEAM_PLAYER, id: 'b-idea', name: 'Yenilikçi Fikir', category: 'VALUES', requireMessage: false, requiresApproval: true };

const awardable = (overrides = {}) => envelope({
  role: 'ADMIN',
  canAward: true,
  managerCanAward: true,
  teamSize: 0,
  remainingQuota: null,
  peerEnabled: false,
  peerQuota: null,
  badges: [TEAM_PLAYER, IDEA],
  goalPeriods: [],
  ...overrides,
});

const given = (body, overrides = {}) => envelope({
  badgeId: body.badgeId,
  badgeName: body.badgeId === 'b-team' ? 'Takım Oyuncusu' : 'Yenilikçi Fikir',
  status: 'ACTIVE',
  pendingApproval: false,
  source: 'MANUAL',
  peerQuota: null,
  awardedCount: body.recipientUserIds.length,
  failedCount: 0,
  awarded: body.recipientUserIds.map((userId, index) => ({ userId, fullName: `Kişi ${index + 1}`, awardId: `a-${index + 1}` })),
  failed: [],
  ...overrides,
}, 'INSERT_SUCCESS', { message: 'Badge given' });

const ROUTES = [
  ['GET /badge-award/awardable', () => awardable()],
  ['POST /badge-award', call => given(call.body)],
  ['GET /badge-award/my', call => envelope({
    items: [{
      id: 'a-9',
      badge: TEAM_PLAYER,
      recipient: { id: 'u-1', fullName: 'Ayşe Yılmaz' },
      giver: { id: 'u-9', fullName: 'Mehmet Demir' },
      source: 'MANAGER',
      message: 'Sprint boyunca harika destek',
      visibility: 'PUBLIC',
      status: 'ACTIVE',
      points: null,
      createdAt: '2026-10-20T14:05:00',
    }, {
      id: 'a-8',
      badge: { ...TEAM_PLAYER, id: 'b-year', name: '1. Yıl', category: 'MILESTONE' },
      giver: null,
      source: 'RULE',
      visibility: 'PUBLIC',
      status: 'ACTIVE',
      createdAt: '2026-09-01T09:00:00.123456',
    }],
    total: 2,
    page: Number(call.query.page),
    size: Number(call.query.size),
    totalAwards: 2,
    distinctBadges: 2,
    totalPoints: null,
    showPoints: false,
  })],
];

test('badge tools are their own toolset, in TOOL_NAMES order, and the instructions name the flow', () => {
  assert.deepEqual([...TOOLSETS.badges], ['list_badges', 'give_badge', 'list_my_badges']);
  assert.match(DEFAULT_INSTRUCTIONS, /list_badges/);
  assert.match(DEFAULT_INSTRUCTIONS, /give_badge/);
});

test('list_badges lists what the caller can give, filtered by name without Turkish characters', async () => {
  await withMcp(ROUTES, async ({ call, tools }) => {
    const annotations = Object.fromEntries(tools.map(tool => [tool.name, tool.annotations]));
    assert.equal(annotations.list_badges.readOnlyHint, true);
    assert.equal(annotations.list_my_badges.readOnlyHint, true);
    assert.equal(annotations.give_badge.readOnlyHint, false);
    assert.equal(annotations.give_badge.destructiveHint, false);

    const all = await call('list_badges');
    assert.notEqual(all.isError, true, textOf(all));
    assert.equal(all.structuredContent.role, 'ADMIN');
    assert.equal(all.structuredContent.total, 2);
    assert.deepEqual(all.structuredContent.badges[0], {
      id: 'b-team',
      name: 'Takım Oyuncusu',
      description: 'Ekip çalışmasına katkı',
      category: 'TEAMWORK',
      tier: 'NONE',
      givers: ['ADMINS', 'MANAGERS', 'EVERYONE'],
      requiresApproval: false,
      requireMessage: true,
      defaultVisibility: 'PUBLIC',
      cooldownDays: 30,
    });
    assert.equal(all.structuredContent.nextAction.tool, 'give_badge');

    const filtered = await call('list_badges', { query: 'takim' });
    assert.deepEqual(filtered.structuredContent.badges.map(badge => badge.id), ['b-team']);
  });
});

test('list_badges shows the peer quota and explains an empty list', async () => {
  const peer = [['GET /badge-award/awardable', () => awardable({
    role: 'PEER',
    peerEnabled: true,
    peerQuota: { monthlyQuota: 5, used: 2, remaining: 3, resetsOn: '2026-11-01', daysUntilReset: 5 },
    badges: [TEAM_PLAYER],
  })]];
  await withMcp(peer, async ({ call }) => {
    const result = await call('list_badges');
    assert.deepEqual(result.structuredContent.peerQuota, { monthlyQuota: 5, used: 2, remaining: 3, resetsOn: '2026-11-01' });
    assert.match(textOf(result), /3 of 5 left/);
  });
  await withMcp([['GET /badge-award/awardable', () => awardable({ role: 'NONE', canAward: false, badges: [] })]], async ({ call }) => {
    const result = await call('list_badges');
    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent.canAward, false);
    assert.match(textOf(result), /cannot give any badge/);
  });
});

test('give_badge resolves the badge by name and posts the web app\'s body (no source: the API decides it)', async () => {
  await withMcp(ROUTES, async ({ call, calls }) => {
    const result = await call('give_badge', {
      badge: 'takım oyuncusu',
      recipient_ids: ['u-2', 'u-3', 'u-2'],
      message: 'Projede harika iş birliği için teşekkürler',
      visibility: 'PUBLIC',
    });
    assert.notEqual(result.isError, true, textOf(result));
    const [post] = callsTo(calls, 'POST', '/badge-award');
    assert.deepEqual(post.body, {
      badgeId: 'b-team',
      recipientUserIds: ['u-2', 'u-3'],
      message: 'Projede harika iş birliği için teşekkürler',
      visibility: 'PUBLIC',
    });
    assert.equal(post.body.sourceType, undefined);
    assert.equal(result.structuredContent.awarded.length, 2);
    assert.equal(result.structuredContent.badge.name, 'Takım Oyuncusu');
    assert.match(result.structuredContent.message, /given to 2 person/);
  });
});

test('give_badge lists the people who did not get it, with the reason and the date it is possible again', async () => {
  const partly = [['POST /badge-award', call => given(call.body, {
    awardedCount: 1,
    failedCount: 2,
    awarded: [{ userId: 'u-2', fullName: 'Can Öztürk', awardId: 'a-1' }],
    failed: [
      { userId: 'u-3', fullName: 'Şule Kaya', code: 'COOLDOWN', availableOn: '2026-11-20' },
      { userId: 'u-4', fullName: 'Eski Çalışan', code: 'RECIPIENT_INACTIVE' },
    ],
  })]];
  await withMcp([...partly, ...ROUTES], async ({ call }) => {
    const result = await call('give_badge', { badge: 'b-team', recipient_ids: ['u-2', 'u-3', 'u-4'], message: 'Harika bir çeyrek geçirdin' });
    assert.notEqual(result.isError, true, textOf(result));
    assert.deepEqual(result.structuredContent.failed[0], {
      userId: 'u-3',
      fullName: 'Şule Kaya',
      code: 'COOLDOWN',
      reason: 'got this badge recently; the waiting days have not passed',
      availableOn: '2026-11-20',
    });
    assert.match(textOf(result), /possible again on 2026-11-20/);
    assert.match(textOf(result), /no longer an active employee/);
  });
});

test('give_badge: an approval badge waits; nobody given is an error with the reasons', async () => {
  const pending = [['POST /badge-award', call => given(call.body, { status: 'PENDING_APPROVAL', pendingApproval: true, source: 'MANAGER' })]];
  await withMcp([...pending, ...ROUTES], async ({ call }) => {
    const result = await call('give_badge', { badge: 'Yenilikçi Fikir', recipient_ids: ['u-2'] });
    assert.notEqual(result.isError, true, textOf(result));
    assert.equal(result.structuredContent.pendingApproval, true);
    assert.match(textOf(result), /waits for a badge admin's approval/);
  });
  const none = [['POST /badge-award', () => json({
    code: 0,
    message: 'BADGE_AWARD_NONE_GIVEN',
    message_code: 'INVALID_DATA',
    result: {
      badgeId: 'b-team', status: 'ACTIVE', pendingApproval: false, source: 'MANUAL', awardedCount: 0, failedCount: 1,
      awarded: [], failed: [{ userId: 'u-2', fullName: 'Can Öztürk', code: 'LIMIT_REACHED', limit: 1 }],
    },
  }, 400)]];
  await withMcp([...none, ...ROUTES], async ({ call }) => {
    const result = await call('give_badge', { badge: 'b-team', recipient_ids: ['u-2'], message: 'Tekrar tebrikler!' });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /Nobody got "Takım Oyuncusu"/);
    assert.match(textOf(result), /Can Öztürk.*as many times as allowed/);
  });
});

test('give_badge checks the message and the peer rule before calling, and refuses badges the caller cannot give', async () => {
  await withMcp(ROUTES, async ({ call, calls }) => {
    const short = await call('give_badge', { badge: 'b-team', recipient_ids: ['u-2'], message: 'kısa' });
    assert.equal(short.isError, true);
    assert.match(textOf(short), /at least 10 characters/);
    const unknown = await call('give_badge', { badge: 'Süper Yıldız', recipient_ids: ['u-2'], message: 'Harika bir iş çıkardın' });
    assert.equal(unknown.isError, true);
    assert.match(textOf(unknown), /Badges you can give: "Takım Oyuncusu", "Yenilikçi Fikir"/);
    assert.equal(callsTo(calls, 'POST', '/badge-award').length, 0);
  });
  const peer = [['GET /badge-award/awardable', () => awardable({ role: 'PEER', badges: [IDEA] })]];
  await withMcp([...peer, ...ROUTES], async ({ call, calls }) => {
    const two = await call('give_badge', { badge: 'b-idea', recipient_ids: ['u-2', 'u-3'], message: 'Harika fikirler için' });
    assert.equal(two.isError, true);
    assert.match(textOf(two), /exactly one colleague/);
    const noMessage = await call('give_badge', { badge: 'b-idea', recipient_ids: ['u-2'] });
    assert.equal(noMessage.isError, true);
    assert.equal(callsTo(calls, 'POST', '/badge-award').length, 0);
  });
});

test('give_badge explains the API refusals (team, quota, module off)', async () => {
  const cases = [
    [hardFailure('BADGE_AWARD_RECIPIENT_NOT_IN_TEAM', 'PERMISSION_DENIED', 403), /only to your direct reports/],
    [json({ code: 0, message: 'BADGE_AWARD_PEER_QUOTA_EXHAUSTED', message_code: 'ITEM_EXIST', result: { monthlyQuota: 5, used: 5, remaining: 0 } }, 409), /peer recognition quota/],
    [hardFailure('BADGE_AWARD_NOT_ALLOWED', 'PERMISSION_DENIED', 403), /badge admins give every badge/],
  ];
  for (const [response, pattern] of cases) {
    await withMcp([['POST /badge-award', () => response], ...ROUTES], async ({ call }) => {
      const result = await call('give_badge', { badge: 'b-team', recipient_ids: ['u-2'], message: 'Harika bir iş çıkardın' });
      assert.equal(result.isError, true);
      assert.match(textOf(result), pattern);
    });
  }
});

test('list_my_badges lists received badges with the giver, Teamso for automatic ones, and pages by limit', async () => {
  await withMcp(ROUTES, async ({ call, calls }) => {
    const result = await call('list_my_badges', { limit: 5 });
    assert.notEqual(result.isError, true, textOf(result));
    assert.deepEqual(callsTo(calls, 'GET', '/badge-award/my')[0].query, { page: '0', size: '5' });
    assert.equal(result.structuredContent.totalAwards, 2);
    assert.equal(result.structuredContent.distinctBadges, 2);
    assert.equal(result.structuredContent.totalPoints, undefined);
    assert.deepEqual(result.structuredContent.awards[0], {
      id: 'a-9',
      badge: { id: 'b-team', name: 'Takım Oyuncusu', category: 'TEAMWORK', tier: 'NONE' },
      givenBy: { id: 'u-9', fullName: 'Mehmet Demir' },
      source: 'MANAGER',
      message: 'Sprint boyunca harika destek',
      visibility: 'PUBLIC',
      awardedAt: '2026-10-20 14:05',
    });
    assert.equal(result.structuredContent.awards[1].givenBy, null);
    assert.equal(result.structuredContent.awards[1].awardedAt, '2026-09-01 09:00');
    assert.match(textOf(result), /\| 1\. Yıl \| Teamso \|/);
  });
  await withMcp([['GET /badge-award/my', () => envelope({ items: [], total: 0, totalAwards: 0, distinctBadges: 0, showPoints: true, totalPoints: 0 })]], async ({ call }) => {
    const result = await call('list_my_badges');
    assert.match(textOf(result), /not received a badge yet/);
    assert.equal(result.structuredContent.totalPoints, 0);
  });
});
