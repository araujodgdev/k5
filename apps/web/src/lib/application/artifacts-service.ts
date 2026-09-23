import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import { applyEdits, editFailureMessage, PENDING_LEGAL_ISSUE, withoutUnapprovedCitations } from '@/lib/artifact-edits';
import { ownedArtifact, publicArtifact, updateArtifact, type ArtifactRow } from '@/lib/ai-store';
import { requireAgentApproval } from './approvals-service';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';
import type { WorkspaceContext } from './context';

const owner = (context: WorkspaceContext) => ({ officeId: context.officeId, userId: context.userId });

async function requireArtifact(context: WorkspaceContext, artifactId: string): Promise<ArtifactRow> {
  const artifact = await ownedArtifact(database, owner(context), artifactId);
  if (!artifact) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');
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
  const current = await requireArtifact(context, input.artifactId);
  await requireAgentApproval(context, 'k5_artifacts_update', input.approvalId,
    { artifactId: input.artifactId, title: input.title, content: input.content, version: input.version }, input.artifactId, 'Sobrescrever uma minuta pede confirmação.');
  // The agent's full rewrite passes the same citation guard as its targeted edits.
  const guarded = context.invocation ? withoutUnapprovedCitations(input.content, current.content) : { text: input.content, blocked: 0 };
  const updated = await updateArtifact(database, owner(context), input.artifactId, input.title, guarded.text, input.version);
  if (!updated) throw new CapabilityError('CONFLICT', 'O documento mudou desde a leitura. Leia a versão atual antes de salvar.');
  if (!guarded.blocked) return { artifact: view(updated) };
  await flagPendingLegal(context, updated);
  return { artifact: view(await requireArtifact(context, input.artifactId)) };
}

type SummaryRow = { id: string; title: string; version: number; kind: 'draft' | 'chronology' | 'document'; updatedAt: string; conversationId: string | null };
const summaryColumns = 'id, title, version, kind, updated_at AS "updatedAt", conversation_id AS "conversationId"';

/** A document written in the conversation. It starts as the agent's, so the agent may keep refining it. */
export async function createArtifact(context: WorkspaceContext, input: CapabilityInput<'k5_artifacts_create'>): Promise<CapabilityOutput<'k5_artifacts_create'>> {
  // The conversation comes from the chat request that built this context, never from the model.
  const conversationId = context.conversationId && await database.prepare('SELECT 1 FROM ai_conversation WHERE id=? AND office_id=? AND user_id=?')
    .get(context.conversationId, context.officeId, context.userId) ? context.conversationId : null;
  const guarded = withoutUnapprovedCitations(input.content);
  const issues = guarded.blocked ? [PENDING_LEGAL_ISSUE] : [];
  const id = randomUUID();
  await database.batch([
    database.prepare(`INSERT INTO ai_artifact(id,office_id,user_id,run_id,title,content,source_refs,validation_issues,status,kind,conversation_id,created_by_agent)
      VALUES(?,?,?,NULL,?,?,'[]',?,'draft','document',?,?)`)
      .bind(id, context.officeId, context.userId, input.title, guarded.text, JSON.stringify(issues), conversationId, context.invocation === 'agent'),
    database.prepare('INSERT INTO ai_artifact_version(artifact_id,version,title,content,user_id) VALUES(?,1,?,?,?)')
      .bind(id, input.title, guarded.text, context.userId),
  ]);
  return { artifact: view(await requireArtifact(context, id)) };
}

/**
 * Targeted edits. The agent refines its own document from this conversation without asking; any
 * other document is the person's work, and changing it goes through the Confirmar button.
 */
export async function editArtifact(context: WorkspaceContext, input: CapabilityInput<'k5_artifacts_edit'>): Promise<CapabilityOutput<'k5_artifacts_edit'>> {
  const current = await requireArtifact(context, input.artifactId);
  if (current.version !== input.version) throw new CapabilityError('CONFLICT', `O documento está na versão ${current.version}. Leia a versão atual antes de editar.`);
  const own = current.created_by_agent && !!current.conversation_id && current.conversation_id === context.conversationId;
  if (!own) {
    await requireAgentApproval(context, 'k5_artifacts_edit', input.approvalId,
      { artifactId: input.artifactId, version: input.version, edits: input.edits, title: input.title }, input.artifactId,
      'Alterar um documento que não foi criado nesta conversa pede confirmação.');
  }
  const applied = applyEdits(current.content, input.edits);
  if ('failure' in applied) throw new CapabilityError('INVALID', editFailureMessage(applied.failure));
  const guarded = withoutUnapprovedCitations(applied.content, current.content);
  const updated = await updateArtifact(database, owner(context), input.artifactId, input.title ?? current.title, guarded.text, input.version);
  if (!updated) throw new CapabilityError('CONFLICT', 'O documento mudou durante a edição. Leia a versão atual antes de editar.');
  if (guarded.blocked) await flagPendingLegal(context, updated);
  return { artifact: view(await requireArtifact(context, input.artifactId)) };
}

async function flagPendingLegal(context: WorkspaceContext, row: ArtifactRow) {
  const issues = JSON.parse(row.validation_issues) as unknown[];
  if (issues.includes(PENDING_LEGAL_ISSUE)) return;
  await database.prepare('UPDATE ai_artifact SET validation_issues=? WHERE id=? AND office_id=? AND user_id=?')
    .run(JSON.stringify([...issues, PENDING_LEGAL_ISSUE]), row.id, context.officeId, context.userId);
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
  return { artifacts: rows.map(({ conversationId, ...row }) => ({ ...row, inThisConversation: !!conversationId && conversationId === context.conversationId })) };
}

export async function listArtifactVersions(context: WorkspaceContext, input: CapabilityInput<'k5_artifacts_list_versions'>): Promise<CapabilityOutput<'k5_artifacts_list_versions'>> {
  await requireArtifact(context, input.artifactId);
  const rows = await database.prepare(
    'SELECT version, title, created_at AS createdAt FROM ai_artifact_version WHERE artifact_id=? AND user_id=? ORDER BY version DESC'
  ).all(input.artifactId, context.userId) as Array<{ version: number; title: string; createdAt: string }>;

  return { versions: rows };
}

export async function restoreArtifactVersion(context: WorkspaceContext, input: CapabilityInput<'k5_artifacts_restore_version'>): Promise<CapabilityOutput<'k5_artifacts_restore_version'>> {
  const current = await requireArtifact(context, input.artifactId);

  const historical = await database.prepare(
    'SELECT title, content FROM ai_artifact_version WHERE artifact_id=? AND version=? AND user_id=?'
  ).get(input.artifactId, input.version, context.userId) as { title: string; content: string } | undefined;

  if (!historical) throw new CapabilityError('NOT_FOUND', 'Versão histórica não encontrada.');

  const updated = await updateArtifact(database, owner(context), input.artifactId, historical.title, historical.content, current.version);
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
