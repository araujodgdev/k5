import 'server-only';
import { observeDocument, observeResearch, parsePolicy, uncertainPolicy, type ContentPolicy } from '@/lib/content-policy';
import { contentAdmission } from '@/lib/content-admission';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import { ownedRun, publicRun, type RunRow } from '@/lib/ai-store';
import { RUN_TASKS, runInputSchema, validateRunSources } from '@/lib/document-workflows';
import { AiConnectionError } from '@/lib/ai-connections-core';
import { loadAssignmentSnapshot, pinRunModelPlan } from '@/lib/ai-assignments-core';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';
import { resolveDocumentTemplateId } from '@/lib/agent-profile';
import { instructionsPrompt } from '@/lib/agent-instructions';
import { knowledgePrompt, DRAFT_ALWAYS_BUDGET } from '@/lib/agent-knowledge';
import { assertLumeAdmission, assertSourcesAdmitted, type WorkspaceContext } from './context';
import { assertCredits } from '@/lib/billing/credits';

const owner = (context: WorkspaceContext) => ({ officeId: context.officeId, userId: context.userId });

async function requireRun(context: WorkspaceContext, runId: string): Promise<RunRow> {
  const run = await ownedRun(database, owner(context), runId);
  if (!run) throw new CapabilityError('NOT_FOUND', 'Tarefa não encontrada.');
  return run;
}

export async function listRuns(context: WorkspaceContext, input: CapabilityInput<'k5_runs_list'>): Promise<CapabilityOutput<'k5_runs_list'>> {
  const limit = input.limit ?? 5;
  const rows = await database.prepare('SELECT * FROM ai_run WHERE office_id=? AND user_id=? ORDER BY created_at DESC LIMIT ?')
    .all(context.officeId, context.userId, limit) as RunRow[];
  return { runs: rows.map(publicRun) };
}

export async function getRun(context: WorkspaceContext, input: CapabilityInput<'k5_runs_get'>): Promise<CapabilityOutput<'k5_runs_get'>> {
  return { run: publicRun(await requireRun(context, input.runId)) };
}

export async function cancelRun(context: WorkspaceContext, input: CapabilityInput<'k5_runs_cancel'>): Promise<CapabilityOutput<'k5_runs_cancel'>> {
  const run = await requireRun(context, input.runId);
  if (!['queued', 'running'].includes(run.status)) throw new CapabilityError('CONFLICT', 'Esta tarefa já terminou.');
  await database.prepare("UPDATE ai_run SET status='cancelled',lease_until=0 WHERE id=?").run(run.id);
  return { run: publicRun(await requireRun(context, run.id)) };
}

export async function retryRun(context: WorkspaceContext, input: CapabilityInput<'k5_runs_retry'>): Promise<CapabilityOutput<'k5_runs_retry'>> {
  const run = await requireRun(context, input.runId);
  if (run.status !== 'failed') throw new CapabilityError('CONFLICT', 'Somente tarefas com falha podem ser reenviadas.');
  const stored=JSON.parse(run.input);
  await contentAdmission({...context,allowedResearchCaseId:stored.caseId},stored,[stored.contentPolicy ? parsePolicy(stored.contentPolicy) : uncertainPolicy(context.userId)],{capability:'k5_runs_retry'}).admit();
  await database.prepare("UPDATE ai_run SET status='queued',error=NULL,attempts=0,lease_until=0 WHERE id=?").run(run.id);
  return { run: publicRun(await requireRun(context, run.id)) };
}

export type StartRunInput = {
  kind: 'chronology' | 'draft'; documentIds: string[]; instructions: string;
  caseId?: string; researchReferenceIds?: string[];
  templateId?: string; approvedCitationIds?: string[];
};

