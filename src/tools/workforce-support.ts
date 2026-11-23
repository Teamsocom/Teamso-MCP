/**
 * TMS-5154: helpers shared by the PDKS, timesheet, shift, expense, ATS and onboarding tools.
 */
import { z } from 'zod';
import { TeamsoApiError } from '../client.js';
import type { TeamsoPdksPerson } from '../types.js';
import type { ApiErrorHints } from '../utils/results.js';

/** `yyyy-MM-dd`. */
export const daySchema = (description: string) => z.string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a day as yyyy-MM-dd')
  .describe(description);

/**
 * `confirm` of the writes that need no SMS code: false shows what would be sent, true sends it. The SMS code is the
 * confirmation of the others.
 */
export const confirmSchema = z.boolean().default(false)
  .describe('false (default): preview only, nothing is sent. true: send it.');

/** `send_sms_code` of the writes Teamso protects with an SMS code. */
export const sendSmsCodeSchema = z.boolean().default(false)
  .describe('true: send the 6-digit SMS code to the caller\'s phone (valid for 3 minutes, uses company digital '
    + 'credit) together with the preview. Nothing else is sent.');

/**
 * The refusal code these endpoints put in `message` of an HTTP 400 answer (`Refused` of the services), mapped to a
 * sentence, or null.
 */
export function refusalText(error: unknown, texts: Record<string, string>): string | null {
  if (!(error instanceof TeamsoApiError)) return null;
  const code = error.apiMessage;
  return code && texts[code] ? texts[code]! : null;
}

/** The SMS step of a write: wrong, expired or missing code. */
export function smsHints(tool: string): ApiErrorHints {
  const again = `Call \`${tool}\` again with \`send_sms_code: true\` for a new code and ask the user for it.`;
  return {
    byCode: {
      OTP_NOT_DONE: `The SMS verification is missing or was already used. ${again}`,
      'validation error.The token is not correct.': `The SMS code is wrong. Ask the user to check it. ${again}`,
      'validation error.token is expired.': `The SMS code has expired (codes are valid for 3 minutes). ${again}`,
      'Token Not Found': `No SMS code is waiting for verification. ${again}`,
      'validation error.too many attempts.': `Too many wrong SMS codes: this code is cancelled. ${again}`,
      'validation error.a newer code was sent.': 'That code is from an older SMS; a newer code was sent since. Ask '
        + 'the user for the code in the latest SMS.',
      USER_NOT_FOUND: 'Teamso could not find a phone number for your account to send the SMS code to.',
    },
  };
}

export function personName(person: TeamsoPdksPerson | null | undefined, fallback = '-'): string {
  const name = [person?.name, person?.secondName, person?.surname].map(part => part?.trim()).filter(Boolean).join(' ');
  return name || fallback;
}

/** Minutes as hours with two decimals. */
export function hoursOf(minutes: number | null | undefined): number | undefined {
  return typeof minutes === 'number' && Number.isFinite(minutes) ? Math.round((minutes / 60) * 100) / 100 : undefined;
}

/** `HH:mm` (24 h). */
export const clockSchema = (description: string) => z.string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a time as HH:mm (24 h)')
  .describe(description);
