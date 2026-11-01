import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TeamsoApiError, type TeamsoClient } from '../client.js';
import type {
  TeamsoBadgeAward,
  TeamsoBadgeAwardRecipient,
  TeamsoBadgeAwardResult,
  TeamsoBadgeOption,
  TeamsoBadgePeerQuota,
} from '../types.js';
import { formatWallClock, toDisplayDateTime, toIsoDay } from '../utils/dates.js';
import { markdownTable } from '../utils/format.js';
import {
  ToolInputError,
  apiErrorResult,
  errorResult,
  toolResult,
  type ApiErrorHints,
} from '../utils/results.js';
import { compact, optionalNumber, optionalString } from '../utils/structured.js';
import { normalizeSearchText } from '../utils/text.js';
import { badgeGivenOutputSchema, badgeListOutputSchema, myBadgesOutputSchema } from './schemas.js';
import { ADDITIVE_WRITE, READ_ONLY, idSchema } from './shared.js';

/** Shortest message the API accepts when the badge asks for one (`BadgeConstants.MESSAGE_MIN`). */
const MESSAGE_MIN = 10;
/** Longest message (`BadgeConstants.MESSAGE_MAX`). */
const MESSAGE_MAX = 500;
/** One call of this tool; the web gives to at most 500 people at once. */
const RECIPIENTS_MAX = 50;

/** Why a person did not get the badge (per-person codes of `POST /badge-award`). */
const RECIPIENT_REASONS: Record<string, string> = {
  SELF: 'nobody can give a badge to themselves',
  RECIPIENT_NOT_FOUND: 'not an employee of your company',
  RECIPIENT_INACTIVE: 'no longer an active employee',
  LIMIT_REACHED: 'already has this badge as many times as allowed',
  COOLDOWN: 'got this badge recently; the waiting days have not passed',
  OTHER_DEPARTMENT: 'peers can only recognise their own department',
  ALREADY_AWARDED: 'already got this badge for the same reference',
};

const BADGE_HINTS: ApiErrorHints = {
  byCode: {
    BADGE_NOT_FOUND: 'No such badge in your company. Use `list_badges` to see the badges you can give.',
    BADGE_AWARD_BADGE_NOT_AWARDABLE: 'This badge is archived or only an automatic rule gives it.',
    BADGE_AWARD_NOT_ALLOWED: 'You cannot give this badge: badge admins give every badge, managers give the '
      + 'badges open to managers to their direct reports, and colleagues give the badges open to everyone while '
      + 'peer recognition is on.',
    BADGE_AWARD_RECIPIENT_NOT_IN_TEAM: 'As a manager you can give this badge only to your direct reports; nothing '
      + 'was given. Remove the people outside your team.',
    BADGE_AWARD_PEER_ONE_RECIPIENT: 'A peer recognition goes to exactly one colleague. Give one person at a time.',
    BADGE_AWARD_PEER_QUOTA_EXHAUSTED: 'You have used this month\'s peer recognition quota. It resets on the first '
      + 'day of next month.',
    BADGE_AWARD_PEER_DISABLED: 'Peer recognition is off in your company.',
    BADGE_AWARD_MESSAGE_REQUIRED: `This badge needs a message (at least ${MESSAGE_MIN} characters).`,
    BADGE_AWARD_MESSAGE_TOO_SHORT: `The message must be at least ${MESSAGE_MIN} characters.`,
    BADGE_AWARD_MESSAGE_TOO_LONG: `The message can be at most ${MESSAGE_MAX} characters.`,
    BADGE_AWARD_TOO_MANY_RECIPIENTS: 'Too many people in one call.',
    BADGE_SUPPORT_SESSION_READ_ONLY: 'Badges cannot be given inside a support session.',
    MODULE_DISABLED: 'Badges are switched off for your company (Settings > Modules).',
  },
  forbidden: 'Badges need the performance module with its Badges feature, and the right to give the badge.',
  notFound: 'Teamso could not find that badge, or it is not visible to you.',
};

