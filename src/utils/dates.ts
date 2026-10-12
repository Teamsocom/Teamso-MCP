import { ToolInputError } from './results.js';

/**
 * Teamso leave dates are Turkey wall-clock strings (`yyyy-MM-dd HH:mm`) that
 * the API stores and returns unchanged. They are never converted to or from
 * UTC here.
 */

const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/;
const TIME = /^(\d{2}):(\d{2})/;

export const DEFAULT_WORKDAY_START = '09:00';
export const DEFAULT_WORKDAY_END = '18:00';

export interface WallClockInput {
  /** `yyyy-MM-dd`. */
  date: string;
  /** `HH:mm`, or undefined when only a date was given. */
  time?: string;
}

/** Parses `yyyy-MM-dd`, `yyyy-MM-dd HH:mm` or `yyyy-MM-ddTHH:mm[:ss]`; throws a readable error otherwise. */
export function parseWallClock(value: string, field: string): WallClockInput {
  const match = DATE_INPUT.exec(value.trim());
  if (!match) {
    throw new ToolInputError(`\`${field}\` must be \`yyyy-MM-dd\` or \`yyyy-MM-dd HH:mm\` (Turkey local time), got "${value}".`);
  }
  const [, year, month, day, hour, minute] = match;
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (calendar.getUTCFullYear() !== Number(year)
    || calendar.getUTCMonth() !== Number(month) - 1
    || calendar.getUTCDate() !== Number(day)) {
    throw new ToolInputError(`\`${field}\` is not a real calendar date: "${value}".`);
  }
  if (hour !== undefined && (Number(hour) > 23 || Number(minute) > 59)) {
    throw new ToolInputError(`\`${field}\` has an invalid time: "${value}".`);
  }
  return {
    date: `${year}-${month}-${day}`,
    time: hour !== undefined ? `${hour}:${minute}` : undefined,
  };
}

export function formatWallClock(date: string, time: string): string {
  return `${date} ${time}`;
}

/** `HH:mm` from `HH:mm[:ss]`, or undefined. */
export function toClockTime(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const match = TIME.exec(value.trim());
  if (!match) return undefined;
  return Number(match[1]) <= 23 && Number(match[2]) <= 59 ? `${match[1]}:${match[2]}` : undefined;
}

export const TEAMSO_TIME_ZONE = 'Europe/Istanbul';

/** An ISO 8601 instant: a date-time with `Z` or a numeric UTC offset. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

const istanbulParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: TEAMSO_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * An instant (epoch millis or ISO string with an offset) as Turkey wall-clock
 * parts. Wall-clock strings without an offset are not instants and return
 * undefined, so they are never shifted.
 */
function istanbulWallClock(value: string | number): { date: string; time: string } | undefined {
  if (typeof value === 'string' && !ISO_INSTANT.test(value.trim())) return undefined;
  const instant = new Date(typeof value === 'number' ? value : value.trim());
  if (Number.isNaN(instant.getTime())) return undefined;
  const parts = Object.fromEntries(istanbulParts.formatToParts(instant).map(part => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/**
 * `yyyy-MM-dd` from an API date. Instants (epoch millis, ISO strings with an
 * offset) are read on the Turkey calendar, so a midnight stored in either UTC
 * or Turkey time lands on the intended day; wall-clock strings
 * (`yyyy-MM-dd[ HH:mm]`) are taken as they are.
 */
export function toIsoDay(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const instant = istanbulWallClock(value);
  if (instant) return instant.date;
  if (typeof value === 'number') return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match?.[1];
}

/**
 * API date-time for display. Instants become Turkey wall clock
 * (`yyyy-MM-dd HH:mm`), matching the leave dates; other strings are kept.
 */
export function toDisplayDateTime(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const instant = istanbulWallClock(value);
  if (instant) return formatWallClock(instant.date, instant.time);
  return typeof value === 'string' ? value : undefined;
}
