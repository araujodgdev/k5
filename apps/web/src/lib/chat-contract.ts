import { z } from 'zod';

const messageSchema = z.object({ id: z.string(), role: z.enum(['user', 'assistant', 'system']), parts: z.array(z.object({ type: z.string(), text: z.string().max(20000).optional() }).passthrough()).max(100) });
// Audio belongs to one turn and is never stored as a document.
const attachmentSchema = z.object({ mediaType: z.string().max(120), data: z.string().max(8_000_000) });
export const chatRequestSchema = z.object({
  conversationId: z.string().optional(),
  id: z.string().optional(),
  documentIds: z.array(z.string()).max(100).default([]),
  caseId: z.string().nullish().transform(value => value ?? undefined),
  researchReferenceIds: z.array(z.string()).max(30).default([]),
  attachmentIds: z.array(z.string().uuid()).max(6).default([]),
  attachments: z.array(attachmentSchema).max(2).default([]),
  message: messageSchema,
  trigger: z.enum(['submit-message', 'regenerate-message']).optional(),
  messageId: z.string().optional(),
});
