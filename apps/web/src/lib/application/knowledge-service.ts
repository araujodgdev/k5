import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import { findVaultDocument } from '@/lib/vault';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';
import type { WorkspaceContext } from './context';
import { searchKnowledgeEngine } from '@/lib/knowledge/retrieval';
import { activeGeneration, enqueueIndexJob } from '@/lib/knowledge/indexing';

export async function searchKnowledge(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_knowledge_search'>
): Promise<CapabilityOutput<'k5_knowledge_search'>> {
  return searchKnowledgeEngine(context, input);
}

export async function getKnowledgeSource(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_knowledge_get_source'>
): Promise<CapabilityOutput<'k5_knowledge_get_source'>> {
  const doc = await findVaultDocument(context.officeId, input.documentId);
  if (!doc) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');

  const targetChunk = await database.prepare(
    'SELECT * FROM vault_document_chunk WHERE office_id=? AND document_id=? AND stable_reference=?'
  ).get(context.officeId, input.documentId, input.stableReference) as {
    id: string;
    ordinal: number;
    stable_reference: string;
    content: string;
  } | undefined;

  if (!targetChunk) {
    throw new CapabilityError('NOT_FOUND', `Trecho com referência "${input.stableReference}" não foi encontrado.`);
  }

  // Fetch bounded adjacent context (one ordinal before and one ordinal after)
  const adjacentRows = await database.prepare(
    `SELECT stable_reference, content FROM vault_document_chunk
     WHERE office_id=? AND document_id=? AND ordinal IN (?, ?) ORDER BY ordinal`
  ).all(context.officeId, input.documentId, targetChunk.ordinal - 1, targetChunk.ordinal + 1) as Array<{
    stable_reference: string;
    content: string;
  }>;

  const adjacentContext = adjacentRows.map(r => `[${r.stable_reference}]\n${r.content}`).join('\n---\n').slice(0, 4000);

  return {
    source: {
      sourceId: targetChunk.id,
      documentId: doc.id,
      documentName: doc.name,
      sourceLabel: `${doc.name} — ${targetChunk.stable_reference}`,
      text: targetChunk.content.slice(0, 4000),
      adjacentContext: adjacentContext || undefined,
    },
  };
}

export async function getKnowledgeIndexStatus(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_knowledge_get_index_status'>
): Promise<CapabilityOutput<'k5_knowledge_get_index_status'>> {
  const doc = await findVaultDocument(context.officeId, input.documentId);
  if (!doc) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');

  const generation = await activeGeneration(context.officeId);

  let vectorIndexed = false;
  if (generation) {
    const count = Number((await database.prepare(
      'SELECT count(*) AS n FROM vault_document_chunk_vector WHERE office_id=? AND document_id=? AND generation_id=?'
    ).get(context.officeId, doc.id, generation.id))?.n ?? 0);
    vectorIndexed = count > 0;
  }

  const job = await database.prepare(
    'SELECT status, chunks_done AS done, chunks_total AS total, error FROM knowledge_index_job WHERE office_id=? AND document_id=? ORDER BY updated_at DESC LIMIT 1'
  ).get(context.officeId, input.documentId) as { status: string; done: number; total: number; error: string | null } | undefined;

  // Extraction and semantic indexing are distinct states: a document can be searchable lexically
  // while its vectors are still pending, and saying so is the point of reporting them apart.
  return {
    documentId: doc.id,
    status: doc.status,
    extractionStatus: doc.status === 'ready' ? 'concluída' : doc.status,
    indexingStatus: job?.status ?? (generation ? 'não enfileirado' : 'sem perfil de embedding'),
    indexedChunks: Number(job?.done ?? 0),
    totalChunks: Number(job?.total ?? doc.sourceCount ?? 0),
    vectorIndexed,
    generationId: generation?.id ?? null,
  };
}

/**
 * Actually enqueues durable work. Returning `enqueued: true` after creating a row and scheduling
 * nothing is a false success: the caller is told indexing will happen and it never does.
 */
export async function reindexKnowledge(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_knowledge_reindex'>
): Promise<CapabilityOutput<'k5_knowledge_reindex'>> {
  const doc = await findVaultDocument(context.officeId, input.documentId);
  if (!doc) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');
  if (doc.status !== 'ready') throw new CapabilityError('NOT_READY', `O documento "${doc.name}" ainda está em processamento.`);

  // Extraction is not redone: the chunks already exist and only the embeddings are recomputed.
  const queued = await enqueueIndexJob(context.officeId, input.documentId);
  if (!queued) {
    throw new CapabilityError(
      'NOT_READY',
      'Nenhum modelo de embedding está configurado para este escritório. Configure o perfil de embedding antes de reindexar.'
    );
  }

  return {
    enqueued: true,
    message: `Reindexação semântica do documento "${doc.name}" enfileirada.`,
    generationId: queued.generationId,
  };
}

export async function setScopeSources(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_context_set_sources'>
): Promise<CapabilityOutput<'k5_context_set_sources'>> {
  const { selectedResearchSources } = await import('@/lib/ai-sources');
  const researchReferenceIds = [...new Set(input.researchReferenceIds ?? [])];
  if (researchReferenceIds.length && !input.caseId)
    throw new CapabilityError('SCOPE_REQUIRED', 'Selecione o caso das referências.');
  if (researchReferenceIds.length) await selectedResearchSources(context, input.caseId!, researchReferenceIds);
  if (input.conversationId && !await database.prepare('SELECT 1 FROM ai_conversation WHERE id=? AND office_id=? AND user_id=?')
    .get(input.conversationId, context.officeId, context.userId))
    throw new CapabilityError('NOT_FOUND', 'Conversa não encontrada.');
  const marks = input.documentIds.map(() => '?').join(',');
  const valid = await database.prepare(
    `SELECT id FROM vault_document WHERE office_id=? AND deleted_at IS NULL AND id IN (${marks})`
  ).all(context.officeId, ...input.documentIds) as Array<{ id: string }>;

  const validatedIds = valid.map(v => v.id);

  if (input.conversationId) {
    const existing = await database.prepare(
      'SELECT id FROM knowledge_scope WHERE office_id=? AND user_id=? AND conversation_id=?'
    ).get(context.officeId, context.userId, input.conversationId) as { id: string } | undefined;

    if (existing) {
      await database.prepare(
        'UPDATE knowledge_scope SET document_ids=?,case_id=?,research_reference_ids=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND user_id=?'
      ).run(JSON.stringify(validatedIds), input.caseId ?? null, JSON.stringify(researchReferenceIds), existing.id, context.officeId, context.userId);
    } else {
      await database.prepare(`
        INSERT INTO knowledge_scope (id, office_id, user_id, conversation_id, document_ids, case_id, research_reference_ids)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        context.officeId,
        context.userId,
        input.conversationId,
        JSON.stringify(validatedIds),
        input.caseId ?? null,
        JSON.stringify(researchReferenceIds)
      );
    }
  }

  return {
    success: true,
    documentIds: validatedIds,
    caseId: input.caseId,
    researchReferenceIds,
  };
}
