import 'server-only';
import { captureOperationalError } from '@/lib/observability/report';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import { objectStorage, StorageError } from '@/lib/storage';
import { embeddingProfile, embedTexts, EmbeddingUnavailableError, type EmbeddingProfile } from './embedding-provider';
import { ContainerBindingError } from '@/lib/container-bindings';
import { VectorContractError, vectorIndex, type VectorRecord } from './vector-index';

const BATCH_SIZE = 32;
const LEASE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export type IndexGeneration = { id: string; modelId: string; dimension: number; status: string };

/**
 * A generation pins the embedding model and its dimension. Changing either creates a new one
 * rather than mixing incompatible vectors in the same index, and the old generation keeps serving
 * queries until the new one is fully published.
 */
export async function activeGeneration(officeId: string): Promise<IndexGeneration | undefined> {
  const row = await database.prepare(
    "SELECT id, model_id AS modelId, dimension, status FROM knowledge_index_generation WHERE office_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
  ).get(officeId) as IndexGeneration | undefined;
  return row ? { id: String(row.id), modelId: String(row.modelId), dimension: Number(row.dimension), status: String(row.status) } : undefined;
}

export async function generationForProfile(officeId: string, profile: EmbeddingProfile, dimension: number): Promise<IndexGeneration> {
  const existing = await database.prepare(
    "SELECT id, model_id AS modelId, dimension, status FROM knowledge_index_generation WHERE office_id = ? AND model_id = ? AND dimension = ? AND status IN ('active','building') ORDER BY created_at DESC LIMIT 1",
  ).get(officeId, profile.modelId, dimension) as IndexGeneration | undefined;
  if (existing) return { id: String(existing.id), modelId: String(existing.modelId), dimension: Number(existing.dimension), status: String(existing.status) };

  const id = randomUUID();
  await database.prepare(`
    INSERT INTO knowledge_index_generation (id, office_id, profile_name, model_id, dimension, chunker, status)
    VALUES (?, ?, 'embedding', ?, ?, 'structural', 'building')
  `).run(id, officeId, profile.modelId, dimension);
  return { id, modelId: profile.modelId, dimension, status: 'building' };
}

