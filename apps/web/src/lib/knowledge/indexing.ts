import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import { objectStorage } from '@/lib/storage';
import { embeddingProfile, embedTexts, EmbeddingUnavailableError, type EmbeddingProfile } from './embedding-provider';
import { vectorIndex, type VectorRecord } from './vector-index';

const BATCH_SIZE = 32;
const LEASE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export type IndexGeneration = { id: string; modelId: string; dimension: number; status: string };

/**
 * A generation pins the embedding model and its dimension. Changing either creates a new one
 * rather than mixing incompatible vectors in the same index, and the old generation keeps serving
 * queries until the new one is fully published.
 */
export function activeGeneration(officeId: string): IndexGeneration | undefined {
  const row = database.prepare(
    "SELECT id, model_id AS modelId, dimension, status FROM knowledge_index_generation WHERE office_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
  ).get(officeId) as IndexGeneration | undefined;
  return row ? { id: String(row.id), modelId: String(row.modelId), dimension: Number(row.dimension), status: String(row.status) } : undefined;
}

export function generationForProfile(officeId: string, profile: EmbeddingProfile, dimension: number): IndexGeneration {
  const existing = database.prepare(
    "SELECT id, model_id AS modelId, dimension, status FROM knowledge_index_generation WHERE office_id = ? AND model_id = ? AND dimension = ? AND status IN ('active','building') ORDER BY created_at DESC LIMIT 1",
  ).get(officeId, profile.modelId, dimension) as IndexGeneration | undefined;
  if (existing) return { id: String(existing.id), modelId: String(existing.modelId), dimension: Number(existing.dimension), status: String(existing.status) };

  const id = randomUUID();
  database.prepare(`
    INSERT INTO knowledge_index_generation (id, office_id, profile_name, model_id, dimension, chunker, status)
    VALUES (?, ?, 'embedding', ?, ?, 'structural', 'building')
  `).run(id, officeId, profile.modelId, dimension);
  return { id, modelId: profile.modelId, dimension, status: 'building' };
}

