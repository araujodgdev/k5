import { testDb } from "./test-setup";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { getCurrentScope } from "@sentry/core";

import { createAiConnection } from "../src/lib/ai-connections-core";
import { parseCredentialKeyring } from "../src/lib/platform-crypto";
import { enqueueIndexJob, processNextDeletion, processNextIndexJob } from "../src/lib/knowledge/indexing";
import { ContainerBindingError, containerVectorCall } from "../src/lib/container-bindings";
import {
  parseVectorizeId, resetVectorIndexForTests, VectorContractError, vectorIndex, vectorizeId, type VectorizeBinding,
} from "../src/lib/knowledge/vector-index";
import { processorBindingRequest, type ProcessorBindings } from "../src/workers/processor-bindings";

/**
 * A local stand-in for Cloudflare Vectorize that enforces the documented contract
 * (developers.cloudflare.com/vectorize/platform/limits and /reference/client-api, read 2026-09-23)
 * and the staging index as it is configured: 1536 dimensions, metadata indexes on generationId and
 * documentId only. The rejection text is the one staging logged for LUME-P.
 */
const DIMENSIONS = 1536;
const INDEXED = new Set(["generationId", "documentId"]);
type Stored = { id: string; values: number[]; namespace: string; metadata: Record<string, string> };

function contractVectorize() {
  const vectors = new Map<string, Stored>();
  const bytes = (value: string) => Buffer.byteLength(value, "utf8");
  const binding: VectorizeBinding = {
    async upsert(batch) {
      if (batch.length > 1000) throw new Error("VECTOR_UPSERT_ERROR (code = 40007): too many vectors");
      for (const vector of batch) {
        if (bytes(vector.id) > 64) throw new Error(`VECTOR_UPSERT_ERROR (code = 40008): id too long; max is 64 bytes, got ${bytes(vector.id)} bytes`);
        if (bytes(vector.namespace) > 64) throw new Error("VECTOR_UPSERT_ERROR (code = 40009): namespace too long");
        if (vector.values.length !== DIMENSIONS) throw new Error(`VECTOR_UPSERT_ERROR (code = 40012): invalid dimension; expected ${DIMENSIONS}, got ${vector.values.length}`);
      }
      for (const vector of batch) vectors.set(vector.id, structuredClone(vector));
      return { mutationId: randomUUID() };
    },
    async query(vector, options) {
      const heavy = options.returnMetadata === "all";
      if (options.topK > (heavy ? 50 : 100)) throw new Error("VECTOR_QUERY_ERROR (code = 40025): topK too large");
      if (vector.length !== DIMENSIONS) throw new Error("VECTOR_QUERY_ERROR (code = 40012): invalid dimension");
      const filter = options.filter as Record<string, { $eq?: string; $in?: string[] }>;
      const matches = [...vectors.values()]
        .filter((stored) => stored.namespace === options.namespace)
        // A filter on a property without a metadata index matches nothing.
        .filter((stored) => Object.entries(filter).every(([key, condition]) => INDEXED.has(key) && (
          condition.$eq !== undefined ? stored.metadata[key] === condition.$eq : condition.$in!.includes(stored.metadata[key]))))
        .map((stored) => ({ id: stored.id, score: cosine(vector, stored.values), metadata: metadataFor(stored, options.returnMetadata) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, options.topK);
      return { matches };
    },
    async deleteByIds(ids) {
      for (const id of ids) vectors.delete(id);
      return { mutationId: randomUUID() };
    },
  };
  return { binding, vectors };
}

function metadataFor(stored: Stored, mode: string | undefined) {
  if (mode === "all") return { ...stored.metadata };
  if (mode === "indexed") return Object.fromEntries(Object.entries(stored.metadata).filter(([key]) => INDEXED.has(key)));
  return undefined;
}

function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** One axis per text, so the nearest chunk to a query is known in advance. */
function embeddingFor(text: string) {
  const values = new Array<number>(DIMENSIONS).fill(0.001);
  values[createHash("sha256").update(text).digest()[0] % DIMENSIONS] = 1;
  return values;
}

/**
 * Routes the processor Container's private binding host through the real outbound handler, and the
 * embedding provider to a local fixture. A throwing binding reaches the Container as `fetch failed`,
 * which is what staging recorded for the failed jobs.
 */
function installNetwork(knowledge: VectorizeBinding) {
  const realFetch = globalThis.fetch;
  const env = { KNOWLEDGE: knowledge, VAULT: { get: async () => null, put: async () => ({}), delete: async () => ({}) } } as ProcessorBindings;
  const embeddingCalls: string[][] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("http://k5-bindings/")) {
      try { return await processorBindingRequest(new Request(url, init), env); }
      catch { throw new TypeError("fetch failed"); }
    }
    if (url === "https://api.openai.com/v1/embeddings") {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      embeddingCalls.push(body.input);
      return Response.json({ data: body.input.map((text, index) => ({ index, embedding: embeddingFor(text) })) });
    }
    throw new Error(`Rede inesperada no teste: ${url}`);
  }) as typeof globalThis.fetch;
  return { embeddingCalls, restore: () => { globalThis.fetch = realFetch; } };
}

