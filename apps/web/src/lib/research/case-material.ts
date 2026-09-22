import 'server-only';
import { database, type Database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import { toInstallationRef } from '@/lib/judicial/repositories/installations';
import { canUseResearchSource } from './policy';

export type MaterialSnapshot = {
  versionId: string; materialId: string; judgmentId: string; kind: 'ementa' | 'full_text';
  materialStatus: string; judgmentStatus: string; currentVersionId: string | null;
  sha256: string; parserVersion: string; metadataRevision: number; judgmentMetadataRevision: number; citationMetadata: Record<string, unknown>;
  title: string; tribunal: string; courtUnit: string | null; caseNumber: string | null; decisionDate: string | null;
  sourceUrl: string | null; installationId: string; installationFingerprint: unknown;
  text: string; chunks: Array<{ id: string; text: string; reference: string }>;
  localAllowed: boolean; aiAllowed: boolean;
};

/** A pinned version, not the current version pointer, is the authority for case references. */
export async function materialSnapshot(versionId: string, db: Database = database): Promise<MaterialSnapshot | null> {
  const row = await db.prepare(`SELECT v.id AS version_id,v.material_id,v.sha256,v.parser_version,v.metadata_revision,v.citation_metadata_json,v.text_content,v.published_at,
    m.kind,m.status AS material_status,m.current_version_id,j.id AS judgment_id,j.status AS judgment_status,
    j.title,j.tribunal,j.court_unit,j.case_number,j.decision_date,j.source_url,j.installation_id,j.metadata_revision AS judgment_metadata_revision
    FROM research_material_version v JOIN research_material m ON m.id=v.material_id
    JOIN research_judgment j ON j.id=m.judgment_id WHERE v.id=?`).get<{
      version_id: string; material_id: string; sha256: string; parser_version: string; metadata_revision: number;
      citation_metadata_json: string; text_content: string | null; published_at: string | null; kind: 'ementa' | 'full_text'; material_status: string;
      current_version_id: string | null; judgment_id: string; judgment_status: string; title: string; tribunal: string;
      court_unit: string | null; case_number: string | null; decision_date: string | null; source_url: string | null; installation_id: string; judgment_metadata_revision: number;
    }>(versionId);
  if (!row) return null;
  const installationRow = await db.prepare('SELECT * FROM judicial_source_installation WHERE id=?').get(row.installation_id);
  const installation = installationRow ? toInstallationRef(installationRow as Parameters<typeof toInstallationRef>[0]) : undefined;
  const localAllowed = !!installation && row.judgment_status === 'active' && row.material_status !== 'restricted' && !!row.published_at
    && canUseResearchSource(installation, 'local_read') && (row.kind !== 'full_text' || installation.permissions.documents === 'permitido');
  const aiAllowed = localAllowed && !!installation && canUseResearchSource(installation, 'send_to_ai');
  const chunks = await db.prepare('SELECT id,text_content AS text,reference FROM research_chunk WHERE material_version_id=? ORDER BY ordinal LIMIT 80')
    .all<{ id: string; text: string; reference: string }>(versionId);
  const installationFingerprint = installation ? {
    id: installation.id, enabled: installation.enabled, status: installation.discoveryStatus,
    permissions: installation.permissions, contract: installation.contractVersion,
  } : null;
  const citationMetadata = JSON.parse(row.citation_metadata_json) as Record<string, unknown>;
  const historical = (key: string, current: string | null) => Object.hasOwn(citationMetadata, key)
    ? (typeof citationMetadata[key] === 'string' ? citationMetadata[key] as string : null) : current;
  return {
    versionId, materialId: row.material_id, judgmentId: row.judgment_id, kind: row.kind,
    materialStatus: row.material_status, judgmentStatus: row.judgment_status, currentVersionId: row.current_version_id,
    sha256: row.sha256, parserVersion: row.parser_version, metadataRevision: row.metadata_revision,
    judgmentMetadataRevision: row.judgment_metadata_revision, citationMetadata,
    title: historical('title', row.title) ?? row.title, tribunal: historical('tribunal', row.tribunal) ?? row.tribunal,
    courtUnit: historical('courtUnit', row.court_unit), caseNumber: historical('caseNumber', row.case_number),
    decisionDate: historical('decisionDate', row.decision_date), sourceUrl: historical('sourceUrl', row.source_url),
    installationId: row.installation_id, installationFingerprint,
    text: row.text_content ?? chunks.map(chunk => chunk.text).join('\n'), chunks, localAllowed, aiAllowed,
  };
}

export async function requireMaterialSnapshot(versionId: string, db: Database = database) {
  const material = await materialSnapshot(versionId, db);
  if (!material) throw new CapabilityError('NOT_FOUND', 'Material não encontrado.');
  if (!material.localAllowed) throw new CapabilityError('NOT_READY', 'Este material não está disponível no acervo.');
  return material;
}
