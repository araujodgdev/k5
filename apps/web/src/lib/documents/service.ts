import 'server-only';
import { randomUUID } from 'node:crypto';
import { withTransaction, type Transaction } from '@/lib/database';
import type { ArtifactRow } from '@/lib/ai-store';
import { assertCapabilityAllowed, assertSourcesAdmitted, assertWorkspaceSession, type WorkspaceContext } from '@/lib/application/context';
import { canonicalInput, createApprovalProposal, type ApprovalRow } from '@/lib/application/approvals-service';
import { artifactPolicy, assertPolicyAccess, combinePolicy, parsePolicy, privateGenerationPolicy, type ContentPolicy } from '@/lib/content-policy';
import { CapabilityError } from '@/lib/capabilities/errors';

type ArtifactWrite = { id: string; title: string; content: string; version: number; snapshot?: boolean; restoreVersion?: number;
  approval?: { id?: string; name: 'k5_artifacts_edit' | 'k5_artifacts_update'; input: Record<string, unknown> } };
const home = (context: WorkspaceContext) => context.caseScope?.homeOfficeId ?? context.officeId;

export async function consumedArtifactResult(context: WorkspaceContext, approvalId: string | undefined, name: 'k5_artifacts_edit' | 'k5_artifacts_update', input: Record<string, unknown>) {
  if (!approvalId) return;
  return documentTransaction(context, async tx => {
    await assertCapabilityAllowed(context, name, tx);
    const approval = await tx.prepare('SELECT * FROM capability_approval WHERE id=? AND office_id=? AND user_id=? FOR SHARE')
      .get<ApprovalRow>(approvalId, home(context), context.userId);
    if (!approval || approval.capability_name !== name || approval.normalized_input !== canonicalInput(input))
      throw new CapabilityError('FORBIDDEN', 'Esta aprovação não corresponde à edição.');
    if (approval.status !== 'consumed' || !approval.content_result) return;
    const result = approval.content_result as ArtifactRow;
    await assertPolicyAccess(context.userId, await artifactPolicy(context, result.id, tx, result.version), tx);
    return result;
  });
}

export async function documentTransaction<T>(context: WorkspaceContext, action: (tx: Transaction) => Promise<T>) {
  const checked = async (tx: Transaction) => {
    await assertWorkspaceSession(context, tx);
    const result = await action(tx);
    await assertWorkspaceSession(context, tx);
    return result;
  };
  if (context.contentTransaction) return checked(context.contentTransaction);
  return withTransaction(async tx => {
    await tx.prepare("SELECT pg_advisory_xact_lock_shared(hashtextextended('lume:content-acl:' || current_schema(),0))").get();
    context.signal?.throwIfAborted();
    return checked(tx);
  });
}

export async function createPrivateDocument(context: WorkspaceContext, input: { title: string; content: string; id?: string; runId?: string; runLease?: string;
  refs?: unknown[]; issues?: string[]; templateId?: string | null; kind?: 'document' | 'draft' | 'chronology'; sources?: ContentPolicy[]; seedId?: string }) {
  return documentTransaction(context, async tx => {
    await assertCapabilityAllowed(context, 'k5_artifacts_create', tx);
    if (input.runId) {
      const run = await tx.prepare("SELECT id FROM ai_run WHERE id=? AND office_id=? AND user_id=? AND lease_token=? AND status='running' AND lease_until>EXTRACT(EPOCH FROM clock_timestamp())*1000 FOR UPDATE")
        .get(input.runId, home(context), context.userId, input.runLease);
      if (!run) throw new CapabilityError('CONFLICT', 'A execução foi encerrada.');
      const existing = await tx.prepare('SELECT * FROM ai_artifact WHERE run_id=?').get<ArtifactRow>(input.runId);
      if (existing) return existing;
    }
    const id = input.id ?? randomUUID();
    const sources = [...input.sources ?? []];
    if (context.invocation || input.runId) sources.push(await privateGenerationPolicy(context, tx));
    if (input.seedId) {
      const seed = await tx.prepare("SELECT content_policy FROM content_seed WHERE id=? AND office_id=? AND user_id=? AND purpose='artifact'")
        .get<{ content_policy: unknown }>(input.seedId, home(context), context.userId);
      if (!seed) throw new CapabilityError('NOT_FOUND', 'O texto inicial não está disponível.');
      sources.push(parsePolicy(seed.content_policy));
    }
    const policy = combinePolicy(input.title, input.content, sources, context.invocation || input.runId ? 'uncertain' : 'person');
    await assertPolicyAccess(context.userId, policy, tx);
    if (context.invocation || input.runId) await assertSourcesAdmitted(policy, tx);
    const conversation = context.conversationId && await tx.prepare('SELECT 1 FROM ai_conversation WHERE id=? AND office_id=? AND user_id=?')
      .get(context.conversationId, home(context), context.userId) ? context.conversationId : null;
    await tx.prepare(`INSERT INTO ai_artifact(id,office_id,user_id,run_id,title,content,source_refs,validation_issues,status,kind,conversation_id,created_by_agent,template_id,content_policy)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb)`).run(id, home(context), context.userId, input.runId ?? null, input.title, input.content, JSON.stringify(input.refs ?? []), JSON.stringify(input.issues ?? []), input.runId ? 'needs_review' : 'draft', input.kind ?? 'document', conversation, !!context.invocation || !!input.runId, input.templateId ?? null, JSON.stringify(policy));
    await tx.prepare('INSERT INTO ai_artifact_version(artifact_id,version,title,content,user_id,content_policy) VALUES(?,1,?,?,?,?::jsonb)')
      .run(id, input.title, input.content, context.userId, JSON.stringify(policy));
    await tx.prepare('INSERT INTO ai_artifact_policy(artifact_id,version,content_policy) VALUES(?,1,?::jsonb)').run(id, JSON.stringify(policy));
    return (await tx.prepare('SELECT * FROM ai_artifact WHERE id=?').get<ArtifactRow>(id))!;
  });
}

