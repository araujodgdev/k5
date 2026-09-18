import 'server-only';
import { database } from '@/lib/database';

export type VectorRecord = { chunkId: string; documentId: string; embedding: Float32Array };
export type VectorHit = { chunkId: string; score: number };
export type VectorQuery = { documentIds: string[]; topK: number };

/**
 * The office/generation/document filter is part of the query contract, not a post-filter applied
 * after topK. A backend that cannot push all three down does not belong here: trimming a global
 * result set afterwards silently returns fewer hits than asked for, or hits from another office.
 */
export interface VectorIndex {
  readonly kind: 'sqlite' | 'pgvector' | 'vectorize';
  upsert(officeId: string, generationId: string, records: VectorRecord[]): Promise<void>;
  query(officeId: string, generationId: string, embedding: Float32Array, options: VectorQuery): Promise<VectorHit[]>;
  removeDocument(officeId: string, documentId: string): Promise<void>;
  removeGeneration(officeId: string, generationId: string): Promise<void>;
}

export function encodeEmbedding(values: ArrayLike<number>): Buffer {
  const floats = Float32Array.from(values as number[]);
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
}

export function decodeEmbedding(blob: Buffer | Uint8Array): Float32Array {
  const bytes = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}

export function dotNormalized(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const magnitude = Math.sqrt(na) * Math.sqrt(nb);
  return magnitude === 0 ? 0 : dot / magnitude;
}

/** Local development and single-node deploys. Exact brute force, bounded by the selected scope. */
const SQLITE_SCAN_LIMIT = 20_000;

class SqliteVectorIndex implements VectorIndex {
  readonly kind = 'sqlite' as const;

  async upsert(officeId: string, generationId: string, records: VectorRecord[]) {
    const statement = database.prepare(`
      INSERT INTO vault_document_chunk_vector (id, office_id, document_id, chunk_id, generation_id, embedding, embedding_blob)
      VALUES (?, ?, ?, ?, ?, '', ?)
      ON CONFLICT(chunk_id, generation_id) DO UPDATE SET embedding_blob = excluded.embedding_blob
    `);
    for (const record of records) {
      statement.run(
        `${generationId}:${record.chunkId}`,
        officeId,
        record.documentId,
        record.chunkId,
        generationId,
        encodeEmbedding(record.embedding),
      );
    }
  }

  async query(officeId: string, generationId: string, embedding: Float32Array, options: VectorQuery) {
    if (!options.documentIds.length) return [];
    const marks = options.documentIds.map(() => '?').join(',');
    // Scope is pushed into SQL; only the vectors of the authorized documents are ever read.
    const rows = database.prepare(`
      SELECT chunk_id AS chunkId, embedding_blob AS blob
      FROM vault_document_chunk_vector
      WHERE office_id = ? AND generation_id = ? AND document_id IN (${marks}) AND embedding_blob IS NOT NULL
      LIMIT ${SQLITE_SCAN_LIMIT}
    `).all(officeId, generationId, ...options.documentIds) as Array<{ chunkId: string; blob: Uint8Array }>;

    const hits: VectorHit[] = [];
    for (const row of rows) {
      const score = dotNormalized(embedding, decodeEmbedding(row.blob));
      if (score > 0) hits.push({ chunkId: String(row.chunkId), score });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, options.topK);
  }

  async removeDocument(officeId: string, documentId: string) {
    database.prepare('DELETE FROM vault_document_chunk_vector WHERE office_id = ? AND document_id = ?').run(officeId, documentId);
  }

  async removeGeneration(officeId: string, generationId: string) {
    database.prepare('DELETE FROM vault_document_chunk_vector WHERE office_id = ? AND generation_id = ?').run(officeId, generationId);
  }
}

/** Staging and production target: real ANN with the scope filter pushed into the query. */
class PgVectorIndex implements VectorIndex {
  readonly kind = 'pgvector' as const;
  private pool: import('pg').Pool | undefined;
  private ready: Promise<void> | undefined;

  constructor(private readonly connectionString: string) {}

  private async client() {
    if (!this.pool) {
      const { Pool } = await import('pg');
      this.pool = new Pool({ connectionString: this.connectionString, max: 4 });
    }
    this.ready ??= this.migrate(this.pool);
    await this.ready;
    return this.pool;
  }