async function seedOfficeWithEmbedding() {
  const userId = randomUUID();
  const officeId = randomUUID();
  await testDb.prepare("INSERT INTO user (id, email, name) VALUES (?, ?, ?)").run(userId, `user-${randomUUID()}@k5.test`, "Pessoa");
  await testDb.prepare("INSERT INTO office (id, name) VALUES (?, ?)").run(officeId, "Escritório");
  await testDb.prepare("INSERT INTO office_member (id, office_id, user_id, role) VALUES (?, ?, ?, ?)").run(randomUUID(), officeId, userId, "lawyer");
  // The platform's connection serves every office; a fresh name per seed keeps reruns independent.
  await createAiConnection(testDb, parseCredentialKeyring(), userId, {
    name: `Embeddings ${officeId.slice(0, 8)}`, provider: "openai", apiKey: "sk-teste-local", models: { embedding: "text-embedding-3-small" },
  });
  return { officeId, userId };
}

/** Chunk ids exactly as vault.ts mints them: a 64-character sha256 hex digest. */
async function seedDocument(officeId: string, userId: string, texts: string[]) {
  const documentId = randomUUID();
  await testDb.prepare(
    `INSERT INTO vault_document (id, office_id, scope, original_name, stored_name, mime_type, byte_size, sha256, created_by, status)
     VALUES (?, ?, 'library', 'contrato.docx', ?, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 10, 'abc', ?, 'ready')`,
  ).run(documentId, officeId, `${officeId}/${documentId}/${randomUUID()}.docx`, userId);
  const chunkIds: string[] = [];
  for (const [ordinal, content] of texts.entries()) {
    const chunkId = createHash("sha256").update(`${documentId}\u0000${ordinal}\u0000p${ordinal}\u0000${content}`).digest("hex");
    chunkIds.push(chunkId);
    await testDb.prepare("INSERT INTO vault_document_chunk (id, office_id, document_id, ordinal, stable_reference, content) VALUES (?, ?, ?, ?, ?, ?)")
      .run(chunkId, officeId, documentId, ordinal, `p${ordinal}`, content);
  }
  return { documentId, chunkIds };
}

async function withContainerVectorize<T>(run: (fake: ReturnType<typeof contractVectorize>, network: ReturnType<typeof installNetwork>) => Promise<T>) {
  const previous = { ...process.env };
  process.env.VECTOR_INDEX_BACKEND = "vectorize";
  process.env.K5_CONTAINER_BINDINGS = "true";
  const fake = contractVectorize();
  const network = installNetwork(fake.binding);
  resetVectorIndexForTests(undefined);
  try { return await run(fake, network); }
  finally {
    network.restore();
    process.env = previous;
    resetVectorIndexForTests(undefined);
  }
}

/** Drains the queue for one job; other test files share the database, so it stops at this job. */
async function runJob(jobId: string) {
  for (let i = 0; i < 20; i++) {
    const row = await testDb.prepare("SELECT status FROM knowledge_index_job WHERE id = ?").get<{ status: string }>(jobId);
    if (row && ["completed", "failed", "cancelled"].includes(row.status)) return row.status;
    await processNextIndexJob();
  }
  return (await testDb.prepare("SELECT status FROM knowledge_index_job WHERE id = ?").get<{ status: string }>(jobId))?.status;
}

