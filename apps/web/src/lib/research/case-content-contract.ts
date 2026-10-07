import { z } from 'zod';

const text = z.string().trim().min(2).max(1200);
export const documentedFact = z.object({ text, documentIds: z.array(z.uuid()).min(1).max(12), chunkIds: z.array(z.string()).max(20).default([]) });
export const entryIds = z.object({ documentedFacts: z.array(z.uuid().nullable()).max(40), allegedFacts: z.array(z.uuid().nullable()).max(40), gaps: z.array(z.uuid().nullable()).max(40) });
export const profileText = z.object({
  legalQuestion: z.string().trim().min(5).max(1500), objective: z.string().trim().min(3).max(1500),
  thesis: z.string().trim().max(1500).nullable().transform(value => value || null), documentedFacts: z.array(documentedFact).max(40),
  allegedFacts: z.array(text).max(40), gaps: z.array(text).max(40), documentIds: z.array(z.uuid()).max(60),
});
export const personProfileText = profileText.partial({ legalQuestion: true, objective: true, thesis: true }).extend({
  readToken: z.uuid().optional(), entryIds: entryIds.optional(), deletedEntryIds: z.array(z.uuid()).max(120).default([]),
});
export const researchTextChange = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('person') }),
  z.object({ kind: z.literal('request') }),
  z.object({ kind: z.literal('confirm'), generationAttemptId: z.uuid() }),
]);
const visible = <T extends z.ZodType>(schema: T) => z.discriminatedUnion('state', [
  z.object({ state: z.literal('visible'), value: schema }), z.object({ state: z.literal('withheld') }),
]);
const common = z.object({ caseId: z.uuid(), version: z.number().int().nonnegative(), readToken: z.uuid(),
  entryIds: entryIds, documentIds: z.array(z.uuid()), updatedAt: z.string(), updatedBy: z.string() });
export const profileView = z.discriminatedUnion('kind', [
  common.extend({ kind: z.literal('complete'), ...profileText.shape }),
  common.extend({ kind: z.literal('restricted'), scalars: z.object({ legalQuestion: visible(z.string()), objective: visible(z.string()), thesis: visible(z.string().nullable()) }),
    documentedFacts: z.array(documentedFact), allegedFacts: z.array(z.string()), gaps: z.array(z.string()),
    withheld: z.object({ documentedFacts: z.number(), allegedFacts: z.number(), gaps: z.number(), documentIds: z.number() }) }),
]);
export type ProfileView = z.infer<typeof profileView>;
export type ProfileText = z.infer<typeof profileText>;
export type ResearchTextChange = z.infer<typeof researchTextChange>;
export const RESEARCH_SCHEMA_VERSION = 1;
export type ResearchGeneration = { kind: 'profile'; caseId: string; expectedVersion: number } | { kind: 'notes'; caseId: string; referenceId?: string; expectedVersion: number };