async function preserveUnsampledVersion(tx: Transaction, current: ArtifactRow, policy: ContentPolicy, userId: string) {
  await tx.prepare(`INSERT INTO ai_artifact_version(artifact_id,version,title,content,user_id,content_policy)
    VALUES(?,?,?,?,?,?::jsonb) ON CONFLICT(artifact_id,version) DO NOTHING`).run(current.id, current.version, current.title, current.content, userId, JSON.stringify(policy));
}

export async function updatePrivateDocument(context: WorkspaceContext, input: ArtifactWrite): Promise<ArtifactRow | null> {
  const outcome = await documentTransaction(context, async tx => {
    const name = input.approval?.name ?? 'k5_artifacts_update';
    await assertCapabilityAllowed(context, name, tx);
    let approval: ApprovalRow & { content_policy: unknown } | undefined;
    if (input.approval?.id) {
      approval = await tx.prepare('SELECT * FROM capability_approval WHERE id=? AND office_id=? AND user_id=? FOR UPDATE')
        .get<ApprovalRow & { content_policy: unknown }>(input.approval.id, home(context), context.userId);
      if (!approval || approval.capability_name !== name || approval.normalized_input !== canonicalInput(input.approval.input)) throw new CapabilityError('FORBIDDEN', 'Esta aprovação não corresponde à edição.');
      if (approval.status === 'consumed' && approval.content_result) {
        const result = approval.content_result as ArtifactRow;
        await assertPolicyAccess(context.userId, await artifactPolicy(context, result.id, tx, result.version), tx);
        return { artifact: result };
      }
      if (approval.status !== 'approved') throw new CapabilityError('APPROVAL_REQUIRED', 'Confirme a edição antes de continuar.');
      if (approval.expires_at < Date.now()) throw new CapabilityError('CONFLICT', 'A confirmação expirou.');
    }
    const current = await tx.prepare('SELECT * FROM ai_artifact WHERE id=? AND office_id=? AND user_id=? FOR UPDATE')
      .get<ArtifactRow>(input.id, home(context), context.userId);
    if (!current) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');
    if (current.version !== input.version) return { artifact: null };
    const base = await artifactPolicy(context, current.id, tx);
    const sources = [base];
    if (input.restoreVersion) sources.push(await artifactPolicy(context, current.id, tx, input.restoreVersion));
    if (approval?.content_policy) sources.push(parsePolicy(approval.content_policy));
    else if (context.invocation) sources.push(await privateGenerationPolicy(context, tx));
    const policy = combinePolicy(input.title, input.content, sources, context.invocation ? 'uncertain' : 'person');
    await assertPolicyAccess(context.userId, policy, tx);
    if (context.invocation) await assertSourcesAdmitted(policy, tx);
    if (context.invocation && input.approval && !approval) {
      const proposal = await createApprovalProposal(context, name, input.approval.input, current.id, current.version, 600_000, tx);
      await tx.prepare('UPDATE capability_approval SET content_policy=?::jsonb WHERE id=?').run(JSON.stringify(policy), proposal.id);
      return { proposalId: proposal.id };
    }
    const snapshot = input.snapshot ?? true;
    if (snapshot) await preserveUnsampledVersion(tx, current, base, context.userId);
    await tx.prepare(`INSERT INTO ai_artifact_version(artifact_id,version,title,content,user_id,content_policy)
      SELECT ?,?,?,?,?,?::jsonb WHERE ?::boolean OR NOT EXISTS(SELECT 1 FROM ai_artifact_version WHERE artifact_id=? AND created_at>CURRENT_TIMESTAMP-INTERVAL '5 minutes')`)
      .run(current.id, current.version + 1, input.title, input.content, context.userId, JSON.stringify(policy), snapshot, current.id);
    context.signal?.throwIfAborted();
    await assertCapabilityAllowed(context, name, tx);
    await tx.prepare("UPDATE ai_artifact SET title=?,content=?,version=version+1,status='needs_review',content_policy=?::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=? AND version=?")
      .run(input.title, input.content, JSON.stringify(policy), current.id, current.version);
    await tx.prepare('INSERT INTO ai_artifact_policy(artifact_id,version,content_policy) VALUES(?,?,?::jsonb)').run(current.id, current.version + 1, JSON.stringify(policy));
    const result = { ...current, title: input.title, content: input.content, version: current.version + 1, status: 'needs_review' };
    if (approval) await tx.prepare("UPDATE capability_approval SET status='consumed',consumed_at=CURRENT_TIMESTAMP,content_result=?::jsonb WHERE id=?")
      .run(JSON.stringify(result), approval.id);
    return { artifact: result };
  });
  if ('proposalId' in outcome) throw new CapabilityError('APPROVAL_REQUIRED', `Confira a edição antes de salvar. Proposta registrada [id: ${outcome.proposalId}].`);
  return outcome.artifact;
}
