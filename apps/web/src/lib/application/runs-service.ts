import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import { ownedRun, publicRun, type RunRow } from '@/lib/ai-store';
import { runInputSchema, validateRunSources } from '@/lib/document-workflows';
import { resolveOfficeModelConfig } from '@/lib/ai-connections';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';
import type { WorkspaceContext } from './context';

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
  await database.prepare("UPDATE ai_run SET status='queued',error=NULL,attempts=0,lease_until=0 WHERE id=?").run(run.id);
  return { run: publicRun(await requireRun(context, run.id)) };
}

export type StartRunInput = {
  kind: 'chronology' | 'draft'; documentIds: string[]; instructions: string;
  caseId?: string; researchReferenceIds?: string[];
  templateId?: string; approvedCitationIds?: string[];
};

/**
 * Queues a durable run. Approved legal citations only ever arrive from a human selection in the
 * interface: the agent tools call this without them, and the run rejects unapproved passages later.
 */
export async function startRun(context: WorkspaceContext, raw: StartRunInput) {
  const input = runInputSchema.parse({ ...raw, pinnedResearchReferences: undefined, approvedCitationIds: raw.approvedCitationIds ?? [] });
  const running = Number(await (await database.prepare("SELECT count(*) AS n FROM ai_run WHERE office_id=? AND status IN ('queued','running')").get(context.officeId))?.n);
  if (running >= 5) throw new CapabilityError('RATE_LIMITED', 'Seu escritório já tem cinco tarefas em andamento.');
  // Fail here, not three minutes into the worker: the credential has to resolve before queueing.
  const model = await resolveOfficeModelConfig(context.officeId, input.kind === 'chronology' ? 'extraction' : 'drafting');
  let selection;
  try { selection = await validateRunSources(context, input); }
  catch (error) { throw new CapabilityError('SCOPE_REQUIRED', error instanceof Error ? error.message : 'Confira os documentos selecionados.'); }
  const id = randomUUID();
  // The run and the citations it was approved against are written together. A run that starts
  // without its approvals would draft from passages nobody signed off on.
  await database.batch([
    database.prepare('INSERT INTO ai_run(id,office_id,user_id,kind,input,model_provider,model_id) VALUES(?,?,?,?,?,?,?)')
      .bind(id, context.officeId, context.userId, input.kind,
        JSON.stringify({ ...input, pinnedResearchReferences: selection.pinnedResearchReferences }),
        model.provider, model.modelId),
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
