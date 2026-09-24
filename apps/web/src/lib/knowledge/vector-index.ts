import 'server-only';
import { database } from '@/lib/database';
import { containerVectorCall } from '../container-bindings';

export type VectorRecord = { chunkId: string; documentId: string; embedding: Float32Array };
export type VectorHit = { chunkId: string; score: number };
export type VectorQuery = { documentIds: string[]; topK: number };

/**
 * The office/generation/document filter is part of the query contract, not a post-filter applied
 * after topK. A backend that cannot push all three down does not belong here: trimming a global
 * result set afterwards silently returns fewer hits than asked for, or hits from another office.
 */
export interface VectorIndex {
  readonly kind: 'postgres' | 'pgvector' | 'vectorize';
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
const POSTGRES_SCAN_LIMIT = 20_000;

class PostgresVectorIndex implements VectorIndex {
  readonly kind = 'postgres' as const;

  async upsert(officeId: string, generationId: string, records: VectorRecord[]) {
    const statement = database.prepare(`
      INSERT INTO vault_document_chunk_vector (id, office_id, document_id, chunk_id, generation_id, embedding, embedding_blob)
      VALUES (?, ?, ?, ?, ?, '', ?)
      ON CONFLICT(chunk_id, generation_id) DO UPDATE SET embedding_blob = excluded.embedding_blob
    `);
    // One batch: a partially written generation reports vectors it cannot answer with.
    await database.batch(records.map((record) => statement.bind(
      `${generationId}:${record.chunkId}`,
      officeId,
      record.documentId,
      record.chunkId,
      generationId,
      encodeEmbedding(record.embedding),
    )));
  }

