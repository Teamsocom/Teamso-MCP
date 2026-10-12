import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

/** Reads Teamso data; safe to retry. */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/** Creates something new or moves a workflow forward; never removes data. */
export const ADDITIVE_WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

/** Overwrites, deletes or irreversibly decides something. Confirm with the user first. */
export const DESTRUCTIVE_WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

export const otpCodeSchema = z.string()
  .trim()
  .regex(/^\d{4,8}$/, 'otp_code must be the numeric code from the SMS')
  .describe('The SMS verification code the user received after `request_leave_otp` (valid for 3 minutes).');

export const leaveDateSchema = (edge: 'start' | 'end') => z.string()
  .trim()
  .min(10)
  .max(25)
  .describe(edge === 'start'
    ? 'First day of leave, Turkey local time: `yyyy-MM-dd` (starts at the shift start, 09:00 by default) or `yyyy-MM-dd HH:mm`.'
    : 'Last day of leave, Turkey local time: `yyyy-MM-dd` (ends at the shift end, 18:00 by default) or `yyyy-MM-dd HH:mm`.');

/**
 * Teamso record ids (UUIDs and similar). They travel as URL path segments, so
 * anything beyond letters, digits, `-` and `_` (dot segments, slashes) is
 * refused before a request is made.
 */
export const idSchema = (description: string) => z.string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'must be a Teamso id (letters, digits, - and _)')
  .describe(description);

export const periodSchema = z.string()
  .trim()
  .min(1)
  .max(200)
  .describe('Performance period title exactly as returned by `list_performance_periods` (e.g. "Q4 2026").');

export const GOAL_STATUSES = [
  'PENDING',
  'WAITING_APPROVAL',
  'APPROVED',
  'REVISED_AND_APPROVED',
  'IN_PROGRESS',
  'EVALUATING',
  'EVALUATED',
  'EVALUATION_WAITING_APPROVAL',
  'EVALUATION_IN_APPROVAL',
  'COMPLETED',
  'NOT_INCLUDED',
] as const;

export const SCALE_CRITERIA = ['POINTS', 'QUANTITY', 'DAYS', 'CURRENCY', 'PERCENTAGE', 'OTHER'] as const;