function quotaOf(quota: TeamsoBadgePeerQuota | null | undefined) {
  if (!quota) return undefined;
  return compact({
    monthlyQuota: quota.monthlyQuota ?? 0,
    used: quota.used ?? 0,
    remaining: quota.remaining ?? 0,
    resetsOn: toIsoDay(quota.resetsOn ?? undefined),
  });
}

function toBadgeOption(badge: TeamsoBadgeOption) {
  return compact({
    id: badge.id,
    name: badge.name,
    description: optionalString(badge.description),
    category: optionalString(badge.category),
    tier: optionalString(badge.tier),
    points: optionalNumber(badge.points),
    givers: Array.isArray(badge.givers) ? badge.givers : [],
    requiresApproval: badge.requiresApproval === true,
    requireMessage: badge.requireMessage === true,
    defaultVisibility: optionalString(badge.defaultVisibility),
    maxPerRecipient: optionalNumber(badge.maxPerRecipient),
    cooldownDays: optionalNumber(badge.cooldownDays),
  });
}

function toRecipient(recipient: TeamsoBadgeAwardRecipient) {
  const code = optionalString(recipient.code);
  return compact({
    userId: recipient.userId,
    fullName: optionalString(recipient.fullName),
    awardId: optionalString(recipient.awardId),
    code,
    reason: code ? RECIPIENT_REASONS[code] ?? code : undefined,
    availableOn: toIsoDay(recipient.availableOn ?? undefined),
  });
}

function toAward(award: TeamsoBadgeAward) {
  const giver = award.giver?.id ? { id: award.giver.id, fullName: optionalString(award.giver.fullName) ?? award.giver.id } : null;
  return compact({
    id: award.id,
    badge: compact({
      id: award.badge?.id ?? '',
      name: award.badge?.name ?? '',
      category: optionalString(award.badge?.category),
      tier: optionalString(award.badge?.tier),
    }),
    givenBy: giver,
    source: optionalString(award.source),
    message: optionalString(award.message),
    visibility: optionalString(award.visibility),
    points: optionalNumber(award.points),
    awardedAt: awardTime(award.createdAt),
  });
}

/**
 * Award time for display, `yyyy-MM-dd HH:mm`. The API sends it already in Turkey time without an offset
 * (`2026-10-27T11:08:17.124576`); instants with an offset are converted by `toDisplayDateTime`.
 */
function awardTime(value: string | null | undefined): string | undefined {
  const wall = typeof value === 'string' ? /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim()) : null;
  return wall ? formatWallClock(wall[1], wall[2]) : toDisplayDateTime(value ?? undefined);
}

function personLabel(person: { userId: string; fullName?: string }): string {
  return person.fullName ? `${person.fullName} (\`${person.userId}\`)` : `\`${person.userId}\``;
}

/** Badge by id or by name (case, accents and dotted/dotless i ignored), among the badges the caller can give. */
function resolveBadge(badges: TeamsoBadgeOption[], wanted: string): TeamsoBadgeOption {
  const byId = badges.find(badge => badge.id === wanted);
  if (byId) return byId;
  const key = normalizeSearchText(wanted);
  const byName = badges.filter(badge => normalizeSearchText(badge.name) === key);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    const ids = byName.map(badge => `\`${badge.id}\``).join(', ');
    throw new ToolInputError(`More than one badge you can give is called "${wanted}" (${ids}). Give it again with the badge id; `
      + '`list_badges` shows which is which.');
  }
  const names = badges.map(badge => `"${badge.name}"`).join(', ');
  throw new ToolInputError(badges.length
    ? `You cannot give a badge called "${wanted}". Badges you can give: ${names}. Use \`list_badges\` for their ids.`
    : 'You cannot give any badge right now (no giving right, or the company has no manual badges).');
}