test("vectorize (LUME-P): a document indexed through the Container proxy is published and answers queries", async () => {
  await withContainerVectorize(async (fake) => {
    const { officeId, userId } = await seedOfficeWithEmbedding();
    const texts = ["cláusula de rescisão", "multa contratual", "foro de eleição"];
    const doc = await seedDocument(officeId, userId, texts);

    const queued = await enqueueIndexJob(officeId, doc.documentId);
    assert.ok(queued, "an office with an embedding connection queues the job");
    const status = await runJob(queued.jobId);
    const failure = await testDb.prepare("SELECT error FROM knowledge_index_job WHERE id = ?").get<{ error: string | null }>(queued.jobId);
    assert.equal(status, "completed", `the upsert is accepted by the index contract (job error: ${failure?.error})`);

    const job = await testDb.prepare("SELECT chunks_done AS done, error FROM knowledge_index_job WHERE id = ?").get<{ done: number; error: string | null }>(queued.jobId);
    assert.equal(Number(job?.done), texts.length);
    assert.equal(job?.error, null);
    assert.equal(fake.vectors.size, texts.length, "every chunk reached Vectorize");
    for (const stored of fake.vectors.values()) {
      assert.ok(Buffer.byteLength(stored.id) <= 64, "ids respect the 64-byte limit");
      assert.equal(stored.namespace, officeId, "and live in the office namespace");
    }

    const generation = await testDb.prepare("SELECT status, dimension FROM knowledge_index_generation WHERE id = ?")
      .get<{ status: string; dimension: number }>(queued.generationId);
    assert.equal(generation?.status, "active", "the generation is published");
    assert.equal(Number(generation?.dimension), DIMENSIONS);

    // The query path the retrieval engine uses: nearest chunk first, resolved back to its chunk id.
    const hits = await (await vectorIndex()).query(officeId, queued.generationId, Float32Array.from(embeddingFor(texts[1])), {
      documentIds: [doc.documentId], topK: 72,
    });
    assert.equal(hits[0]?.chunkId, doc.chunkIds[1], "the nearest chunk comes back by its real id");
    assert.deepEqual(new Set(hits.map((hit) => hit.chunkId)), new Set(doc.chunkIds));
  });
});

test("vectorize: another office never reads these vectors, even naming the same generation and document", async () => {
  await withContainerVectorize(async () => {
    const a = await seedOfficeWithEmbedding();
    const b = await seedOfficeWithEmbedding();
    const doc = await seedDocument(a.officeId, a.userId, ["sigilo profissional"]);
    const queued = (await enqueueIndexJob(a.officeId, doc.documentId))!;
    assert.equal(await runJob(queued.jobId), "completed");

    const index = await vectorIndex();
    const query = Float32Array.from(embeddingFor("sigilo profissional"));
    assert.equal((await index.query(a.officeId, queued.generationId, query, { documentIds: [doc.documentId], topK: 10 })).length, 1);
    assert.deepEqual(await index.query(b.officeId, queued.generationId, query, { documentIds: [doc.documentId], topK: 10 }), []);
  });
});

test("vectorize: a job failed the way staging failed recovers by re-queueing, with an honest progress count", async () => {
  await withContainerVectorize(async (fake) => {
    const { officeId, userId } = await seedOfficeWithEmbedding();
    const doc = await seedDocument(officeId, userId, ["primeira parte", "segunda parte"]);
    const first = (await enqueueIndexJob(officeId, doc.documentId))!;
    // The state staging holds: five attempts spent on `fetch failed`, plus a partial checkpoint
    // left by an earlier run, so a stale count would show up.
    await testDb.prepare("UPDATE knowledge_index_job SET status = 'failed', attempts = 5, error = 'fetch failed', cursor_ordinal = 1, chunks_done = 1 WHERE id = ?")
      .run(first.jobId);

    const again = (await enqueueIndexJob(officeId, doc.documentId))!;
    assert.equal(again.jobId, first.jobId, "the same job is re-queued, not duplicated");
    const reset = await testDb.prepare("SELECT status, attempts, cursor_ordinal AS cursor, chunks_done AS done, error FROM knowledge_index_job WHERE id = ?")
      .get<{ status: string; attempts: number; cursor: number; done: number; error: string | null }>(first.jobId);
    assert.deepEqual({ ...reset, attempts: Number(reset?.attempts), cursor: Number(reset?.cursor), done: Number(reset?.done) },
      { status: "queued", attempts: 0, cursor: 0, done: 0, error: null });

    assert.equal(await runJob(first.jobId), "completed");
    const done = await testDb.prepare("SELECT chunks_done AS done FROM knowledge_index_job WHERE id = ?").get<{ done: number }>(first.jobId);
    assert.equal(Number(done?.done), 2, "progress counts each chunk once");
    assert.equal(fake.vectors.size, 2);
  });
});

