import { z } from 'zod';

export const humanDecision = z.enum(['pending', 'confirmed', 'needs_adjustment']);
export const humanReviewInput = z.object({ version: z.number().int().positive(), itemKey: z.string().regex(/^[a-f0-9]{64}$/), decision: humanDecision, note: z.string().max(2000).default(''), revision: z.number().int().nonnegative() });
export const humanReviewItem = z.object({ key: z.string(), label: z.string(), excerpt: z.string(), automaticStatus: z.string(), decision: humanDecision, note: z.string(), revision: z.number().int(), updatedAt: z.string().nullable() });
export const humanReviewResponse = z.object({ version: z.number().int(), items: z.array(humanReviewItem) });
export type HumanReviewItem = z.infer<typeof humanReviewItem>;
