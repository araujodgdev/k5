import { z } from 'zod';
import type { UIMessage } from 'ai';

export const approvalDecision = z.object({
  state: z.enum(['confirmed', 'cancelled', 'failed']),
  result: z.string(),
  href: z.string().optional(),
});
export type ApprovalDecision = z.infer<typeof approvalDecision>;

export function applyApprovalDecisions(messages: UIMessage[], decisions: ReadonlyMap<string, ApprovalDecision>): UIMessage[] {
  return messages.map(message => ({ ...message, parts: message.parts.map(part => {
    if (part.type !== 'data-approval' || !part.data || typeof part.data !== 'object' || !('approvalId' in part.data) || typeof part.data.approvalId !== 'string') return part;
    const decision = decisions.get(part.data.approvalId);
    return decision ? { ...part, data: { ...part.data, ...decision } } : part;
  }) }));
}