/** Promotes a generation once every job behind it finished, then retires the previous one. */
export async function publishGenerationIfComplete(officeId: string, generationId: string) {
  // 'failed' blocks as firmly as 'queued': promoting a generation whose jobs did not all finish
  // would retire a complete index in favour of one that silently omits those documents. A failed
  // job is cleared by re-queueing it, which enqueueIndexJob does. 'cancelled' does not block,
  // because it means the document was deleted and has nothing left to contribute.
  const unfinished = Number(await (await database.prepare(
    "SELECT count(*) AS n FROM knowledge_index_job WHERE office_id = ? AND generation_id = ? AND status IN ('queued','running','failed')",
  ).get(officeId, generationId))?.n ?? 0);
  if (unfinished > 0) return false;

  // Counts the ledger, not the index. Vectorize in particular accepts an upsert and only makes
  // the vector queryable some seconds later, so "the index answered" is not a completion signal.
  const published = Number(await (await database.prepare(
    'SELECT count(*) AS n FROM vault_document_chunk_vector WHERE office_id = ? AND generation_id = ?',
  ).get(officeId, generationId))?.n ?? 0);
  if (published === 0) return false;

  // Retiring the old generation and promoting the new one is one batch: between the two writes
  // an office would otherwise have either two active generations or none, and a search landing in
  // that gap reads an index that is half of each.
  await database.batch([
    database.prepare("UPDATE knowledge_index_generation SET status = 'retired', updated_at = CURRENT_TIMESTAMP WHERE office_id = ? AND status = 'active' AND id <> ?")
      .bind(officeId, generationId),
    database.prepare("UPDATE knowledge_index_generation SET status = 'active', count_published = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(published, generationId),
  ]);
  return true;
}

/**
 * Queues semantic indexing for one document. Idempotent: re-queueing a document that is already
 * pending returns the same job instead of racing a second one against it.
 */
export async function enqueueIndexJob(officeId: string, documentId: string): Promise<{ jobId: string; generationId: string } | undefined> {
  let profile: EmbeddingProfile;
  try { profile = await embeddingProfile(officeId); }
  catch (error) {
    if (error instanceof EmbeddingUnavailableError) return undefined;
    throw error;
  }

  const known = await database.prepare(
    "SELECT id, dimension FROM knowledge_index_generation WHERE office_id = ? AND model_id = ? AND status IN ('active','building') ORDER BY created_at DESC LIMIT 1",
  ).get(officeId, profile.modelId) as { id: string; dimension: number } | undefined;

  // The first job for an unseen model discovers the dimension from the provider itself.
  const generation = known
    ? { id: String(known.id), modelId: profile.modelId, dimension: Number(known.dimension), status: 'building' }
    : await generationForProfile(officeId, profile, 0);

  const chunks = Number(await (await database.prepare('SELECT count(*) AS n FROM vault_document_chunk WHERE office_id = ? AND document_id = ?')
    .get(officeId, documentId))?.n ?? 0);

  const jobId = randomUUID();
  await database.prepare(`
    INSERT INTO knowledge_index_job (id, office_id, document_id, generation_id, chunks_total)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(document_id, generation_id) DO UPDATE SET
      status = CASE WHEN knowledge_index_job.status IN ('completed','failed','cancelled') THEN 'queued' ELSE knowledge_index_job.status END,
      cursor_ordinal = CASE WHEN knowledge_index_job.status IN ('completed','failed','cancelled') THEN 0 ELSE knowledge_index_job.cursor_ordinal END,
      chunks_done = CASE WHEN knowledge_index_job.status IN ('completed','failed','cancelled') THEN 0 ELSE knowledge_index_job.chunks_done END,
      chunks_total = excluded.chunks_total,
      attempts = 0, error = NULL, updated_at = CURRENT_TIMESTAMP
  `).run(jobId, officeId, documentId, generation.id, chunks);

  const row = await database.prepare('SELECT id FROM knowledge_index_job WHERE document_id = ? AND generation_id = ?')
    .get(documentId, generation.id) as { id: string };
  return { jobId: String(row.id), generationId: generation.id };
}

type JobRow = {
  id: string; office_id: string; document_id: string; generation_id: string;
  cursor_ordinal: number; chunks_total: number; chunks_done: number; attempts: number;
};

async function claimIndexJob(): Promise<{ job: JobRow; owner: string } | undefined> {
  const owner = randomUUID();
  const now = Date.now();

  // A worker that dies mid-run leaves its job 'running' with the attempt already spent. Once
  // attempts reach the limit the claim below can never pick it up again, so without this it would
  // stay 'running' forever and hold its generation unpublished. Fail it explicitly.
  await database.prepare(
    `UPDATE knowledge_index_job
     SET status = 'failed', lease_owner = NULL, lease_until = 0, updated_at = CURRENT_TIMESTAMP,
         error = COALESCE(error, 'A indexação esgotou as tentativas sem concluir.')
     WHERE status = 'running' AND lease_until < ? AND attempts >= ?`,
  ).run(now, MAX_ATTEMPTS);

  // The claim is one conditional UPDATE: the sub-select picks the oldest eligible job and the
  // outer WHERE re-checks the same condition, so two workers cannot both take it. RETURNING hands
  // back the row as it was claimed, which is what the run needs.
  const claimable = "(status = 'queued' OR (status = 'running' AND lease_until < ?)) AND attempts < ?";
  const job = await database.prepare(
    `UPDATE knowledge_index_job SET status = 'running', lease_owner = ?, lease_until = ?, attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
     WHERE id = (SELECT id FROM knowledge_index_job WHERE ${claimable} ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
       AND ${claimable}
     RETURNING id, office_id, document_id, generation_id, cursor_ordinal, chunks_total, chunks_done, attempts`,
  ).get<JobRow>(owner, now + LEASE_MS, now, MAX_ATTEMPTS, now, MAX_ATTEMPTS);
  if (!job) return undefined;
  // `attempts` comes back already incremented; the caller compares it against the limit.
  return { job: { ...job, attempts: Number(job.attempts) - 1 }, owner };
}

type IndexStage = 'setup' | 'embedding' | 'vector_upsert' | 'ledger' | 'checkpoint' | 'publish';

/** Carries which step failed out of the run, so the report names it without the provider's text. */
class IndexStageError extends Error {
  constructor(readonly stage: IndexStage, readonly original: unknown) {
    super(original instanceof Error ? original.message : 'Falha ao indexar o documento.');
    this.name = original instanceof Error ? original.name : 'Error';
    if (original instanceof Error && original.stack) this.stack = original.stack;
  }
}

async function stage<T>(name: IndexStage, step: () => Promise<T>): Promise<T> {
  try { return await step(); }
  catch (error) { throw error instanceof IndexStageError ? error : new IndexStageError(name, error); }
}

/**
 * Embeds one document in bounded batches, checkpointing the ordinal after each one so an
 * interrupted run resumes instead of paying for every chunk again.
 */
async function runIndexJob(job: JobRow, owner: string): Promise<void> {
  const profile = await stage('setup', () => embeddingProfile(job.office_id));
  const index = await stage('setup', () => vectorIndex());
  let cursor = Number(job.cursor_ordinal);
  let done = Number(job.chunks_done);

  for (;;) {
    const live = await database.prepare('SELECT deleted_at FROM vault_document WHERE id = ? AND office_id = ?')
      .get(job.document_id, job.office_id) as { deleted_at: string | null } | undefined;
    if (!live || live.deleted_at !== null) {
      await database.prepare("UPDATE knowledge_index_job SET status = 'cancelled', lease_owner = NULL, lease_until = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND lease_owner = ?")
        .run(job.id, owner);
      return;
    }

    const chunks = await database.prepare(
      `SELECT id, ordinal, content FROM vault_document_chunk
       WHERE office_id = ? AND document_id = ? AND ordinal >= ? ORDER BY ordinal LIMIT ?`,
    ).all(job.office_id, job.document_id, cursor, BATCH_SIZE) as Array<{ id: string; ordinal: number; content: string }>;
    if (!chunks.length) break;

    const vectors = await stage('embedding', () => embedTexts(profile, chunks.map((chunk) => chunk.content)));

    // The first batch of a fresh generation fixes its dimension for good.
    const dimension = vectors[0].length;
    const generation = await database.prepare('SELECT dimension FROM knowledge_index_generation WHERE id = ?')
      .get(job.generation_id) as { dimension: number } | undefined;
    if (generation && Number(generation.dimension) === 0) {
      await database.prepare('UPDATE knowledge_index_generation SET dimension = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(dimension, job.generation_id);
    } else if (generation && Number(generation.dimension) !== dimension) {
      throw new IndexStageError('embedding', new EmbeddingUnavailableError('A dimensão do modelo de embedding mudou. Crie uma nova geração de índice.'));
    }

    const records: VectorRecord[] = chunks.map((chunk, position) => ({
      chunkId: chunk.id, documentId: job.document_id, embedding: vectors[position],
    }));
    await stage('vector_upsert', () => index.upsert(job.office_id, job.generation_id, records));

    // Publication ledger, written for every backend. The vectors themselves live wherever the
    // adapter put them - pgvector, Vectorize, or this table's blob column for SQLite - but the
    // record of what was published to which generation has to be in the business database.
    // It is what decides when a generation is complete, and what identifies the vectors to
    // delete when a document is removed from a remote index that cannot be queried by document.
    const ledger = database.prepare(`
      INSERT INTO vault_document_chunk_vector (id, office_id, document_id, chunk_id, generation_id, embedding)
      VALUES (?, ?, ?, ?, ?, '')
      ON CONFLICT(chunk_id, generation_id) DO NOTHING
    `);
    await stage('ledger', () => database.batch(records.map((record) =>
      ledger.bind(`${job.generation_id}:${record.chunkId}`, job.office_id, job.document_id, record.chunkId, job.generation_id))));

    cursor = chunks[chunks.length - 1].ordinal + 1;
    done += chunks.length;
    const held = await stage('checkpoint', () => database.prepare(
      `UPDATE knowledge_index_job SET cursor_ordinal = ?, chunks_done = ?, lease_until = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND lease_owner = ?`,
    ).run(cursor, done, Date.now() + LEASE_MS, job.id, owner));
    if (!held.changes) throw new IndexStageError('checkpoint', new Error('A tarefa de indexação perdeu sua concessão.'));
  }

  const completedAt = new Date().toISOString();
  await database.batch([
    database.prepare("UPDATE knowledge_index_job SET status = 'completed', error = NULL, lease_until = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND lease_owner = ?")
      .bind(job.id, owner),
    database.prepare(`INSERT INTO notification_event(
      id,office_id,event_type,payload_version,source_kind,source_id,source_version,actor_user_id,
      intended_recipients_json,data_json,dedupe_key,historical,push_eligible,created_at,expires_at
    ) SELECT ?,j.office_id,'vault.index.ready',1,'document',j.document_id,NULL,NULL,
      json_build_array(d.created_by),?, ?,0,1,?,? FROM knowledge_index_job j
      JOIN vault_document d ON d.id=j.document_id AND d.office_id=j.office_id
      WHERE j.id=? AND j.office_id=? AND j.status='completed' AND j.lease_owner=?
      ON CONFLICT(office_id,dedupe_key) DO NOTHING`).bind(
        randomUUID(), JSON.stringify({ stage: 'search_index' }), `index:${job.id}:attempt:${owner}:completed`,
        completedAt, new Date(Date.parse(completedAt) + 24 * 60 * 60 * 1000).toISOString(),
        job.id, job.office_id, owner,
      ),
    database.prepare(`UPDATE knowledge_index_job SET lease_owner=NULL WHERE id=? AND office_id=? AND status='completed' AND lease_owner=?`)
      .bind(job.id, job.office_id, owner),
  ]);
  await stage('publish', () => publishGenerationIfComplete(job.office_id, job.generation_id));
}

export async function processNextIndexJob(): Promise<boolean> {
  const claimed = await claimIndexJob();
  if (!claimed) return false;
  try {
    await runIndexJob(claimed.job, claimed.owner);
  } catch (caught) {
    const failedStage = caught instanceof IndexStageError ? caught.stage : 'unknown';
    const error = caught instanceof IndexStageError ? caught.original : caught;
    // Stage and code are ours; the provider's message stays out of the event.
    captureOperationalError(error, 'knowledge.index', {
      'knowledge.stage': failedStage,
      'knowledge.error_code': error instanceof ContainerBindingError ? error.code ?? `status_${error.status}` : error instanceof Error ? error.name : 'unknown',
    });
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Falha ao indexar o documento.';
    const terminal = error instanceof EmbeddingUnavailableError || error instanceof VectorContractError
      || Number(claimed.job.attempts) + 1 >= MAX_ATTEMPTS;
    // Only the lease holder may record the outcome. A worker whose lease expired mid-run finishes
    // late, and without this guard it would push the job back to 'queued' underneath the worker
    // that legitimately reclaimed it - interrupting live indexing and paying for the same
    // embeddings twice. The write simply no-ops when the lease has moved on.
    if (!terminal) {
      await database.prepare(
        `UPDATE knowledge_index_job SET status = 'queued', error = ?, lease_owner = NULL, lease_until = 0, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND lease_owner = ?`,
      ).run(message, claimed.job.id, claimed.owner);
    } else {
      const failedAt = new Date().toISOString();
      await database.batch([
        database.prepare(`UPDATE knowledge_index_job SET status='failed',error=?,lease_until=0,updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND lease_owner=?`).bind(message, claimed.job.id, claimed.owner),
        database.prepare(`INSERT INTO notification_event(
          id,office_id,event_type,payload_version,source_kind,source_id,source_version,actor_user_id,
          intended_recipients_json,data_json,dedupe_key,historical,push_eligible,created_at,expires_at
        ) SELECT ?,j.office_id,'vault.index.failed',1,'document',j.document_id,NULL,NULL,
          json_build_array(d.created_by),?,?,0,1,?,? FROM knowledge_index_job j
          JOIN vault_document d ON d.id=j.document_id AND d.office_id=j.office_id
          WHERE j.id=? AND j.office_id=? AND j.status='failed' AND j.lease_owner=?
          ON CONFLICT(office_id,dedupe_key) DO NOTHING`).bind(
            randomUUID(), JSON.stringify({ stage: 'search_index' }),
            `index:${claimed.job.id}:attempt:${claimed.owner}:failed`, failedAt,
            new Date(Date.parse(failedAt) + 24 * 60 * 60 * 1000).toISOString(),
            claimed.job.id, claimed.job.office_id, claimed.owner,
          ),
        database.prepare(`UPDATE knowledge_index_job SET lease_owner=NULL WHERE id=? AND office_id=? AND status='failed' AND lease_owner=?`)
          .bind(claimed.job.id, claimed.job.office_id, claimed.owner),
      ]);
    }
  }
  return true;
}

/**
 * Physical cleanup runs after the tombstone, never instead of it. Failures retry; they never
 * resurrect the row, because eligibility was already removed in the business database.
 */
export async function processNextDeletion(): Promise<boolean> {
  const row = await database.prepare(
    'SELECT id, office_id AS officeId, target_kind AS kind, target_ref AS ref, attempts FROM vault_deletion_queue WHERE completed_at IS NULL AND attempts < ? ORDER BY created_at LIMIT 1',
  ).get(MAX_ATTEMPTS) as { id: string; officeId: string; kind: string; ref: string; attempts: number } | undefined;
  if (!row) return false;

  /** Closing the entry is a claim that the bytes are gone, so only proof may close it. */
  const close = async (note?: string) => {
    if (note) await database.prepare('UPDATE vault_deletion_queue SET completed_at = CURRENT_TIMESTAMP, last_error = ? WHERE id = ?').run(note, row.id);
    else await database.prepare('UPDATE vault_deletion_queue SET completed_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
  };
  const retry = async (cause: unknown) => {
    await database.prepare('UPDATE vault_deletion_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?')
      .run(cause instanceof Error ? cause.message.slice(0, 300) : 'falha', row.id);
  };

  try {
    if (row.kind === 'object') await (await objectStorage()).delete(row.ref);
    else await (await vectorIndex()).removeDocument(row.officeId, row.ref);
    await close();
  } catch (error) {
    // A reference the current key format rejects belongs to a document stored before the adapter
    // existed, so the backend gets a second chance at its legacy layout. Only two outcomes end
    // the entry: the bytes were removed, or no backend could ever address that reference. A
    // filesystem that was merely busy has to come back through the retry path, because closing
    // on it would leave the bytes of a deleted document on disk with nothing left to chase them.
    if (error instanceof StorageError && error.code === 'invalid_key' && row.kind === 'object') {
      const storage = await objectStorage();
      if (!storage.deleteLegacy) {
        await close('backend sem caminho legado: nada a remover');
        return true;
      }
      try {
        await storage.deleteLegacy(row.ref);
        await close('removido pelo caminho legado');
      } catch (legacyError) {
        if (legacyError instanceof StorageError && legacyError.code === 'invalid_key') {
          await close('referência inválida em qualquer formato: nada a remover');
        } else {
          await retry(legacyError);
        }
      }
      return true;
    }
    await retry(error);
  }
  return true;
}

export async function enqueueDeletion(officeId: string, kind: 'object' | 'vector_document', ref: string) {
  await database.prepare('INSERT INTO vault_deletion_queue (id, office_id, target_kind, target_ref) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), officeId, kind, ref);
}