/** Promotes a generation once every job behind it finished, then retires the previous one. */
export function publishGenerationIfComplete(officeId: string, generationId: string) {
  const pending = Number(database.prepare(
    "SELECT count(*) AS n FROM knowledge_index_job WHERE office_id = ? AND generation_id = ? AND status IN ('queued','running')",
  ).get(officeId, generationId)?.n ?? 0);
  if (pending > 0) return false;

  const published = Number(database.prepare(
    'SELECT count(*) AS n FROM vault_document_chunk_vector WHERE office_id = ? AND generation_id = ?',
  ).get(officeId, generationId)?.n ?? 0);
  if (published === 0) return false;

  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare("UPDATE knowledge_index_generation SET status = 'retired', updated_at = CURRENT_TIMESTAMP WHERE office_id = ? AND status = 'active' AND id <> ?")
      .run(officeId, generationId);
    database.prepare("UPDATE knowledge_index_generation SET status = 'active', count_published = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(published, generationId);
    database.exec('COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }
  return true;
}

/**
 * Queues semantic indexing for one document. Idempotent: re-queueing a document that is already
 * pending returns the same job instead of racing a second one against it.
 */
export function enqueueIndexJob(officeId: string, documentId: string): { jobId: string; generationId: string } | undefined {
  let profile: EmbeddingProfile;
  try { profile = embeddingProfile(officeId); }
  catch (error) {
    if (error instanceof EmbeddingUnavailableError) return undefined;
    throw error;
  }

  const known = database.prepare(
    "SELECT id, dimension FROM knowledge_index_generation WHERE office_id = ? AND model_id = ? AND status IN ('active','building') ORDER BY created_at DESC LIMIT 1",
  ).get(officeId, profile.modelId) as { id: string; dimension: number } | undefined;

  // The first job for an unseen model discovers the dimension from the provider itself.
  const generation = known
    ? { id: String(known.id), modelId: profile.modelId, dimension: Number(known.dimension), status: 'building' }
    : generationForProfile(officeId, profile, 0);

  const chunks = Number(database.prepare('SELECT count(*) AS n FROM vault_document_chunk WHERE office_id = ? AND document_id = ?')
    .get(officeId, documentId)?.n ?? 0);

  const jobId = randomUUID();
  database.prepare(`
    INSERT INTO knowledge_index_job (id, office_id, document_id, generation_id, chunks_total)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(document_id, generation_id) DO UPDATE SET
      status = CASE WHEN knowledge_index_job.status IN ('completed','failed','cancelled') THEN 'queued' ELSE knowledge_index_job.status END,
      cursor_ordinal = CASE WHEN knowledge_index_job.status IN ('completed','failed','cancelled') THEN 0 ELSE knowledge_index_job.cursor_ordinal END,
      chunks_total = excluded.chunks_total,
      attempts = 0, error = NULL, updated_at = CURRENT_TIMESTAMP
  `).run(jobId, officeId, documentId, generation.id, chunks);

  const row = database.prepare('SELECT id FROM knowledge_index_job WHERE document_id = ? AND generation_id = ?')
    .get(documentId, generation.id) as { id: string };
  return { jobId: String(row.id), generationId: generation.id };
}

type JobRow = {
  id: string; office_id: string; document_id: string; generation_id: string;
  cursor_ordinal: number; chunks_total: number; chunks_done: number; attempts: number;
};

function claimIndexJob(): { job: JobRow; owner: string } | undefined {
  const owner = randomUUID();
  database.exec('BEGIN IMMEDIATE');
  try {
    const row = database.prepare(
      `SELECT * FROM knowledge_index_job
       WHERE (status = 'queued' OR (status = 'running' AND lease_until < ?)) AND attempts < ?
       ORDER BY created_at LIMIT 1`,
    ).get(Date.now(), MAX_ATTEMPTS) as JobRow | undefined;
    if (!row) { database.exec('COMMIT'); return undefined; }
    const claimed = database.prepare(
      `UPDATE knowledge_index_job SET status = 'running', lease_owner = ?, lease_until = ?, attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND (status = 'queued' OR (status = 'running' AND lease_until < ?))`,
    ).run(owner, Date.now() + LEASE_MS, row.id, Date.now());
    if (!claimed.changes) { database.exec('ROLLBACK'); return undefined; }
    database.exec('COMMIT');
    return { job: row, owner };
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}

/**
 * Embeds one document in bounded batches, checkpointing the ordinal after each one so an
 * interrupted run resumes instead of paying for every chunk again.
 */
async function runIndexJob(job: JobRow, owner: string): Promise<void> {
  const profile = embeddingProfile(job.office_id);
  const index = vectorIndex();
  let cursor = Number(job.cursor_ordinal);
  let done = Number(job.chunks_done);

  for (;;) {
    const live = database.prepare('SELECT deleted_at FROM vault_document WHERE id = ? AND office_id = ?')
      .get(job.document_id, job.office_id) as { deleted_at: string | null } | undefined;
    if (!live || live.deleted_at !== null) {
      database.prepare("UPDATE knowledge_index_job SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(job.id);
      return;
    }

    const chunks = database.prepare(
      `SELECT id, ordinal, content FROM vault_document_chunk
       WHERE office_id = ? AND document_id = ? AND ordinal >= ? ORDER BY ordinal LIMIT ?`,
    ).all(job.office_id, job.document_id, cursor, BATCH_SIZE) as Array<{ id: string; ordinal: number; content: string }>;
    if (!chunks.length) break;

    const vectors = await embedTexts(profile, chunks.map((chunk) => chunk.content));

    // The first batch of a fresh generation fixes its dimension for good.
    const dimension = vectors[0].length;
    const generation = database.prepare('SELECT dimension FROM knowledge_index_generation WHERE id = ?')
      .get(job.generation_id) as { dimension: number } | undefined;
    if (generation && Number(generation.dimension) === 0) {
      database.prepare('UPDATE knowledge_index_generation SET dimension = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(dimension, job.generation_id);
    } else if (generation && Number(generation.dimension) !== dimension) {
      throw new EmbeddingUnavailableError('A dimensão do modelo de embedding mudou. Crie uma nova geração de índice.');
    }

    const records: VectorRecord[] = chunks.map((chunk, position) => ({
      chunkId: chunk.id, documentId: job.document_id, embedding: vectors[position],
    }));
    await index.upsert(job.office_id, job.generation_id, records);

    cursor = chunks[chunks.length - 1].ordinal + 1;
    done += chunks.length;
    const held = database.prepare(
      `UPDATE knowledge_index_job SET cursor_ordinal = ?, chunks_done = ?, lease_until = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND lease_owner = ?`,
    ).run(cursor, done, Date.now() + LEASE_MS, job.id, owner);
    if (!held.changes) throw new Error('A tarefa de indexação perdeu sua concessão.');
  }

  database.prepare("UPDATE knowledge_index_job SET status = 'completed', error = NULL, lease_owner = NULL, lease_until = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND lease_owner = ?")
    .run(job.id, owner);
  publishGenerationIfComplete(job.office_id, job.generation_id);
}

export async function processNextIndexJob(): Promise<boolean> {
  const claimed = claimIndexJob();
  if (!claimed) return false;
  try {
    await runIndexJob(claimed.job, claimed.owner);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Falha ao indexar o documento.';
    const terminal = error instanceof EmbeddingUnavailableError || Number(claimed.job.attempts) + 1 >= MAX_ATTEMPTS;
    database.prepare(
      `UPDATE knowledge_index_job SET status = ?, error = ?, lease_owner = NULL, lease_until = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(terminal ? 'failed' : 'queued', message, claimed.job.id);
  }
  return true;
}

/**
 * Physical cleanup runs after the tombstone, never instead of it. Failures retry; they never
 * resurrect the row, because eligibility was already removed in the business database.
 */
export async function processNextDeletion(): Promise<boolean> {
  const row = database.prepare(
    'SELECT id, office_id AS officeId, target_kind AS kind, target_ref AS ref, attempts FROM vault_deletion_queue WHERE completed_at IS NULL AND attempts < ? ORDER BY created_at LIMIT 1',
  ).get(MAX_ATTEMPTS) as { id: string; officeId: string; kind: string; ref: string; attempts: number } | undefined;
  if (!row) return false;

  try {
    if (row.kind === 'object') await objectStorage().delete(row.ref);
    else await vectorIndex().removeDocument(row.officeId, row.ref);
    database.prepare("UPDATE vault_deletion_queue SET completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.id);
  } catch (error) {
    database.prepare('UPDATE vault_deletion_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?')
      .run(error instanceof Error ? error.message.slice(0, 300) : 'falha', row.id);
  }
  return true;
}

export function enqueueDeletion(officeId: string, kind: 'object' | 'vector_document', ref: string) {
  database.prepare('INSERT INTO vault_deletion_queue (id, office_id, target_kind, target_ref) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), officeId, kind, ref);
}
