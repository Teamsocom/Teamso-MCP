import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * Ready-made prompts. They only steer the assistant through the tools; every
 * write still goes through the user's confirmation and the SMS code.
 */

type PromptRegistrar = (server: McpServer) => void;

const optionalText = (description: string) => z.string().trim().max(200).optional().describe(description);

function userMessage(text: string) {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
}

export function registerRequestLeavePrompt(server: McpServer): void {
  server.registerPrompt(
    'request_leave',
    {
      title: 'İzin talebi oluştur / Request leave',
      description: 'Create a leave request for the signed-in user: pick the leave type, check the working days '
        + 'and remaining balance, confirm, then send it with the SMS code.',
      argsSchema: {
        start: optionalText('First day of leave (`yyyy-MM-dd`, or words like "tomorrow" / "yarın").'),
        end: optionalText('Last day of leave (`yyyy-MM-dd`); empty means the same day as start.'),
        leave_type: optionalText('Leave type name, e.g. "Yıllık İzin" / "Annual leave"; empty means annual leave.'),
        note: optionalText('Note for the approver.'),
      },
    },
    ({ start, end, leave_type, note }) => userMessage([
      'I want to request leave in Teamso.',
      `- Start: ${start || 'ask me'}`,
      `- End: ${end || (start ? 'same day as start' : 'ask me')}`,
      `- Leave type: ${leave_type || 'annual leave (Yıllık İzin)'}`,
      ...(note ? [`- Note for the approver: ${note}`] : []),
      '',
      'Steps:',
      '1. Resolve relative dates against today in Turkey time (Europe/Istanbul) and write them as yyyy-MM-dd.',
      '2. Call list_leave_types and pick the matching type (its id and remaining days).',
      '3. Call calculate_leave_days and show me the working days, the return-to-work date and my balance after.',
      '4. Ask me to confirm. Only then call request_leave_otp; it sends an SMS code to my phone.',
      '5. Ask me for the code and call create_leave_request with the same leave_type_id, start, end and otp_code.',
      '6. Tell me the request id, its status and who approves it next.',
    ].join('\n')),
  );
}

export function registerReviewPendingApprovalsPrompt(server: McpServer): void {
  server.registerPrompt(
    'review_pending_approvals',
    {
      title: 'Onay bekleyen izinler / Review pending approvals',
      description: 'Walk through the leave requests waiting for the signed-in user\'s approval, one by one.',
      argsSchema: {},
    },
    () => userMessage([
      'Show me the leave requests waiting for my approval in Teamso.',
      '',
      'Steps:',
      '1. Call list_pending_approvals and list them as a table: requester, leave type, dates, working days, note.',
      '2. For each request, ask me whether to approve or reject. Never decide for me.',
      '3. Call approve_or_reject_leave only after my answer; a rejection needs the reason I give.',
      '4. Finish with a short summary of what was approved and rejected.',
    ].join('\n')),
  );
}

const REGISTRARS = {
  request_leave: registerRequestLeavePrompt,
  review_pending_approvals: registerReviewPendingApprovalsPrompt,
} satisfies Record<string, PromptRegistrar>;

export type PromptName = keyof typeof REGISTRARS;

export const PROMPT_NAMES: readonly PromptName[] = Object.freeze(Object.keys(REGISTRARS) as PromptName[]);

export function registerPrompts(server: McpServer): void {
  for (const name of PROMPT_NAMES) {
    REGISTRARS[name](server);
  }
}