export function registerListBadges(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_badges',
    {
      title: 'List the badges I can give',
      description: 'List the recognition badges the caller can give now, with the caller\'s giving role '
        + '(`ADMIN` gives to anyone, `MANAGER` to direct reports, `PEER` to one colleague within a monthly quota, '
        + '`NONE`), whether each badge needs a message or an approval, and the peer quota left. Use a badge\'s '
        + '`id` (or its exact name) with `give_badge`.',
      inputSchema: {
        query: z.string().trim().min(1).max(100).optional()
          .describe('Only badges whose name contains these words (Turkish characters optional).'),
      },
      outputSchema: badgeListOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ query }, extra) => {
      try {
        const awardable = await client.getAwardableBadges(extra.signal);
        const all = (awardable?.badges ?? []).map(toBadgeOption);
        const words = query ? normalizeSearchText(query).split(/\s+/).filter(Boolean) : [];
        const badges = words.length
          ? all.filter(badge => words.every(word => normalizeSearchText(badge.name).includes(word)))
          : all;
        const peerQuota = quotaOf(awardable?.peerQuota);
        const structured = compact({
          role: awardable?.role ?? 'NONE',
          canAward: awardable?.canAward === true,
          badges,
          total: badges.length,
          peerQuota,
        });
        if (all.length === 0) {
          return toolResult('You cannot give any badge right now. Badge admins give every badge, managers give '
            + 'the badges open to managers to their team, and colleagues give the badges open to everyone while '
            + 'peer recognition is on.', structured);
        }
        const table = markdownTable(
          ['Badge', 'Id', 'Category', 'Message', 'Approval'],
          badges.map(badge => [
            badge.name,
            `\`${badge.id}\``,
            badge.category,
            badge.requireMessage ? 'required' : 'optional',
            badge.requiresApproval ? 'needed' : 'no',
          ]),
        );
        const quota = peerQuota
          ? `\n\nPeer quota: ${peerQuota.remaining} of ${peerQuota.monthlyQuota} left this month.`
          : '';
        return toolResult(`## Badges you can give (role: ${structured.role})\n\n${table}${quota}`, {
          ...structured,
          ...(badges.length
            ? {
              nextAction: {
                tool: 'give_badge',
                arguments: { badge: badges[0].id, recipient_ids: [] },
                reason: 'Find the people with search_employees, confirm the badge, the people and the message with '
                  + 'the user, then give it.',
              },
            }
            : {}),
        });
      } catch (error) {
        return apiErrorResult(error, BADGE_HINTS);
      }
    },
  );
}

