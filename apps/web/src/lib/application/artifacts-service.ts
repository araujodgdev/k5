import 'server-only';
import { artifactPolicy, assertPolicyAccess, exposeContent, type ContentPolicy } from '@/lib/content-policy';
import { consumedArtifactResult, createPrivateDocument, updatePrivateDocument } from '@/lib/documents/service';
import { database } from '@/lib/database';
import { applyEdits, editFailureMessage } from '@/lib/artifact-edits';
import { reviewArtifactCitations } from '@/lib/citations/artifact-review';
import { ownedArtifact, publicArtifact, type ArtifactRow } from '@/lib/ai-store';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';
import type { WorkspaceContext } from './context';

const owner = (context: WorkspaceContext) => ({ officeId: context.officeId, userId: context.userId });


async function requireArtifact(context: WorkspaceContext, artifactId: string): Promise<ArtifactRow> {
  const artifact = await ownedArtifact(database, owner(context), artifactId);
  if (!artifact) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');
  await assertPolicyAccess(context.userId, await artifactPolicy(context, artifactId));
  return artifact;
}

/** The stored references keep source ids and quotes; the agent gets the text and the open issues. */
function view(row: ArtifactRow): CapabilityOutput<'k5_artifacts_get'>['artifact'] {
  const artifact = publicArtifact(row);
  const issues = Array.isArray(artifact.validationIssues) ? artifact.validationIssues.map((issue: unknown) => String(issue)) : [];
  return { id: artifact.id, title: artifact.title, content: artifact.content, version: artifact.version, status: artifact.status, validationIssues: issues };
}

export async function getArtifact(context: WorkspaceContext, input: CapabilityInput<'k5_artifacts_get'>): Promise<CapabilityOutput<'k5_artifacts_get'>> {
  return { artifact: view(await requireArtifact(context, input.artifactId)) };
}

export async function saveArtifact(context: WorkspaceContext, input: CapabilityInput<'k5_artifacts_update'>): Promise<CapabilityOutput<'k5_artifacts_update'>> {
  const replay = await consumedArtifactResult(context, input.approvalId, 'k5_artifacts_update', { artifactId: input.artifactId, title: input.title, content: input.content, version: input.version });
  if (replay) return exposeContent({ artifact: view(replay) }, [await artifactPolicy(context, replay.id, database, replay.version)]);
  const updated = await updatePrivateDocument(context, { id: input.artifactId, title: input.title, content: input.content, version: input.version,
    approval: { id: input.approvalId, name: 'k5_artifacts_update', input: { artifactId: input.artifactId, title: input.title, content: input.content, version: input.version } } });
  if (!updated) throw new CapabilityError('CONFLICT', 'O documento mudou desde a leitura. Leia a versão atual antes de salvar.');
  return { artifact: view(updated), ...await checkAgentWrite(context, updated) };
}

/**
 * The agent writes freely; the lawyer reviews what it delivers. After each write by the agent, its
 * citations are checked against what the conversation consulted, and the result rides back to the
 * agent so it can tell the person what to review.
 */
async function checkAgentWrite(context: WorkspaceContext, row: ArtifactRow) {
  if (!context.invocation) return {};
  return { citations: await reviewArtifactCitations(context, row, { conversationId: context.conversationId, signal: context.signal }) };
}

type SummaryRow = { id: string; title: string; version: number; kind: 'draft' | 'chronology' | 'document'; updatedAt: string; conversationId: string | null };
const summaryColumns = 'id, title, version, kind, updated_at AS "updatedAt", conversation_id AS "conversationId"';

/** A document written in the conversation. It starts as the agent's, so the agent may keep refining it. */
export async function createArtifact(context: WorkspaceContext, input: CapabilityInput<'k5_artifacts_create'>): Promise<CapabilityOutput<'k5_artifacts_create'>> {
  const created = await createPrivateDocument(context, input);
  return { artifact: view(created), ...await checkAgentWrite(context, created) };
}

/**
 * Targeted edits. The agent refines its own document from this conversation without asking; any
 * other document is the person's work, and changing it goes through the Confirmar button.
 */
export async function editArtifact(context: WorkspaceContext, input: CapabilityInput<'k5_artifacts_edit'>): Promise<CapabilityOutput<'k5_artifacts_edit'>> {
  const replay = await consumedArtifactResult(context, input.approvalId, 'k5_artifacts_edit', { artifactId: input.artifactId, version: input.version, edits: input.edits, title: input.title });
  if (replay) return exposeContent({ artifact: view(replay) }, [await artifactPolicy(context, replay.id, database, replay.version)]);
  const current = await requireArtifact(context, input.artifactId);
  const own = current.created_by_agent && !!current.conversation_id && current.conversation_id === context.conversationId;
  const applied = current.version === input.version ? applyEdits(current.content, input.edits) : { content: '' };
  if ('failure' in applied) throw new CapabilityError('INVALID', editFailureMessage(applied.failure));
  const updated = await updatePrivateDocument(context, { id: input.artifactId, title: input.title ?? current.title, content: applied.content, version: input.version,
    ...(!own || input.approvalId ? { approval: { id: input.approvalId, name: 'k5_artifacts_edit' as const,
      input: { artifactId: input.artifactId, version: input.version, edits: input.edits, title: input.title } } } : {}) });
  if (!updated) throw new CapabilityError('CONFLICT', 'O documento mudou durante a edição. Leia a versão atual antes de editar.');
  return { artifact: view(updated), ...await checkAgentWrite(context, updated) };
}

