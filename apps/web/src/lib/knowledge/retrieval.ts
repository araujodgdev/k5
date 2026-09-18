import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import { getDocumentChunks } from '@/lib/vault';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { WorkspaceContext } from '@/lib/application/context';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';

import { cosineSimilarity, parseEmbedding } from './embedding';

export type SearchKnowledgeResult = CapabilityOutput<'k5_knowledge_search'>;

export function searchKnowledgeEngine(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_knowledge_search'>,
): SearchKnowledgeResult {
  const { query, documentIds, limit = 8, queryVector } = input;
  if (!documentIds.length) {
    throw new CapabilityError('SCOPE_REQUIRED', 'Informe ao menos um documento autorizado no escopo.');
  }

  // Authorize documents: must belong to context.officeId and not be deleted
  const marks = documentIds.map(() => '?').join(',');
  const validDocs = database.prepare(
    `SELECT id, original_name AS name, status FROM vault_document WHERE office_id=? AND deleted_at IS NULL AND id IN (${marks})`
  ).all(context.officeId, ...documentIds) as Array<{ id: string; name: string; status: string }>;

  if (validDocs.length !== documentIds.length) {
    throw new CapabilityError('NOT_FOUND', 'Um ou mais documentos selecionados não pertencem a este escritório ou foram excluídos.');
  }

  const notReady = validDocs.find(d => d.status !== 'ready');
  if (notReady) {
    throw new CapabilityError('NOT_READY', `O documento "${notReady.name}" ainda está em processamento.`);
  }

  // 1. Lexical retrieval via FTS5
  let lexicalChunks: ReturnType<typeof getDocumentChunks> = [];
  try {
    lexicalChunks = getDocumentChunks(context.officeId, documentIds, query);
  } catch (err) {
    throw new CapabilityError('INVALID', err instanceof Error ? err.message : 'Falha na recuperação lexical.');
  }

  // 2. Semantic vector retrieval if active generation exists and queryVector is provided
  const activeGen = database.prepare(
    "SELECT id, model_id, dimension FROM knowledge_index_generation WHERE office_id=? AND status='active' ORDER BY created_at DESC LIMIT 1"
  ).get(context.officeId) as { id: string; model_id: string; dimension: number } | undefined;

  let isDegraded = true;
  let strategy = 'lexical';

  type ScoredSource = {
    sourceId: string;
    documentId: string;
    documentName: string;
    sourceLabel: string;
    text: string;
    score: number;
  };

  const nameMap = new Map(validDocs.map(d => [d.id, d.name]));
  const scoreMap = new Map<string, ScoredSource>();

  // Assign RRF score for lexical chunks
  lexicalChunks.forEach((chunk, rank) => {
    const rrf = 1 / (60 + rank + 1);
    scoreMap.set(chunk.id, {
      sourceId: chunk.id,
      documentId: chunk.documentId,
      documentName: nameMap.get(chunk.documentId) ?? 'Documento',
      sourceLabel: chunk.sourceLabel,
      text: chunk.content.slice(0, 4000),
      score: rrf,
    });
  });

  if (activeGen && queryVector && queryVector.length === activeGen.dimension) {
    // Look for vector embeddings in this generation for the selected documents
    const vectorRows = database.prepare(
      `SELECT v.chunk_id, v.embedding, c.document_id, c.stable_reference, c.content
       FROM vault_document_chunk_vector v
       JOIN vault_document_chunk c ON c.id = v.chunk_id
       WHERE v.office_id=? AND v.generation_id=? AND c.document_id IN (${marks})`
    ).all(context.officeId, activeGen.id, ...documentIds) as Array<{
      chunk_id: string;
      embedding: string;
      document_id: string;
      stable_reference: string;
      content: string;
    }>;

    const scoredVectors: Array<{ row: typeof vectorRows[0]; sim: number }> = [];
    for (const vRow of vectorRows) {
      const emb = parseEmbedding(vRow.embedding);
      const sim = cosineSimilarity(queryVector, emb);
      if (sim > 0) {
        scoredVectors.push({ row: vRow, sim });
      }
    }

    scoredVectors.sort((a, b) => b.sim - a.sim);

    scoredVectors.forEach((item, vRank) => {
      const vRrf = 1 / (60 + vRank + 1);
      const existing = scoreMap.get(item.row.chunk_id);
      if (existing) {
        existing.score += vRrf;
      } else {
        scoreMap.set(item.row.chunk_id, {
          sourceId: item.row.chunk_id,
          documentId: item.row.document_id,
          documentName: nameMap.get(item.row.document_id) ?? 'Documento',
          sourceLabel: `${nameMap.get(item.row.document_id) ?? 'Documento'} — ${item.row.stable_reference}`,
          text: item.row.content.slice(0, 4000),
          score: vRrf,
        });
      }
    });

    if (scoredVectors.length > 0) {
      isDegraded = false;
      strategy = lexicalChunks.length > 0 ? 'hybrid' : 'vector';
    }
  }

  const sortedSources = Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ sourceId, documentId, documentName, sourceLabel, text }) => ({
      sourceId,
      documentId,
      documentName,
      sourceLabel,
      text,
    }));

  // Audit search
  try {
    database.prepare(`
      INSERT INTO knowledge_retrieval_audit (id, office_id, user_id, query, strategy, degraded, document_count, source_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      context.officeId,
      context.userId,
      query,
      strategy,
      isDegraded ? 1 : 0,
      documentIds.length,
      sortedSources.length,
    );
  } catch {
    // Retrieval audit should never fail the user query
  }

  return {
    sources: sortedSources,
    degraded: isDegraded,
  };
}
