import { profileView, personProfileText, researchTextChange } from '@/lib/research/case-content-contract';
import { z } from 'zod';
import { decisionAnswer, decisionMode } from '@/lib/typesafe/contracts';

const uuid = z.uuid();
const idempotencyKey = z.string().trim().min(8).max(128).optional();
const purpose = z.enum(['foundation', 'counterpoint', 'context']);
const profile = profileView;
const assessment = z.object({
  id: uuid, caseId: uuid, materialVersionId: uuid, profileVersion: z.number().nullable(),
  status: z.enum(['queued', 'running', 'evaluated', 'incomplete', 'disabled', 'unavailable', 'budget_exceeded', 'stale']),
  current: z.boolean(), mode: decisionMode, model: z.string().nullable(), reason: z.string().nullable(),
  result: z.object({
    answers: z.record(z.string(), decisionAnswer), composite: z.number().nullable(), compositionVersion: z.string(),
    coverage: z.object({ caseChunksUsed: z.number(), materialChunksUsed: z.number(), materialChunksAvailable: z.number(), partial: z.boolean() }),
    excerpts: z.array(z.object({ source: z.enum(['vault', 'research']), id: z.string(), reference: z.string(), excerpt: z.string() })),
  }).nullable(), createdAt: z.string(), updatedAt: z.string(),
});
const reference = z.object({
  id: uuid, caseId: uuid, materialVersionId: uuid, purpose, notes: z.string(), notesState: z.enum(['visible','withheld']), readToken: uuid.nullable(), assessmentId: uuid.nullable(),
  assessment: assessment.nullable(), bypassEvaluation: z.boolean(), version: z.number(), createdAt: z.string(), updatedAt: z.string(),
  material: z.object({
    kind: z.enum(['ementa', 'full_text']),
    materialStatus: z.enum(['pending', 'fetching', 'processing', 'ready', 'unavailable', 'failed', 'restricted']),
    judgmentStatus: z.enum(['candidate', 'active', 'unavailable', 'restricted']),
    title: z.string(), tribunal: z.string(), courtUnit: z.string().nullable(), caseNumber: z.string().nullable(),
    decisionDate: z.string().nullable(), sourceUrl: z.string().nullable(), judgmentId: uuid, materialId: uuid,
    currentVersionId: uuid.nullable(), localAllowed: z.boolean(),
  }).nullable(),
});

export const researchCaseCapabilities = {
  k5_research_get_profile: {
    module: 'research', contentResult: 'owned', effect: 'read', publish: ['agent', 'webmcp'],
    description: 'Lê o perfil factual versionado de um caso.',
    input: z.object({ caseId: uuid }), output: z.object({ profile: profile.nullable() }),
  },
  k5_research_save_profile: {
    module: 'research', contentResult: 'owned', effect: 'write', publish: ['agent', 'webmcp'],
    description: 'Salva o perfil factual revisado de um caso.',
    preparation: 'research-content',
    agentInput: z.object({ caseId: uuid, expectedVersion: z.number().int().nonnegative(), change: z.object({ kind: z.literal('request') }).default({ kind: 'request' }), idempotencyKey }).strict(),
    input: z.union([personProfileText.extend({ caseId: uuid, expectedVersion: z.number().int().nonnegative(), idempotencyKey, change: z.object({ kind: z.literal('person') }).optional() }),
      z.object({ caseId: uuid, expectedVersion: z.number().int().nonnegative(), change: z.object({ kind: z.literal('confirm'), generationAttemptId: uuid }), approvalId: uuid, idempotencyKey })]), output: z.object({ profile }),
  },
  k5_research_assess_material: {
    module: 'research', contentResult: 'owned', effect: 'write', publish: ['agent', 'webmcp'],
    description: 'Pede avaliação de pertinência entre perfil de caso e material de julgado.',
    input: z.object({ caseId: uuid, materialVersionId: uuid, idempotencyKey }), output: z.object({ assessment }),
  },
  k5_research_get_assessment: {
    module: 'research', contentResult: 'owned', effect: 'read', publish: ['agent', 'webmcp'],
    description: 'Lê o estado e as dimensões de uma avaliação já solicitada.',
    input: z.object({ assessmentId: uuid }), output: z.object({ assessment }),
  },
  k5_research_list_references: {
    module: 'research', contentResult: 'owned', effect: 'read', publish: ['agent', 'webmcp'],
    description: 'Lista as referências públicas escolhidas para um caso do Cofre. Não inicia coleta ou avaliação.',
    input: z.object({ caseId: uuid }), output: z.object({ references: z.array(reference) }),
  },
  k5_research_add_reference: {
    module: 'research', contentResult: 'owned', effect: 'write', publish: ['agent', 'webmcp'],
    description: 'Vincula uma versão de material a um caso após revisão humana.',
    preparation: 'research-content',
    agentInput: z.object({ caseId: uuid, materialVersionId: uuid, purpose, assessmentId: uuid, bypassEvaluation: z.boolean().default(false), change: z.object({ kind: z.literal('request') }).optional(), idempotencyKey, approvalId: uuid.optional() }).strict(),
    input: z.object({ caseId: uuid, materialVersionId: uuid, purpose, assessmentId: uuid, change: researchTextChange.optional(), bypassEvaluation: z.boolean().default(false), notes: z.string().trim().max(4000).optional(), readToken: uuid.optional(), idempotencyKey, approvalId: z.uuid().optional() }),
    output: z.object({ reference }),
  },
  k5_research_update_reference: {
    module: 'research', contentResult: 'owned', effect: 'write', publish: ['agent', 'webmcp'],
    description: 'Edita finalidade ou anotação de uma referência do caso.',
    preparation: 'research-content',
    agentInput: z.object({ referenceId: uuid, expectedVersion: z.number().int().positive(), materialVersionId: uuid.optional(), assessmentId: uuid.optional(), bypassEvaluation: z.boolean().optional(), purpose: purpose.optional(), change: z.object({ kind: z.literal('request') }).optional(), idempotencyKey }).strict(),
    input: z.object({ referenceId: uuid, change: researchTextChange.optional(), readToken: uuid.optional(), expectedVersion: z.number().int().positive(), materialVersionId: uuid.optional(), assessmentId: uuid.optional(), bypassEvaluation: z.boolean().optional(), purpose: purpose.optional(), notes: z.string().trim().max(4000).optional(), idempotencyKey, approvalId: z.uuid().optional() }),
    output: z.object({ reference }),
  },
  k5_research_remove_reference: {
    module: 'research', contentResult: 'owned', effect: 'write', publish: ['agent', 'webmcp'],
    description: 'Remove um vínculo de referência sem apagar o julgado do acervo.',
    input: z.object({ referenceId: uuid, expectedVersion: z.number().int().positive(), idempotencyKey, approvalId: z.uuid().optional() }), output: z.object({ success: z.boolean() }),
  },
} as const;
