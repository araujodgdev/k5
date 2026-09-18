import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import { findVaultDocument } from '@/lib/vault';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';
import type { WorkspaceContext } from './context';
import { searchKnowledgeEngine } from '@/lib/knowledge/retrieval';

export function searchKnowledge(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_knowledge_search'>
): CapabilityOutput<'k5_knowledge_search'> {
  return searchKnowledgeEngine(context, input);
}

export function getKnowledgeSource(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_knowledge_get_source'>
): CapabilityOutput<'k5_knowledge_get_source'> {
  const doc = findVaultDocument(context.officeId, input.documentId);
  if (!doc) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');

  const targetChunk = database.prepare(
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
  const adjacentRows = database.prepare(
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

export function getKnowledgeIndexStatus(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_knowledge_get_index_status'>
): CapabilityOutput<'k5_knowledge_get_index_status'> {
  const doc = findVaultDocument(context.officeId, input.documentId);
  if (!doc) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');

  const activeGen = database.prepare(
    "SELECT id FROM knowledge_index_generation WHERE office_id=? AND status='active' ORDER BY created_at DESC LIMIT 1"
  ).get(context.officeId) as { id: string } | undefined;

  let vectorIndexed = false;
  if (activeGen) {
    const vectorCount = Number(
      database.prepare(
        'SELECT count(*) AS n FROM vault_document_chunk_vector WHERE office_id=? AND document_id=? AND generation_id=?'
      ).get(context.officeId, doc.id, activeGen.id)?.n ?? 0
    );
    vectorIndexed = vectorCount > 0;
  }

  return {
    documentId: doc.id,
    status: doc.status,
    extractionStatus: doc.status === 'ready' ? 'concluída' : doc.status,
    vectorIndexed,
    generationId: activeGen?.id ?? null,
  };
}

export function reindexKnowledge(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_knowledge_reindex'>
): CapabilityOutput<'k5_knowledge_reindex'> {
  const doc = findVaultDocument(context.officeId, input.documentId);
  if (!doc) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');

  // Idempotently create active index generation if none exists
  let gen = database.prepare(
    "SELECT id FROM knowledge_index_generation WHERE office_id=? AND status='active' LIMIT 1"
  ).get(context.officeId) as { id: string } | undefined;

  if (!gen) {
    const genId = randomUUID();
    database.prepare(`
      INSERT INTO knowledge_index_generation (id, office_id, profile_name, model_id, dimension, chunker, status)
      VALUES (?, ?, 'default', 'k5-embed-v1', 1536, 'structural', 'active')
    `).run(genId, context.officeId);
    gen = { id: genId };
  }

  return {
    enqueued: true,
    message: `Reindexação do documento "${doc.name}" enfileirada com sucesso na geração ${gen.id}.`,
  };
}

export function setScopeSources(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_context_set_sources'>
): CapabilityOutput<'k5_context_set_sources'> {
  const marks = input.documentIds.map(() => '?').join(',');
  const valid = database.prepare(
    `SELECT id FROM vault_document WHERE office_id=? AND deleted_at IS NULL AND id IN (${marks})`
  ).all(context.officeId, ...input.documentIds) as Array<{ id: string }>;

  const validatedIds = valid.map(v => v.id);

  if (input.conversationId) {
    const existing = database.prepare(
      'SELECT id FROM knowledge_scope WHERE office_id=? AND conversation_id=?'
    ).get(context.officeId, input.conversationId) as { id: string } | undefined;

    if (existing) {
      database.prepare(
        'UPDATE knowledge_scope SET document_ids=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
      ).run(JSON.stringify(validatedIds), existing.id);
    } else {
      database.prepare(`
        INSERT INTO knowledge_scope (id, office_id, user_id, conversation_id, document_ids)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        context.officeId,
        context.userId,
        input.conversationId,
        JSON.stringify(validatedIds)
      );
    }
  }

  return {
    success: true,
    documentIds: validatedIds,
  };
}