  async query(officeId: string, generationId: string, embedding: Float32Array, options: VectorQuery) {
    if (!options.documentIds.length) return [];
    const marks = options.documentIds.map(() => '?').join(',');
    // Scope is pushed into SQL; only the vectors of the authorized documents are ever read.
    const rows = await database.prepare(`
      SELECT chunk_id AS chunkId, embedding_blob AS blob
      FROM vault_document_chunk_vector
      WHERE office_id = ? AND generation_id = ? AND document_id IN (${marks}) AND embedding_blob IS NOT NULL
      LIMIT ${POSTGRES_SCAN_LIMIT}
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
    await database.prepare('DELETE FROM vault_document_chunk_vector WHERE office_id = ? AND document_id = ?').run(officeId, documentId);
  }

  async removeGeneration(officeId: string, generationId: string) {
    await database.prepare('DELETE FROM vault_document_chunk_vector WHERE office_id = ? AND generation_id = ?').run(officeId, generationId);
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

/**
 * Cloudflare Vectorize caps a `$in` filter at 64 values and `delete_by_ids` at 1000. Both limits
 * sit below what the capability contract allows, so the adapter fans out instead of truncating:
 * a silently trimmed scope returns a confident answer built on part of the evidence.
 */
const VECTORIZE_FILTER_VALUES = 64;
const VECTORIZE_DELETE_IDS = 1_000;

function batched<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

/** A vector the index can never accept. Retrying it only spends embedding calls again. */
export class VectorContractError extends Error {
  constructor(message: string) { super(message); this.name = 'VectorContractError'; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const uuidBytes = (value: string) => Buffer.from(value.replaceAll('-', ''), 'hex');
const uuidText = (bytes: Buffer) => bytes.toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

/**
 * Vectorize caps vector ids at 64 bytes. `${generationId}:${chunkId}` is 101 bytes for the sha256
 * chunk ids vault.ts mints, which is what staging rejected with 40008. The id packs both values as
 * bytes instead - 48 bytes, exactly 64 base64url characters - and stays reversible, so a query
 * reads the chunk back from the id without depending on a metadata index for chunkId.
 */
export function vectorizeId(generationId: string, chunkId: string): string {
  if (!UUID.test(generationId)) throw new VectorContractError('Geração de índice com identificador inesperado.');
  const chunk = SHA256_HEX.test(chunkId) ? Buffer.from(chunkId, 'hex') : UUID.test(chunkId) ? uuidBytes(chunkId) : undefined;
  if (!chunk) throw new VectorContractError('Trecho com identificador que o Vectorize não consegue endereçar.');
  return Buffer.concat([uuidBytes(generationId), chunk]).toString('base64url');
}

export function parseVectorizeId(id: string): { generationId: string; chunkId: string } | undefined {
  const bytes = Buffer.from(id, 'base64url');
  if (bytes.toString('base64url') !== id || (bytes.length !== 48 && bytes.length !== 32)) return undefined;
  const chunk = bytes.subarray(16);
  return { generationId: uuidText(bytes.subarray(0, 16)), chunkId: bytes.length === 48 ? chunk.toString('hex') : uuidText(chunk) };
}

type VectorizeMatch = { id?: string; score?: number };

export interface VectorizeBinding {
  upsert(vectors: Array<{ id: string; values: number[]; namespace: string; metadata: Record<string, string> }>): Promise<unknown>;
  query(vector: number[], options: {
    topK: number;
    namespace: string;
    returnMetadata: 'none' | 'indexed' | 'all';
    filter: { generationId: { $eq: string }; documentId: { $in: string[] } };
  }): Promise<{ matches?: VectorizeMatch[] }>;
  deleteByIds(ids: string[]): Promise<unknown>;
}

/**
 * The chunk comes from the id, not from metadata: only generationId and documentId carry metadata
 * indexes, and 'indexed' returns nothing else. 'none' also keeps topK up to 100 instead of 50.
 */
const vectorizeQueryOptions = (officeId: string, generationId: string, documentIds: string[], topK: number) => ({
  topK,
  namespace: officeId,
  returnMetadata: 'none' as const,
  filter: { generationId: { $eq: generationId }, documentId: { $in: documentIds } },
});

const vectorizeRecord = (officeId: string, generationId: string, record: VectorRecord) => ({
  id: vectorizeId(generationId, record.chunkId),
  values: Array.from(record.embedding),
  namespace: officeId,
  metadata: { officeId, generationId, documentId: record.documentId, chunkId: record.chunkId },
});

function mergeVectorizeMatches(responses: Array<{ matches?: VectorizeMatch[] }>, generationId: string, topK: number): VectorHit[] {
  const best = new Map<string, number>();
  for (const response of responses) {
    for (const match of response.matches ?? []) {
      const parsed = typeof match.id === 'string' ? parseVectorizeId(match.id) : undefined;
      if (!parsed || parsed.generationId !== generationId) continue;
      const { chunkId } = parsed;
      const score = Number(match.score);
      if (!best.has(chunkId) || score > best.get(chunkId)!) best.set(chunkId, score);
    }
  }
  return [...best.entries()]
    .map(([chunkId, score]) => ({ chunkId, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** Cloudflare Vectorize over the REST API, used by Node workers outside the Workers runtime. */
class RestVectorizeIndex implements VectorIndex {
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
    const ndjson = records.map((record) => JSON.stringify(vectorizeRecord(officeId, generationId, record))).join('\n');
    await this.call('/upsert', ndjson, 'application/x-ndjson');
  }

  async query(officeId: string, generationId: string, embedding: Float32Array, options: VectorQuery) {
    if (!options.documentIds.length) return [];
    const vector = Array.from(embedding);

    // Each partition returns its own topK, so the global topK is always a subset of their union:
    // merging and re-ranking gives the same answer a single unpartitioned query would.
    const responses = await Promise.all(
      batched(options.documentIds, VECTORIZE_FILTER_VALUES).map((documentIds) => this.call('/query', {
        vector,
        ...vectorizeQueryOptions(officeId, generationId, documentIds, options.topK),
      }) as Promise<{ result?: { matches?: VectorizeMatch[] } }>),
    );
    return mergeVectorizeMatches(responses.map((body) => body.result ?? {}), generationId, options.topK);
  }

  async removeDocument(officeId: string, documentId: string) {
    // Vectorize deletes by id; the SQL side holds the chunk ids that belong to the document.
    const ids = await database.prepare('SELECT chunk_id AS chunkId, generation_id AS generationId FROM vault_document_chunk_vector WHERE office_id = ? AND document_id = ?')
      .all(officeId, documentId) as Array<{ chunkId: string; generationId: string }>;
    if (!ids.length) return;
    await this.deleteIds(ids.map((row) => vectorizeId(row.generationId, row.chunkId)));
  }

  async removeGeneration(officeId: string, generationId: string) {
    const ids = await database.prepare('SELECT chunk_id AS chunkId FROM vault_document_chunk_vector WHERE office_id = ? AND generation_id = ?')
      .all(officeId, generationId) as Array<{ chunkId: string }>;
    if (!ids.length) return;
    await this.deleteIds(ids.map((row) => vectorizeId(generationId, row.chunkId)));
  }

  /** Sequential on purpose: a partial delete that leaves vectors behind is worse than a slow one. */
  private async deleteIds(ids: string[]) {
    for (const batch of batched(ids, VECTORIZE_DELETE_IDS)) {
      await this.call('/delete_by_ids', { ids: batch });
    }
  }
}

/** Cloudflare Vectorize through the Worker binding declared in wrangler.jsonc. */
class BoundVectorizeIndex implements VectorIndex {
  readonly kind = 'vectorize' as const;

  constructor(private readonly binding: VectorizeBinding) {}

  async upsert(officeId: string, generationId: string, records: VectorRecord[]) {
    if (!records.length) return;
    await this.binding.upsert(records.map((record) => vectorizeRecord(officeId, generationId, record)));
  }

  async query(officeId: string, generationId: string, embedding: Float32Array, options: VectorQuery) {
    if (!options.documentIds.length) return [];
    const responses = await Promise.all(
      batched(options.documentIds, VECTORIZE_FILTER_VALUES).map((documentIds) =>
        this.binding.query(Array.from(embedding), vectorizeQueryOptions(officeId, generationId, documentIds, options.topK))),
    );
    return mergeVectorizeMatches(responses, generationId, options.topK);
  }

  async removeDocument(officeId: string, documentId: string) {
    const ids = await database.prepare('SELECT chunk_id AS chunkId, generation_id AS generationId FROM vault_document_chunk_vector WHERE office_id = ? AND document_id = ?')
      .all(officeId, documentId) as Array<{ chunkId: string; generationId: string }>;
    await this.deleteIds(ids.map((row) => vectorizeId(row.generationId, row.chunkId)));
  }

  async removeGeneration(officeId: string, generationId: string) {
    const ids = await database.prepare('SELECT chunk_id AS chunkId FROM vault_document_chunk_vector WHERE office_id = ? AND generation_id = ?')
      .all(officeId, generationId) as Array<{ chunkId: string }>;
    await this.deleteIds(ids.map((row) => vectorizeId(generationId, row.chunkId)));
  }

  private async deleteIds(ids: string[]) {
    for (const batch of batched(ids, VECTORIZE_DELETE_IDS)) await this.binding.deleteByIds(batch);
  }
}

let cached: VectorIndex | undefined;
let resolving: Promise<VectorIndex> | undefined;
let testVectorizeBinding: VectorizeBinding | undefined;

async function workerVectorizeBinding(): Promise<VectorizeBinding | undefined> {
  try {
    const { env } = await import(/* webpackIgnore: true */ 'cloudflare:workers');
    return env.KNOWLEDGE as VectorizeBinding | undefined;
  } catch {
    return undefined;
  }
}

async function resolveVectorIndex(): Promise<VectorIndex> {
  if (cached) return cached;
  const backend = process.env.VECTOR_INDEX_BACKEND;
  if (backend === 'vectorize') {
    if (process.env.K5_CONTAINER_BINDINGS === 'true') return new BoundVectorizeIndex({
      upsert: vectors => containerVectorCall('upsert', vectors),
      query: (vector, options) => containerVectorCall('query', { vector, options }),
      deleteByIds: ids => containerVectorCall('delete', ids),
    });
    const binding = testVectorizeBinding ?? await workerVectorizeBinding();
    if (binding) return new BoundVectorizeIndex(binding);
    if (process.env.CF_ACCOUNT_ID && process.env.VECTORIZE_INDEX && process.env.CF_API_TOKEN) {
      return new RestVectorizeIndex({
        accountId: process.env.CF_ACCOUNT_ID,
        indexName: process.env.VECTORIZE_INDEX,
        apiToken: process.env.CF_API_TOKEN,
      });
    }
    throw new Error("Vectorize foi solicitado, mas o binding 'KNOWLEDGE' e as credenciais REST não estão disponíveis.");
  }
  if (backend === 'pgvector' && process.env.VECTOR_DATABASE_URL) return new PgVectorIndex(process.env.VECTOR_DATABASE_URL);
  return new PostgresVectorIndex();
}

export async function vectorIndex(): Promise<VectorIndex> {
  if (cached) return cached;
  resolving ??= resolveVectorIndex();
  try {
    cached = await resolving;
    return cached;
  } finally {
    resolving = undefined;
  }
}

export function resetVectorIndexForTests(index?: VectorIndex, binding?: VectorizeBinding) {
  cached = index;
  resolving = undefined;
  testVectorizeBinding = binding;
}