/** Stands for vector values, metadata or document text an external error message might echo. */
const MARKER = "MARCADOR-CONFIDENCIAL-7f3a";

test("vectorize: a rejected binding call reaches the Container as a safe error code, not `fetch failed`", async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { logged.push(args); });
  const failing: VectorizeBinding = {
    async upsert() { throw new Error(`VECTOR_UPSERT_ERROR (code = 40008): id too long; ${MARKER}`); },
    async query() { throw new Error(`falha sem código ${MARKER}`); },
    async deleteByIds() { return {}; },
  };
  const env = { KNOWLEDGE: failing, VAULT: {} } as ProcessorBindings;
  const upsert = await processorBindingRequest(new Request("http://k5-bindings/vectors/upsert", { method: "POST", body: "[]" }), env);
  assert.equal(upsert.status, 502);
  const upsertBody = await upsert.text();
  assert.deepEqual(JSON.parse(upsertBody), { code: "vectorize_40008" });
  const query = await processorBindingRequest(new Request("http://k5-bindings/vectors/query", { method: "POST", body: JSON.stringify({ vector: [], options: {} }) }), env);
  const queryBody = await query.text();
  assert.deepEqual(JSON.parse(queryBody), { code: "vectorize_unknown" });

  // Only the fixed operation and the numeric code are logged; the exception text never is.
  assert.deepEqual(logged, [["Vectorize upsert falhou (vectorize_40008)."], ["Vectorize query falhou (vectorize_unknown)."]]);
  assert.doesNotMatch(JSON.stringify(logged) + upsertBody + queryBody, new RegExp(MARKER));

  // And the Container side turns it into a typed error the index job can tag.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
    processorBindingRequest(new Request(String(input), init), env)) as typeof globalThis.fetch;
  try {
    await assert.rejects(() => containerVectorCall("upsert", []), (error: unknown) =>
      error instanceof ContainerBindingError && error.status === 502 && error.code === "vectorize_40008");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("vectorize: a rejected upsert is reported with its stage and code, never the provider text", async (t) => {
  await withContainerVectorize(async (fake) => {
    const captured: Array<{ error: Error; tags: Record<string, string> }> = [];
    t.mock.method(getCurrentScope(), "captureException", (error: Error, hint?: { captureContext?: { tags?: Record<string, string> } }) => {
      captured.push({ error, tags: hint?.captureContext?.tags ?? {} });
      return "test-event";
    });
    const logged: unknown[][] = [];
    t.mock.method(console, "error", (...args: unknown[]) => { logged.push(args); });
    fake.binding.upsert = async () => { throw new Error(`VECTOR_UPSERT_ERROR (code = 40008): id too long; ${MARKER}`); };
    const { officeId, userId } = await seedOfficeWithEmbedding();
    const doc = await seedDocument(officeId, userId, ["texto do contrato"]);
    const queued = (await enqueueIndexJob(officeId, doc.documentId))!;
    await processNextIndexJob();

    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0].tags, { "knowledge.stage": "vector_upsert", "knowledge.error_code": "vectorize_40008", operation: "knowledge.index" });
    assert.equal(captured[0].error.message, "Lume: knowledge.index failed");
    const job = await testDb.prepare("SELECT status, error FROM knowledge_index_job WHERE id = ?").get<{ status: string; error: string }>(queued.jobId);
    assert.equal(job?.status, "queued", "a remote rejection is still retried, within the attempt limit");
    // Neither Sentry, the Worker log nor the job's stored error carries the external message.
    const everything = JSON.stringify(captured.map(({ error, tags }) => [error.message, error.stack, tags])) + JSON.stringify(logged) + job?.error;
    assert.doesNotMatch(everything, new RegExp(`${MARKER}|texto do contrato`));
    await testDb.prepare("UPDATE knowledge_index_job SET status = 'cancelled' WHERE id = ?").run(queued.jobId);
  });
});

