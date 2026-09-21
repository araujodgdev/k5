import { z } from 'zod';
export const verificationUnit = z.object({
  id: z.string(), text: z.string(), evidence: z.array(z.object({ sourceId: z.string(), quote: z.string() })),
});
export type VerificationUnit = z.infer<typeof verificationUnit>;
export const verificationItem = z.object({
  unitId: z.string(), text: z.string(),
  outcome: z.enum(['supported', 'unsupported', 'contradicted', 'insufficient_context', 'quote_not_found', 'unavailable']),
  confidence: z.number().optional(), probabilities: z.record(z.string(), z.number()).optional(),
  sources: z.array(z.object({ documentId: z.string(), sourceLabel: z.string(), excerpt: z.string() })),
});
export const verificationReport = z.object({
  id: z.string(), artifactVersion: z.number(), status: z.string(), mode: z.string(),
  checked: z.number(), total: z.number(), model: z.string().nullable(),
  items: z.array(verificationItem),
});
export type VerificationReport = z.infer<typeof verificationReport>;