export function registerGiveBadge(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'give_badge',
    {
      title: 'Give a badge',
      description: 'Give a recognition badge to one or more colleagues with a message, with the caller\'s own '
        + 'Teamso rights and limits (the same as the web: who may give what to whom, per-person limit, waiting '
        + 'days, approval, monthly peer quota). Find people with `search_employees` and badges with `list_badges`. '
        + 'Confirm the badge, the people and the message with the user first. People who cannot get the badge are '
        + 'listed with the reason; the others still get it. A badge that needs approval waits for a badge admin.',
      inputSchema: {
        badge: z.string().trim().min(1).max(100)
          .describe('Badge id from `list_badges`, or the badge\'s exact name (e.g. "Takım Oyuncusu").'),
        recipient_ids: z.array(idSchema('Employee id from `search_employees`.')).min(1).max(RECIPIENTS_MAX)
          .describe(`Ids of the people who get the badge (1-${RECIPIENTS_MAX}). A peer recognition goes to one person.`),
        message: z.string().trim().max(MESSAGE_MAX).optional()
          .describe(`Why they get it, shown with the badge (${MESSAGE_MIN}-${MESSAGE_MAX} characters; required `
            + 'when the badge asks for a message and for peer recognition).'),
        visibility: z.enum(['PUBLIC', 'PRIVATE']).optional()
          .describe('`PUBLIC` shows it on the recognition wall, `PRIVATE` only to the person and their manager. '
            + 'Default: the badge\'s own setting.'),
      },
      outputSchema: badgeGivenOutputSchema,
      annotations: ADDITIVE_WRITE,
    },
    async ({ badge: wanted, recipient_ids, message, visibility }, extra) => {
      try {
        const awardable = await client.getAwardableBadges(extra.signal);
        const badge = resolveBadge(awardable?.badges ?? [], wanted);
        const recipients = [...new Set(recipient_ids)];
        const peer = awardable?.role === 'PEER';
        if ((badge.requireMessage || peer) && (!message || message.length < MESSAGE_MIN)) {
          throw new ToolInputError(`"${badge.name}" needs a message of at least ${MESSAGE_MIN} characters. `
            + 'Ask the user why the person gets the badge.');
        }
        if (peer && recipients.length !== 1) {
          throw new ToolInputError('A peer recognition goes to exactly one colleague. Give one person at a time.');
        }

        let result: TeamsoBadgeAwardResult;
        try {
          result = await client.giveBadge({
            badgeId: badge.id,
            recipientUserIds: recipients,
            ...(message ? { message } : {}),
            ...(visibility ? { visibility } : {}),
          }, extra.signal);
        } catch (error) {
          // Nobody got it: the API still lists why, per person
          const none = error instanceof TeamsoApiError && error.apiMessage === 'BADGE_AWARD_NONE_GIVEN'
            ? error.result as TeamsoBadgeAwardResult | undefined
            : undefined;
          if (!none) throw error;
          const failed = (none.failed ?? []).map(toRecipient);
          return errorResult(`Nobody got "${badge.name}":\n\n`
            + failed.map(person => `- ${personLabel(person)}: ${person.reason ?? person.code}`).join('\n'));
        }

        const awarded = (result.awarded ?? []).map(toRecipient);
        const failed = (result.failed ?? []).map(toRecipient);
        const name = optionalString(result.badgeName) ?? badge.name;
        const summary = result.pendingApproval
          ? `"${name}" was given to ${awarded.length} person(s) and waits for a badge admin's approval.`
          : `"${name}" was given to ${awarded.length} person(s).`;
        const lines = [
          ...awarded.map(person => `- ${personLabel(person)}`),
          ...failed.map(person => `- ${personLabel(person)}: not given, ${person.reason ?? person.code}`
            + (person.availableOn ? ` (possible again on ${person.availableOn})` : '')),
        ];
        return toolResult(`## Badge given\n\n${lines.join('\n')}\n\n${summary}`, compact({
          badge: compact({ id: result.badgeId ?? badge.id, name }),
          status: result.status,
          pendingApproval: result.pendingApproval === true,
          source: result.source,
          awarded,
          failed,
          peerQuota: quotaOf(result.peerQuota),
          message: summary,
        }));
      } catch (error) {
        return apiErrorResult(error, BADGE_HINTS);
      }
    },
  );
}

export function registerListMyBadges(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_my_badges',
    {
      title: 'List my badges',
      description: 'List the badges the caller has received (active awards, newest first) with who gave them, '
        + 'the message and the totals. Points appear only when the company shows them.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(20).describe('Maximum awards (1-100, default 20).'),
      },
      outputSchema: myBadgesOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ limit }, extra) => {
      try {
        const page = await client.listMyBadgeAwards({ page: 0, size: limit }, extra.signal);
        const awards = (page?.items ?? []).map(toAward);
        const totalAwards = page?.totalAwards ?? awards.length;
        const structured = compact({
          totalAwards,
          distinctBadges: page?.distinctBadges ?? new Set(awards.map(award => award.badge.id)).size,
          totalPoints: page?.showPoints ? optionalNumber(page?.totalPoints) : undefined,
          awards,
          total: page?.total ?? awards.length,
        });
        if (awards.length === 0) {
          return toolResult('You have not received a badge yet.', structured);
        }
        const table = markdownTable(
          ['Badge', 'Given by', 'Date', 'Message'],
          awards.map(award => [
            award.badge.name,
            award.givenBy?.fullName ?? 'Teamso',
            award.awardedAt,
            award.message,
          ]),
        );
        const more = structured.total > awards.length ? `\n\nShowing ${awards.length} of ${structured.total}.` : '';
        return toolResult(`## My badges (${totalAwards} in total)\n\n${table}${more}`, structured);
      } catch (error) {
        return apiErrorResult(error, BADGE_HINTS);
      }
    },
  );
}