/** This conversation's documents first, then the person's most recent ones. */
export async function listArtifacts(context: WorkspaceContext, input: CapabilityInput<'k5_artifacts_list'>): Promise<CapabilityOutput<'k5_artifacts_list'>> {
  const inConversation = context.conversationId
    ? await database.prepare(`SELECT ${summaryColumns} FROM ai_artifact WHERE office_id=? AND user_id=? AND conversation_id=? ORDER BY updated_at DESC LIMIT ?`)
      .all(context.officeId, context.userId, context.conversationId, input.limit) as SummaryRow[]
    : [];
  const recent = await database.prepare(`SELECT ${summaryColumns} FROM ai_artifact WHERE office_id=? AND user_id=? ORDER BY updated_at DESC LIMIT ?`)
    .all(context.officeId, context.userId, input.limit) as SummaryRow[];
  const rows = [...inConversation, ...recent.filter(row => !inConversation.some(item => item.id === row.id))].slice(0, input.limit);
  const visible: SummaryRow[] = [];
  const policies: ContentPolicy[] = [];
  for (const row of rows) {
    try { const policy = await artifactPolicy(context, row.id, database, row.version); await assertPolicyAccess(context.userId, policy); visible.push(row); policies.push(policy); }
    catch (error) { if (!(error instanceof CapabilityError && error.code === 'NOT_FOUND')) throw error; }
  }
  return exposeContent({ artifacts: visible.map(({ conversationId, ...row }) => ({ ...row, inThisConversation: !!conversationId && conversationId === context.conversationId })) }, policies);
}

export async function listArtifactVersions(context: WorkspaceContext, input: CapabilityInput<'k5_artifacts_list_versions'>): Promise<CapabilityOutput<'k5_artifacts_list_versions'>> {
  if (!await database.prepare('SELECT 1 FROM ai_artifact WHERE id=? AND office_id=? AND user_id=?')
    .get(input.artifactId, context.caseScope?.homeOfficeId ?? context.officeId, context.userId))
    throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');
  const rows = await database.prepare(
    'SELECT version, title, created_at AS createdAt FROM ai_artifact_version WHERE artifact_id=? AND user_id=? ORDER BY version DESC'
  ).all(input.artifactId, context.userId) as Array<{ version: number; title: string; createdAt: string }>;

  const visible = [];
  const policies: ContentPolicy[] = [];
  for (const row of rows) {
    try { const policy = await artifactPolicy(context, input.artifactId, database, row.version); await assertPolicyAccess(context.userId, policy); visible.push(row); policies.push(policy); }
    catch (error) { if (!(error instanceof CapabilityError && error.code === 'NOT_FOUND')) throw error; }
  }
  return exposeContent({ versions: visible }, policies);
}

export async function restoreArtifactVersion(context: WorkspaceContext, input: CapabilityInput<'k5_artifacts_restore_version'>): Promise<CapabilityOutput<'k5_artifacts_restore_version'>> {
  const current = await requireArtifact(context, input.artifactId);

  const historical = await database.prepare(
    'SELECT title, content FROM ai_artifact_version WHERE artifact_id=? AND version=? AND user_id=?'
  ).get(input.artifactId, input.version, context.userId) as { title: string; content: string } | undefined;

  if (!historical) throw new CapabilityError('NOT_FOUND', 'Versão histórica não encontrada.');

  const updated = await updatePrivateDocument(context, { id: input.artifactId, title: historical.title, content: historical.content, version: current.version, restoreVersion: input.version });
  if (!updated) throw new CapabilityError('CONFLICT', 'Conflito de versão ao restaurar.');

  return { artifact: view(updated) };
}

export async function exportArtifactDocx(context: WorkspaceContext, input: CapabilityInput<'k5_artifacts_export_docx'>): Promise<CapabilityOutput<'k5_artifacts_export_docx'>> {
  const artifact = await requireArtifact(context, input.artifactId);
  return {
    downloadUrl: `/api/artifacts/${encodeURIComponent(artifact.id)}/export`,
    fileName: `${artifact.title || 'documento'}.docx`,
  };
}

export async function exportArtifactPdf(context: WorkspaceContext, input: CapabilityInput<'k5_artifacts_export_pdf'>): Promise<CapabilityOutput<'k5_artifacts_export_pdf'>> {
  const artifact = await requireArtifact(context, input.artifactId);
  if (artifact.version !== input.version) throw new CapabilityError('CONFLICT', 'O documento mudou. Leia a versão atual antes de exportar.');
  return { downloadUrl: `/api/artifacts/${encodeURIComponent(artifact.id)}/export?format=pdf&engine=pdfcn&version=${artifact.version}`, fileName: `${artifact.title || 'documento'}.pdf`, version: artifact.version };
}
