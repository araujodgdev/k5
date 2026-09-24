import 'server-only';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { database } from '@/lib/database';
import { getDocumentChunks } from '@/lib/vault';
import { selectedResearchSources } from '@/lib/ai-sources';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { WorkspaceContext } from '@/lib/application/context';
import { assertCapabilityAllowed } from '@/lib/application/context';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';

import { embedQuery, EmbeddingUnavailableError } from './embedding-provider';
import { activeGeneration } from './indexing';
import { vectorIndex } from './vector-index';
import { rerank } from '@/lib/typesafe/rerank';

export type SearchKnowledgeResult = CapabilityOutput<'k5_knowledge_search'>;

const RRF_K = 60;
const MAX_TEXT = 4000;

type ScoredSource = {
  sourceId: string;
  documentId: string;
  documentName: string;
  sourceLabel: string;
  text: string;
  score: number;
};

/**
 * Hybrid retrieval over an explicitly authorized scope. Every document id is re-checked against
 * the office before a byte is read, and the vector filter is pushed into the index rather than
 * applied to a global result set afterwards.
 */
export async function searchKnowledgeEngine(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_knowledge_search'>,
): Promise<SearchKnowledgeResult> {
  const { query } = input;
  const limit = input.limit ?? 8;
  const researchReferenceIds = input.researchReferenceIds ?? [];
  if (researchReferenceIds.length && !input.caseId)
    throw new CapabilityError('SCOPE_REQUIRED', 'Selecione o caso das referências.');
  const researchChunks = researchReferenceIds.length
    ? await selectedResearchSources(context, input.caseId!, researchReferenceIds, query) : [];
  const researchOrdered = [
    ...[...new Set(researchReferenceIds)].flatMap(id => researchChunks.find(chunk => chunk.researchReferenceId === id) ?? []),
    ...researchChunks.filter(chunk => !researchReferenceIds.some(id => researchChunks.find(first => first.researchReferenceId === id)?.id === chunk.id)),
  ];
  const researchDto = researchOrdered.map(chunk => ({
    sourceId: chunk.id, sourceLabel: chunk.sourceLabel, text: chunk.text.slice(0, MAX_TEXT),
    sourceType: 'research' as const, researchReferenceId: chunk.researchReferenceId,
    materialVersionId: chunk.materialVersionId, judgmentId: chunk.judgmentId, researchChunkId: chunk.researchChunkId,
  }));
  const coverage = (used: typeof researchDto) => ({ selectedReferences: new Set(researchReferenceIds).size,
    usedReferences: new Set(used.map(item => item.researchReferenceId)).size,
    partial: used.length < researchChunks.length || new Set(used.map(item => item.researchReferenceId)).size < new Set(researchReferenceIds).size });

  /**
   * Without an explicit list the scope is the office's own Cofre — every case and the library —
   * because that is what the assistant is expected to know. It is still an office-scoped read:
   * the ids are selected here, from this office's ready documents, never taken from the caller.
   */
  const documentIds = input.documentIds?.length
    ? input.documentIds
    : researchReferenceIds.length ? []
    : (await database.prepare(
        `SELECT id FROM vault_document
         WHERE office_id = ? AND deleted_at IS NULL AND status = 'ready'${input.caseId ? ' AND case_id = ?' : ''}
         ORDER BY updated_at DESC LIMIT 400`,
      ).all(...(input.caseId ? [context.officeId, input.caseId] : [context.officeId])) as Array<{ id: string }>).map((row) => String(row.id));

  if (!documentIds.length) {
    if (researchDto.length) {
      await assertCapabilityAllowed(context, 'k5_knowledge_search');
      const selected = researchDto.slice(0, limit);
      return { sources: selected, degraded: false, reranking: { status: 'disabled' as const, applied: false },
        researchCoverage: coverage(selected) };
    }
    throw new CapabilityError('SCOPE_REQUIRED', input.documentIds?.length
      ? 'Informe ao menos um documento autorizado no escopo.'
      : 'Não há documentos processados no Cofre deste escritório.');
  }

  const unique = [...new Set(documentIds)];
  const marks = unique.map(() => '?').join(',');
  const validDocs = await database.prepare(
    `SELECT id, original_name AS name, status FROM vault_document WHERE office_id = ? AND deleted_at IS NULL AND id IN (${marks})${input.caseId ? ' AND case_id=?' : ''}`,
  ).all(context.officeId, ...unique, ...(input.caseId ? [input.caseId] : [])) as Array<{ id: string; name: string; status: string }>;

  if (validDocs.length !== unique.length) {
    throw new CapabilityError('NOT_FOUND', 'Um ou mais documentos selecionados não pertencem a este escritório ou foram excluídos.');
  }
  // A document still in extraction has no chunks yet. It is left out of this search instead of
  // failing it, so a fresh upload does not block questions about everything already processed.
  const readyDocs = validDocs.filter((doc) => doc.status === 'ready');
  if (!readyDocs.length) throw new CapabilityError('NOT_READY', `O documento "${validDocs[0].name}" ainda está em processamento.`);
  const readyIds = readyDocs.map((doc) => doc.id);

  const nameMap = new Map(readyDocs.map((doc) => [doc.id, doc.name]));
  const scoreMap = new Map<string, ScoredSource>();

  // 1. Lexical (FTS5/BM25).
  let lexicalChunks: Awaited<ReturnType<typeof getDocumentChunks>> = [];
  try {
    lexicalChunks = await getDocumentChunks(context.officeId, readyIds, query);
  } catch (error) {
    throw new CapabilityError('INVALID', error instanceof Error ? error.message : 'Falha na recuperação lexical.');
  }
  lexicalChunks.forEach((chunk, rank) => {
    scoreMap.set(chunk.id, {
      sourceId: chunk.id,
      documentId: chunk.documentId,
      documentName: nameMap.get(chunk.documentId) ?? 'Documento',
      sourceLabel: chunk.sourceLabel,
      text: chunk.content.slice(0, MAX_TEXT),
      score: 1 / (RRF_K + rank + 1),
    });
  });

  // 2. Semantic. The query is embedded here; the caller never supplies a vector or a filter.
  let degraded = true;
  let strategy = 'lexical';
  let degradedReason: string | undefined;

  const generation = await activeGeneration(context.officeId);
  if (!generation) {
    degradedReason = 'Nenhum índice semântico ativo para este escritório.';
  } else {
    try {
      const { embedding } = await embedQuery(query);
      const hits = await (await vectorIndex()).query(context.officeId, generation.id, embedding, {
        documentIds: readyIds,
        topK: Math.max(limit * 3, 24),
      });

      if (hits.length) {
        const hitIds = hits.map((hit) => hit.chunkId);
        const hitMarks = hitIds.map(() => '?').join(',');
        // Re-read from the business database: the index is derived data and never the authority
        // on what this office may currently see.
        const rows = await database.prepare(
          `SELECT c.id, c.document_id AS documentId, c.stable_reference AS stableReference, c.content
           FROM vault_document_chunk c
           JOIN vault_document d ON d.id = c.document_id AND d.office_id = c.office_id
           WHERE c.office_id = ? AND d.deleted_at IS NULL AND c.id IN (${hitMarks})`,
        ).all(context.officeId, ...hitIds) as Array<{ id: string; documentId: string; stableReference: string; content: string }>;
        const byId = new Map(rows.map((row) => [String(row.id), row]));

        hits.forEach((hit, rank) => {
          const row = byId.get(hit.chunkId);
          if (!row || !nameMap.has(row.documentId)) return;
          const rrf = 1 / (RRF_K + rank + 1);
          const existing = scoreMap.get(hit.chunkId);
          if (existing) { existing.score += rrf; return; }
          const documentName = nameMap.get(row.documentId) ?? 'Documento';
          scoreMap.set(hit.chunkId, {
            sourceId: String(row.id),
            documentId: String(row.documentId),
            documentName,
            sourceLabel: `${documentName} — ${row.stableReference}`,
            text: String(row.content).slice(0, MAX_TEXT),
            score: rrf,
          });
        });

        degraded = false;
        strategy = lexicalChunks.length > 0 ? 'hybrid' : 'vector';
      } else {
        degradedReason = 'Os documentos selecionados ainda não têm vetores publicados.';
      }
    } catch (error) {
      if (error instanceof EmbeddingUnavailableError) degradedReason = error.message;
      else degradedReason = 'A busca semântica falhou; a consulta usou apenas o índice lexical.';
    }
  }

  const candidates = Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(limit, 24))
    .map(({ sourceId, documentId, documentName, sourceLabel, text }) => ({ sourceId, documentId, documentName, sourceLabel, text }));
  // Exclusion/version changes during retrieval must not send obsolete text to another provider.
  const currentCandidates = async () => {
    if (!candidates.length) return new Map<string, string>();
    const ids = candidates.map(source => source.sourceId);
    const fresh = await database.prepare(`SELECT c.id,c.content FROM vault_document_chunk c JOIN vault_document d ON d.id=c.document_id AND d.office_id=c.office_id
      WHERE d.office_id=? AND d.deleted_at IS NULL AND d.status='ready' AND c.id IN (${ids.map(() => '?').join(',')})${input.caseId ? ' AND d.case_id=?' : ''}`)
      .all<{ id: string; content: string }>(context.officeId, ...ids, ...(input.caseId ? [input.caseId] : []));
    return new Map(fresh.map(row => [row.id, row.content.slice(0, MAX_TEXT)]));
  };
  const current = await currentCandidates();
  await assertCapabilityAllowed(context, 'k5_knowledge_search');
  const ranked = await rerank(context, query, candidates.filter(source => current.get(source.sourceId) === source.text), { signal: context.signal });
  await assertCapabilityAllowed(context, 'k5_knowledge_search');
  const after = await currentCandidates();
  const vaultSources = ranked.sources.filter(source => after.get(source.sourceId) === source.text);
  const selectedResearch = researchDto.slice(0, Math.min(limit, researchReferenceIds.length ? Math.max(1, Math.ceil(limit / 2)) : 0));
  const sources = [...vaultSources.slice(0, limit - selectedResearch.length).map(source => ({ ...source, sourceType: 'vault' as const })), ...selectedResearch];

  // The query itself is not retained: a hash identifies repeats without storing what was asked.
  try {
    await database.prepare(`
      INSERT INTO knowledge_retrieval_audit (id, office_id, user_id, query, strategy, degraded, document_count, source_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), context.officeId, context.userId,
      createHash('sha256').update(query).digest('hex').slice(0, 32),
      strategy, degraded ? 1 : 0, unique.length, sources.length,
    );
  } catch {
    // Retrieval audit must never fail the user query.
  }

  return { sources, degraded, reranking: { status: ranked.status, applied: ranked.applied, ...(ranked.reason ? { reason: ranked.reason } : {}) },
    ...(researchReferenceIds.length ? { researchCoverage: coverage(selectedResearch) } : {}),
    ...(degraded && degradedReason ? { degradedReason } : {}) };
}
