import { z } from 'zod';

export const emailTriageInput = z.object({ threadIds: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)).min(1).max(20) }).strict();
export const emailTriageItem = z.object({
  threadId: z.string(),
  category: z.enum(['clients', 'proceedings', 'finance', 'scheduling', 'informational', 'other']),
  priority: z.enum(['low', 'normal', 'high']),
  needsReply: z.boolean().nullable(),
  uncertain: z.boolean(),
  analyzedAt: z.string(),
});
export type EmailTriageItem = z.infer<typeof emailTriageItem>;
export type EmailTriageResult = {
  status: 'evaluated' | 'partial' | 'disabled' | 'unavailable' | 'budget_exceeded';
  items: EmailTriageItem[];
};
