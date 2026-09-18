import 'server-only';
import { database } from '@/lib/database';
import { ownedArtifact, publicArtifact, updateArtifact, type ArtifactRow } from '@/lib/ai-store';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';
import type { WorkspaceContext } from './context';

const owner = (context: WorkspaceContext) => ({ officeId: context.officeId, userId: context.userId });

function requireArtifact(context: WorkspaceContext, artifactId: string): ArtifactRow {
  const artifact = ownedArtifact(database, owner(context), artifactId);
  if (!artifact) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');
  return artifact;
}

/** The stored references keep source ids and quotes; the agent gets the text and the open issues. */
function view(row: ArtifactRow): CapabilityOutput<'k5_artifacts_get'>['artifact'] {
  const artifact = publicArtifact(row);
  const issues = Array.isArray(artifact.validationIssues) ? artifact.validationIssues.map((issue: unknown) => String(issue)) : [];
  return { id: artifact.id, title: artifact.title, content: artifact.content, version: artifact.version, status: artifact.status, validationIssues: issues };
}

export function getArtifact(context: WorkspaceContext, input: CapabilityInput<'k5_artifacts_get'>): CapabilityOutput<'k5_artifacts_get'> {
  return { artifact: view(requireArtifact(context, input.artifactId)) };
}

export function saveArtifact(context: WorkspaceContext, input: CapabilityInput<'k5_artifacts_update'>): CapabilityOutput<'k5_artifacts_update'> {
  requireArtifact(context, input.artifactId);
  const updated = updateArtifact(database, owner(context), input.artifactId, input.title, input.content, input.version);
  if (!updated) throw new CapabilityError('CONFLICT', 'O documento mudou desde a leitura. Leia a versão atual antes de salvar.');
  return { artifact: view(updated) };
}

export function listArtifactVersions(context: WorkspaceContext, input: CapabilityInput<'k5_artifacts_list_versions'>): CapabilityOutput<'k5_artifacts_list_versions'> {
  requireArtifact(context, input.artifactId);
  const rows = database.prepare(
    'SELECT version, title, created_at AS createdAt FROM ai_artifact_version WHERE artifact_id=? AND user_id=? ORDER BY version DESC'
  ).all(input.artifactId, context.userId) as Array<{ version: number; title: string; createdAt: string }>;

  return { versions: rows };
}

export function restoreArtifactVersion(context: WorkspaceContext, input: CapabilityInput<'k5_artifacts_restore_version'>): CapabilityOutput<'k5_artifacts_restore_version'> {
  const current = requireArtifact(context, input.artifactId);

  const historical = database.prepare(
    'SELECT title, content FROM ai_artifact_version WHERE artifact_id=? AND version=? AND user_id=?'
  ).get(input.artifactId, input.version, context.userId) as { title: string; content: string } | undefined;

  if (!historical) throw new CapabilityError('NOT_FOUND', 'Versão histórica não encontrada.');

  const updated = updateArtifact(database, owner(context), input.artifactId, historical.title, historical.content, current.version);
  if (!updated) throw new CapabilityError('CONFLICT', 'Conflito de versão ao restaurar.');

  return { artifact: view(updated) };
}

export function exportArtifactDocx(context: WorkspaceContext, input: CapabilityInput<'k5_artifacts_export_docx'>): CapabilityOutput<'k5_artifacts_export_docx'> {
  const artifact = requireArtifact(context, input.artifactId);
  return {
    downloadUrl: `/api/artifacts/${encodeURIComponent(artifact.id)}/export`,
    fileName: `${artifact.title || 'documento'}.docx`,
  };
}
