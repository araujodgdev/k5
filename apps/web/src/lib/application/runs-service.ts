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

function requireRun(context: WorkspaceContext, runId: string): RunRow {
  const run = ownedRun(database, owner(context), runId);
  if (!run) throw new CapabilityError('NOT_FOUND', 'Tarefa não encontrada.');
  return run;
}

export function listRuns(context: WorkspaceContext, input: CapabilityInput<'k5_runs_list'>): CapabilityOutput<'k5_runs_list'> {
  const limit = input.limit ?? 5;
  const rows = database.prepare('SELECT * FROM ai_run WHERE office_id=? AND user_id=? ORDER BY created_at DESC LIMIT ?')
    .all(context.officeId, context.userId, limit) as RunRow[];
  return { runs: rows.map(publicRun) };
}

export function getRun(context: WorkspaceContext, input: CapabilityInput<'k5_runs_get'>): CapabilityOutput<'k5_runs_get'> {
  return { run: publicRun(requireRun(context, input.runId)) };
}

export function cancelRun(context: WorkspaceContext, input: CapabilityInput<'k5_runs_cancel'>): CapabilityOutput<'k5_runs_cancel'> {
  const run = requireRun(context, input.runId);
  if (!['queued', 'running'].includes(run.status)) throw new CapabilityError('CONFLICT', 'Esta tarefa já terminou.');
  database.prepare("UPDATE ai_run SET status='cancelled',lease_until=0 WHERE id=?").run(run.id);
  return { run: publicRun(requireRun(context, run.id)) };
}

export function retryRun(context: WorkspaceContext, input: CapabilityInput<'k5_runs_retry'>): CapabilityOutput<'k5_runs_retry'> {
  const run = requireRun(context, input.runId);
  if (run.status !== 'failed') throw new CapabilityError('CONFLICT', 'Somente tarefas com falha podem ser reenviadas.');
  database.prepare("UPDATE ai_run SET status='queued',error=NULL,attempts=0,lease_until=0 WHERE id=?").run(run.id);
  return { run: publicRun(requireRun(context, run.id)) };
}

export type StartRunInput = {
  kind: 'chronology' | 'draft'; documentIds: string[]; instructions: string;
  templateId?: string; approvedCitationIds?: string[];
};

/**
 * Queues a durable run. Approved legal citations only ever arrive from a human selection in the
 * interface: the agent tools call this without them, and the run rejects unapproved passages later.
 */
export async function startRun(context: WorkspaceContext, raw: StartRunInput) {
  const input = runInputSchema.parse({ ...raw, approvedCitationIds: raw.approvedCitationIds ?? [] });
  const running = Number(database.prepare("SELECT count(*) AS n FROM ai_run WHERE office_id=? AND status IN ('queued','running')").get(context.officeId)?.n);
  if (running >= 5) throw new CapabilityError('RATE_LIMITED', 'Seu escritório já tem cinco tarefas em andamento.');
  // Fail here, not three minutes into the worker: the credential has to resolve before queueing.
  await resolveOfficeModelConfig(context.officeId, input.kind === 'chronology' ? 'extraction' : 'drafting', context.model);
  let selection;
  try { selection = validateRunSources(context.officeId, input); }
  catch (error) { throw new CapabilityError('SCOPE_REQUIRED', error instanceof Error ? error.message : 'Confira os documentos selecionados.'); }
  const id = randomUUID();
  database.exec('SAVEPOINT start_run');
  try {
    database.prepare('INSERT INTO ai_run(id,office_id,user_id,kind,input,model_provider,model_id) VALUES(?,?,?,?,?,?,?)')
      .run(id, context.officeId, context.userId, input.kind, JSON.stringify(input), context.model?.provider ?? null, context.model?.modelId ?? null);
    for (const citation of selection.approved) {
      database.prepare('INSERT INTO ai_citation_approval(run_id,citation_id,source_text,source_label,user_id) VALUES(?,?,?,?,?)')
        .run(id, citation.id, citation.text, citation.sourceLabel, context.userId);
    }
    database.exec('RELEASE start_run');
  } catch (error) { database.exec('ROLLBACK TO start_run; RELEASE start_run'); throw error; }
  return { run: publicRun(requireRun(context, id)) };
}

export function startChronology(context: WorkspaceContext, input: CapabilityInput<'k5_documents_start_chronology'>) {
  return startRun(context, { kind: 'chronology', documentIds: input.documentIds, instructions: input.instructions });
}

export function startDraft(context: WorkspaceContext, input: CapabilityInput<'k5_documents_start_draft'>) {
  return startRun(context, { kind: 'draft', documentIds: input.documentIds, instructions: input.instructions, templateId: input.templateId });
}