export async function startRun(context: WorkspaceContext, raw: StartRunInput) {
  if (raw.caseId) await assertLumeAdmission(raw.caseId);

  const templateId = raw.templateId ?? (raw.kind === 'draft' ? await resolveDocumentTemplateId(context) : undefined);

  const policies: ContentPolicy[] = [];
  const writingRules = raw.kind === 'draft' ? (await instructionsPrompt(context, 'documents', policies)) || undefined : undefined;

  const knowledge = raw.kind === 'draft' ? (await knowledgePrompt(context, { budget: DRAFT_ALWAYS_BUDGET, searchable: false, policies })) || undefined : undefined;
  const input = runInputSchema.parse({ ...raw, templateId, writingRules, knowledge, pinnedResearchReferences: undefined, approvedCitationIds: raw.approvedCitationIds ?? [] });
  const running = Number(await (await database.prepare("SELECT count(*) AS n FROM ai_run WHERE office_id=? AND status IN ('queued','running')").get(context.officeId))?.n);
  if (running >= 5) throw new CapabilityError('RATE_LIMITED', 'Seu escritório já tem cinco tarefas em andamento.');
  await assertCredits(context.officeId, context.userId);

  let plan;
  try { plan = pinRunModelPlan(await loadAssignmentSnapshot(database), RUN_TASKS[input.kind]); }
  catch (error) {
    if (error instanceof AiConnectionError) throw new CapabilityError('NOT_READY', error.message);
    throw error;
  }

  const legacyModel = plan.tasks[RUN_TASKS[input.kind][0]]!;
  let selection;
  try { selection = await validateRunSources(context, input); }
  catch (error) { throw new CapabilityError('SCOPE_REQUIRED', error instanceof Error ? error.message : 'Confira os documentos selecionados.'); }
  for (const docId of [...new Set([...input.documentIds, ...(templateId ? [templateId] : [])])]) policies.push((await observeDocument(context.userId, docId)).policy);
  for (const refId of input.researchReferenceIds) policies.push((await observeResearch(context.userId, refId, input.caseId!)).policy);
  if (context.contentSources) policies.push(...context.contentSources);
  const contentPolicy = uncertainPolicy(context.userId, policies);
  await assertSourcesAdmitted(contentPolicy);
  const id = randomUUID();

  await database.batch([
    database.prepare('INSERT INTO ai_run(id,office_id,user_id,kind,input,model_provider,model_id,model_plan) VALUES(?,?,?,?,?,?,?,?)')
      .bind(id, context.officeId, context.userId, input.kind,
        JSON.stringify({ ...input, contentPolicy, authority: { sessionId: context.sessionId, invocation: 'agent', caseScope: context.caseScope }, pinnedResearchReferences: selection.pinnedResearchReferences }),
        legacyModel.provider, legacyModel.modelId, JSON.stringify(plan)),
    ...selection.approved.map((citation) =>
      database.prepare(`INSERT INTO ai_citation_approval(run_id,citation_id,source_text,source_label,user_id,source_type,document_id,
        research_reference_id,material_version_id,judgment_id,research_chunk_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(id, citation.id, citation.text, citation.sourceLabel, context.userId, citation.sourceType ?? 'vault',
          citation.documentId ?? null, citation.researchReferenceId ?? null, citation.materialVersionId ?? null,
          citation.judgmentId ?? null, citation.researchChunkId ?? null)),
  ]);
  return { run: publicRun(await requireRun(context, id)) };
}

export function startChronology(context: WorkspaceContext, input: CapabilityInput<'k5_documents_start_chronology'>) {
  return startRun(context, { kind: 'chronology', documentIds: input.documentIds, instructions: input.instructions });
}

export function startDraft(context: WorkspaceContext, input: CapabilityInput<'k5_documents_start_draft'>) {
  if (context.invocation && input.researchReferenceIds?.length)
    throw new CapabilityError('APPROVAL_REQUIRED', 'Selecione as referências e as citações na interface de minutas.');
  return startRun(context, { kind: 'draft', documentIds: input.documentIds, instructions: input.instructions,
    templateId: input.templateId, caseId: input.caseId, researchReferenceIds: input.researchReferenceIds });
}
