import { z } from 'zod';
export const proposalPayload = z.object({
  kind: z.enum(['task', 'meeting']).optional(), title: z.string().max(180).optional(), notes: z.string().max(8000).optional(),
  status: z.enum(['pending', 'completed', 'cancelled']).optional(), dueOn: z.string().nullable().optional(),
  startsAt: z.string().nullable().optional(), endsAt: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(), caseId: z.string().nullable().optional(), assigneeId: z.string().nullable().optional(),
  activityId: z.string().optional(), version: z.number().int().positive().optional(),
});
export const proposalDto = z.object({
  id: z.string(), message: z.string(), referenceAt: z.string(), timeZone: z.string(), operation: z.string(),
  payload: proposalPayload, questions: z.array(z.string()), provenance: z.record(z.string(), z.string()),
  evaluationStatus: z.string(), status: z.string(), version: z.number(), expiresAt: z.number(),
});
export type AgendaProposal = z.infer<typeof proposalDto>;
