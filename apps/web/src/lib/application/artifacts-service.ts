import 'server-only';
import { database } from '@/lib/database';
import { ownedArtifact, publicArtifact, updateArtifact, type ArtifactRow } from '@/lib/ai-store';
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
  await requireArtifact(context, input.artifactId);
  const updated = await updateArtifact(database, owner(context), input.artifactId, input.title, input.content, input.version);
  if (!updated) throw new CapabilityError('CONFLICT', 'O documento mudou desde a leitura. Leia a versão atual antes de salvar.');
  return { artifact: view(updated) };
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
