import 'server-only';
import { getDocumentChunks } from './vault';
import type { SourceChunk } from './ai-policy';
import { database } from './database';
import type { WorkspaceContext } from './application/context';
import { CapabilityError } from './capabilities/errors';
import { assertResearchCaseAccess } from './research/case-profile';
import { materialSnapshot } from './research/case-material';

export async function selectedSources(officeId: string, documentIds: string[], query?: string): Promise<SourceChunk[]> {
  if (!documentIds.length) return [];
  return (await getDocumentChunks(officeId, documentIds, query)).map(chunk => ({
    id: chunk.id, documentId: chunk.documentId, text: chunk.content, sourceLabel: chunk.sourceLabel, sourceType: 'vault',
  }));
}

/** Only explicitly selected links in this authenticated case enter Lume or a draft. */
export type PinnedResearchReference = { referenceId: string; materialVersionId: string };

async function selectResearchSources(context: WorkspaceContext, caseId: string, referenceIds: string[], query?: string,
  pinned?: PinnedResearchReference[]): Promise<SourceChunk[]> {
  if (!referenceIds.length) return [];
  if (referenceIds.length > 30) throw new CapabilityError('INVALID', 'Selecione até 30 referências.');
  if (context.invocation && (context.allowedResearchCaseId !== caseId ||
    referenceIds.some(id => !context.allowedResearchReferenceIds?.includes(id))))
    throw new CapabilityError('SCOPE_REQUIRED', 'A pessoa precisa selecionar estas referências na conversa.');
  await assertResearchCaseAccess(context, caseId);
  const ids = [...new Set(referenceIds)];
  const rows = await database.prepare(`SELECT id,material_version_id FROM research_case_reference WHERE office_id=? AND case_id=? ${pinned ? '' : 'AND deleted_at IS NULL'}
    AND id IN (${ids.map(() => '?').join(',')})`).all<{ id: string; material_version_id: string }>(context.officeId, caseId, ...ids);
  if (rows.length !== ids.length) throw new CapabilityError('NOT_FOUND', 'Uma referência não pertence a este caso.');
  const byId = new Map(rows.map(row => [row.id, row.material_version_id]));
  const sources: SourceChunk[] = [];
  const perReferenceLimit = Math.max(1, Math.min(20, Math.floor(300 / ids.length)));
  const terms = query?.toLocaleLowerCase('pt-BR').match(/[\p{L}\p{N}]+/gu)?.filter(term => term.length > 2).slice(0, 12) ?? [];
  for (const id of ids) {
    const pinnedVersion = pinned?.find(item => item.referenceId === id)?.materialVersionId;
    if (pinned && !pinnedVersion) throw new CapabilityError('NOT_FOUND', 'A referência fixada não pertence à tarefa.');
    const material = await materialSnapshot(pinnedVersion ?? byId.get(id)!);
    if (!material?.aiAllowed) throw new CapabilityError('NOT_READY', 'Uma referência está indisponível para uso por IA.');
    if (pinnedVersion) {
      const current = await materialSnapshot(byId.get(id)!);
      if (!current || current.materialId !== material.materialId)
        throw new CapabilityError('NOT_FOUND', 'A versão fixada não corresponde à referência original.');
    }
    const chunks = await database.prepare('SELECT id,text_content,reference FROM research_chunk WHERE material_version_id=? ORDER BY ordinal LIMIT 200')
      .all<{ id: string; text_content: string; reference: string }>(material.versionId);
    if (!chunks.length) throw new CapabilityError('NOT_READY', 'O material ainda não tem trechos utilizáveis.');
    const ranked = chunks.map((chunk, index) => ({ chunk, index,
      score: terms.reduce((score, term) => score + Number(chunk.text_content.toLocaleLowerCase('pt-BR').includes(term)), 0) }));
    if (terms.length) ranked.sort((a,b) => b.score - a.score || a.index - b.index);
    for (const { chunk } of ranked.slice(0, perReferenceLimit)) sources.push({
      id: `research:${id}:${chunk.id}`, sourceType: 'research', researchReferenceId: id,
      materialVersionId: material.versionId, judgmentId: material.judgmentId, researchChunkId: chunk.id,
      text: chunk.text_content, sourceLabel: `${material.tribunal} — ${material.title} — ${chunk.reference}`,
    });
  }
  return sources;
}

export function selectedResearchSources(context: WorkspaceContext, caseId: string, referenceIds: string[], query?: string): Promise<SourceChunk[]> {
  return selectResearchSources(context, caseId, referenceIds, query);
}

/** Worker-only resolution of the version selected when the run was queued. */
export function selectedPinnedResearchSources(context: WorkspaceContext, caseId: string, pinned: PinnedResearchReference[], query?: string): Promise<SourceChunk[]> {
  return selectResearchSources(context, caseId, pinned.map(item => item.referenceId), query, pinned);
}

/** A finished artifact resolves the immutable version/chunk it cited, even after its case link changes. */
export async function resolveArtifactResearchSource(context: WorkspaceContext, artifactId: string, sourceRefId: string) {
  const artifact = await database.prepare('SELECT source_refs FROM ai_artifact WHERE id=? AND office_id=? AND user_id=?')
    .get<{ source_refs: string }>(artifactId, context.officeId, context.userId);
  if (!artifact) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');
  const refs = JSON.parse(artifact.source_refs) as Array<{ id: string; sourceType?: string; materialVersionId?: string; researchChunkId?: string }>;
  const ref = refs.find(item => item.id === sourceRefId && item.sourceType === 'research');
  if (!ref?.materialVersionId || !ref.researchChunkId) throw new CapabilityError('NOT_FOUND', 'Fonte não encontrada neste documento.');
  const material = await materialSnapshot(ref.materialVersionId);
  if (!material?.localAllowed) throw new CapabilityError('NOT_READY', 'A fonte deixou de estar disponível no acervo.');
  const chunk = await database.prepare('SELECT id,text_content,reference FROM research_chunk WHERE id=? AND material_version_id=?')
    .get<{ id: string; text_content: string; reference: string }>(ref.researchChunkId, ref.materialVersionId);
  if (!chunk) throw new CapabilityError('NOT_FOUND', 'O trecho fixado não está disponível.');
  return { sourceId: ref.id, materialVersionId: material.versionId, judgmentId: material.judgmentId,
    title: material.title, tribunal: material.tribunal, caseNumber: material.caseNumber, decisionDate: material.decisionDate,
    sourceUrl: material.sourceUrl, reference: chunk.reference, text: chunk.text_content };
}