  private async migrate(pool: import('pg').Pool) {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS knowledge_chunk_vector (
        office_id text NOT NULL,
        generation_id text NOT NULL,
        document_id text NOT NULL,
        chunk_id text NOT NULL,
        embedding vector NOT NULL,
        PRIMARY KEY (generation_id, chunk_id)
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS knowledge_chunk_vector_scope ON knowledge_chunk_vector (office_id, generation_id, document_id)');
  }

  async upsert(officeId: string, generationId: string, records: VectorRecord[]) {
    if (!records.length) return;
    const pool = await this.client();
    const values: string[] = [];
    const params: unknown[] = [];
    records.forEach((record, index) => {
      const base = index * 5;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::vector)`);
      params.push(officeId, generationId, record.documentId, record.chunkId, `[${Array.from(record.embedding).join(',')}]`);
    });
    await pool.query(
      `INSERT INTO knowledge_chunk_vector (office_id, generation_id, document_id, chunk_id, embedding)
       VALUES ${values.join(',')}
       ON CONFLICT (generation_id, chunk_id) DO UPDATE SET embedding = EXCLUDED.embedding`,
      params,
    );
  }

  async query(officeId: string, generationId: string, embedding: Float32Array, options: VectorQuery) {
    if (!options.documentIds.length) return [];
    const pool = await this.client();
    const result = await pool.query(
      `SELECT chunk_id, 1 - (embedding <=> $4::vector) AS score
       FROM knowledge_chunk_vector
       WHERE office_id = $1 AND generation_id = $2 AND document_id = ANY($3)
       ORDER BY embedding <=> $4::vector
       LIMIT $5`,
      [officeId, generationId, options.documentIds, `[${Array.from(embedding).join(',')}]`, options.topK],
    );
    return result.rows.map((row: { chunk_id: string; score: string }) => ({ chunkId: row.chunk_id, score: Number(row.score) }));
  }

  async removeDocument(officeId: string, documentId: string) {
    const pool = await this.client();
    await pool.query('DELETE FROM knowledge_chunk_vector WHERE office_id = $1 AND document_id = $2', [officeId, documentId]);
  }

  async removeGeneration(officeId: string, generationId: string) {
    const pool = await this.client();
    await pool.query('DELETE FROM knowledge_chunk_vector WHERE office_id = $1 AND generation_id = $2', [officeId, generationId]);
  }
}

/** Cloudflare Vectorize over the REST API, namespaced per office. */
class VectorizeIndex implements VectorIndex {
  readonly kind = 'vectorize' as const;

  constructor(private readonly config: { accountId: string; indexName: string; apiToken: string }) {}

  private async call(path: string, body: unknown, contentType = 'application/json') {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/vectorize/v2/indexes/${this.config.indexName}${path}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiToken}`, 'Content-Type': contentType },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      },
    );
    if (!response.ok) throw new Error(`Vectorize ${path} respondeu ${response.status}.`);
    return await response.json() as { result?: unknown };
  }

  async upsert(officeId: string, generationId: string, records: VectorRecord[]) {
    if (!records.length) return;
    const ndjson = records.map((record) => JSON.stringify({
      id: `${generationId}:${record.chunkId}`,
      values: Array.from(record.embedding),
      namespace: officeId,
      metadata: { officeId, generationId, documentId: record.documentId, chunkId: record.chunkId },
    })).join('\n');
    await this.call('/upsert', ndjson, 'application/x-ndjson');
  }

  async query(officeId: string, generationId: string, embedding: Float32Array, options: VectorQuery) {
    if (!options.documentIds.length) return [];
    const payload = {
      vector: Array.from(embedding),
      topK: options.topK,
      namespace: officeId,
      returnMetadata: 'indexed',
      filter: { generationId: { $eq: generationId }, documentId: { $in: options.documentIds.slice(0, 64) } },
    };
    const body = await this.call('/query', payload) as { result?: { matches?: Array<{ score: number; metadata?: { chunkId?: string } }> } };
    return (body.result?.matches ?? [])
      .filter((match) => typeof match.metadata?.chunkId === 'string')
      .map((match) => ({ chunkId: String(match.metadata!.chunkId), score: Number(match.score) }));
  }

  async removeDocument(officeId: string, documentId: string) {
    // Vectorize deletes by id; the SQL side holds the chunk ids that belong to the document.
    const ids = database.prepare('SELECT chunk_id AS chunkId, generation_id AS generationId FROM vault_document_chunk_vector WHERE office_id = ? AND document_id = ?')
      .all(officeId, documentId) as Array<{ chunkId: string; generationId: string }>;
    if (!ids.length) return;
    await this.call('/delete_by_ids', { ids: ids.map((row) => `${row.generationId}:${row.chunkId}`) });
  }

  async removeGeneration(officeId: string, generationId: string) {
    const ids = database.prepare('SELECT chunk_id AS chunkId FROM vault_document_chunk_vector WHERE office_id = ? AND generation_id = ?')
      .all(officeId, generationId) as Array<{ chunkId: string }>;
    if (!ids.length) return;
    await this.call('/delete_by_ids', { ids: ids.map((row) => `${generationId}:${row.chunkId}`) });
  }
}

let cached: VectorIndex | undefined;

export function vectorIndex(): VectorIndex {
  if (cached) return cached;
  const backend = process.env.VECTOR_INDEX_BACKEND;
  if (backend === 'vectorize' && process.env.CF_ACCOUNT_ID && process.env.VECTORIZE_INDEX && process.env.CF_API_TOKEN) {
    cached = new VectorizeIndex({
      accountId: process.env.CF_ACCOUNT_ID,
      indexName: process.env.VECTORIZE_INDEX,
      apiToken: process.env.CF_API_TOKEN,
    });
  } else if (backend === 'pgvector' && process.env.VECTOR_DATABASE_URL) {
    cached = new PgVectorIndex(process.env.VECTOR_DATABASE_URL);
  } else {
    cached = new SqliteVectorIndex();
  }
  return cached;
}

export function resetVectorIndexForTests(index?: VectorIndex) {
  cached = index;
}
