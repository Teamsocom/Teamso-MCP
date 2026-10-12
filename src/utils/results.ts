import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TeamsoApiError } from '../client.js';

export const ACCESS_TOKEN_URL = 'https://teamso.com/dashboard/mcp-access';

/** Invalid tool input or a business rule the user has to fix; its message is shown as-is. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

export interface NextAction {
  tool: string;
  arguments: Record<string, unknown>;
  reason: string;
}

/** Successful tool result: concise Markdown for the reader, typed data for chaining. */
export function toolResult(text: string, structuredContent: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent,
  };
}

/** Failed tool result (`isError: true`) with an actionable explanation. */
export function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `## Error\n\n${message}` }],
    isError: true,
  };
}

export interface ApiErrorHints {
  /** Text per `message_code` or API `message` (e.g. `OTP_NOT_DONE`, `NOT_AUTHORIZED_TO_APPROVE`). */
  byCode?: Record<string, string>;
  /** What the caller needs when the API answers 403 `ACCESS_DENIED`. */
  forbidden?: string;
  /** Text for a missing record (`ITEM_NOT_FOUND`, `USER_NOT_FOUND`, HTTP 404). */
  notFound?: string;
}

/** Turns any failure into an `isError` result that tells the assistant what to do next. */
export function apiErrorResult(error: unknown, hints: ApiErrorHints = {}): CallToolResult {
  return errorResult(describeError(error, hints));
}

export function describeError(error: unknown, hints: ApiErrorHints = {}): string {
  if (error instanceof ToolInputError) return error.message;
  if (!(error instanceof TeamsoApiError)) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return 'The request to Teamso timed out or was cancelled. Try again in a moment.';
    }
    return error instanceof Error ? error.message : String(error);
  }

  const codes = [error.apiMessage, error.messageCode].filter((code): code is string => Boolean(code));
  for (const code of codes) {
    const hint = hints.byCode?.[code];
    if (hint) return `${hint}\n\n${errorReference(error)}`;
  }

  if (error.status === 401) {
    return 'Teamso rejected the access token (it is invalid, expired, revoked, or its owner is inactive). '
      + `Create a new personal access token at ${ACCESS_TOKEN_URL} and update \`TEAMSO_ACCESS_TOKEN\`.\n\n`
      + errorReference(error);
  }
  if (error.status === 403 && error.messageCode === 'IP_NOT_ALLOWED') {
    return 'Your company only allows Teamso access from approved IP addresses, and this request came from '
      + 'an address outside that list. Ask your Teamso administrator to allow it.\n\n'
      + errorReference(error);
  }
  if (error.status === 403 || error.messageCode === 'PERMISSION_DENIED') {
    const need = hints.forbidden ? ` ${hints.forbidden}` : '';
    return `Your Teamso account is not allowed to do this.${need} `
      + 'Ask your Teamso administrator if you need access.\n\n'
      + errorReference(error);
  }
  if (error.status === 404 || error.messageCode === 'ITEM_NOT_FOUND' || error.messageCode === 'USER_NOT_FOUND') {
    const text = hints.notFound ?? 'Teamso could not find that record, or it is not visible to you.';
    return `${text}\n\n${errorReference(error)}`;
  }
  if (error.status === 429) {
    return 'Too many requests to Teamso. Wait a minute and try again.\n\n' + errorReference(error);
  }
  if (error.status >= 500) {
    return 'Teamso could not complete the request because of a server error. Try again later.\n\n'
      + errorReference(error);
  }
  if (error.messageCode === 'CREDIT_INSUFFICIENT') {
    return 'Your company does not have enough digital (SMS) credit for this step. '
      + 'Ask your Teamso administrator to top up credits.\n\n'
      + errorReference(error);
  }

  const detail = typeof error.result === 'string' && error.result !== error.apiMessage
    ? ` (${error.result})`
    : '';
  return `${error.apiMessage ?? 'The request failed.'}${detail}\n\n${errorReference(error)}`;
}

function errorReference(error: TeamsoApiError): string {
  const parts = [`HTTP ${error.status}`];
  if (error.messageCode) parts.push(`\`${error.messageCode}\``);
  if (error.apiMessage && error.apiMessage !== error.messageCode) parts.push(error.apiMessage);
  return `_Teamso API: ${parts.join(' · ')}_`;
}