test("indexing: a worker that lost its lease cannot overwrite the outcome of the one that took it", async () => {
  await withContainerVectorize(async (fake) => {
    const { officeId, userId } = await seedOfficeWithEmbedding();
    const doc = await seedDocument(officeId, userId, ["documento em processamento"]);
    const queued = (await enqueueIndexJob(officeId, doc.documentId))!;
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    fake.binding.upsert = async () => {
      entered();
      await blocked;
      throw new Error("VECTOR_UPSERT_ERROR (code = 40008): rejected fixture upsert");
    };
    const running = processNextIndexJob();
    try {
      await Promise.race([started, running.then(() => { throw new Error("Index worker never reached the pending upsert"); })]);
      const replacement = randomUUID();
      await testDb.prepare("UPDATE knowledge_index_job SET lease_owner = ?, lease_until = ? WHERE id = ? AND status = 'running'")
        .run(replacement, Date.now() + 300_000, queued.jobId);
      const held = await testDb.prepare("SELECT status, lease_owner, error FROM knowledge_index_job WHERE id = ?")
        .get<{ status: string; lease_owner: string; error: string | null }>(queued.jobId);
      assert.equal(held?.status, "running");
      assert.equal(held?.lease_owner, replacement);
      release();
      await running;
      const after = await testDb.prepare("SELECT status, lease_owner, error FROM knowledge_index_job WHERE id = ?")
        .get(queued.jobId);
      assert.deepEqual(after, held, "the stale worker's real failure path cannot clear or requeue the replacement's lease");
    } finally {
      release();
      await running;
      await testDb.prepare("UPDATE knowledge_index_job SET status = 'cancelled', lease_owner = NULL, lease_until = 0 WHERE id = ?")
        .run(queued.jobId);
    }
  });
});

test("vectorize ids: within 64 bytes, reversible, and refused rather than truncated for unknown shapes", () => {
  const generationId = randomUUID();
  const hex = createHash("sha256").update("x").digest("hex");
  const uuid = randomUUID();
  for (const chunkId of [hex, uuid]) {
    const id = vectorizeId(generationId, chunkId);
    assert.ok(Buffer.byteLength(id) <= 64, `${Buffer.byteLength(id)} bytes`);
    assert.deepEqual(parseVectorizeId(id), { generationId, chunkId });
  }
  assert.notEqual(vectorizeId(generationId, hex), vectorizeId(randomUUID(), hex), "generations never share a vector");
  assert.throws(() => vectorizeId(generationId, "trecho-legado"), VectorContractError);
  assert.throws(() => vectorizeId(generationId, hex.toUpperCase()), VectorContractError);
  assert.equal(parseVectorizeId(`${generationId}:${hex}`), undefined, "the rejected legacy form is not mistaken for a valid id");
});

test("vectorize: deleting a document removes exactly its vectors from the index", async () => {
  await withContainerVectorize(async (fake) => {
    const { officeId, userId } = await seedOfficeWithEmbedding();
    const kept = await seedDocument(officeId, userId, ["documento mantido"]);
    const removed = await seedDocument(officeId, userId, ["documento removido", "segunda parte"]);
    for (const doc of [kept, removed]) {
      const queued = (await enqueueIndexJob(officeId, doc.documentId))!;
      assert.equal(await runJob(queued.jobId), "completed");
    }
    assert.equal(fake.vectors.size, 3);

    const queueId = randomUUID();
    await testDb.prepare("INSERT INTO vault_deletion_queue (id, office_id, target_kind, target_ref) VALUES (?, ?, 'vector_document', ?)")
      .run(queueId, officeId, removed.documentId);
    for (let i = 0; i < 20; i++) {
      const row = await testDb.prepare("SELECT completed_at AS done FROM vault_deletion_queue WHERE id = ?").get<{ done: string | null }>(queueId);
      if (row?.done) break;
      await processNextDeletion();
    }
    assert.equal(fake.vectors.size, 1, "the ids the ledger derives are the ids that were written");
    assert.equal([...fake.vectors.values()][0].metadata.documentId, kept.documentId);
  });
});
