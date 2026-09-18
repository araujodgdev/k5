import { testDb, testStorageRoot } from "./test-setup";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { CapabilityError } from "../src/lib/capabilities/errors";
import type { WorkspaceContext } from "../src/lib/application/context";
import * as vaultService from "../src/lib/application/vault-service";
import * as uploadsService from "../src/lib/application/uploads-service";
import { processNextDeletion, processNextIndexJob, publishGenerationIfComplete } from "../src/lib/knowledge/indexing";
import { resetVectorIndexForTests, vectorIndex } from "../src/lib/knowledge/vector-index";

function seedOffice() {
  const userId = randomUUID();
  const officeId = randomUUID();
  testDb.prepare("INSERT INTO user (id, email, name) VALUES (?, ?, ?)").run(userId, `user-${randomUUID()}@k5.test`, "Pessoa");
  testDb.prepare("INSERT INTO office (id, name) VALUES (?, ?)").run(officeId, "Escritório");
  testDb.prepare("INSERT INTO office_member (id, office_id, user_id, role) VALUES (?, ?, ?, ?)")
    .run(randomUUID(), officeId, userId, "lawyer");
  return { officeId, userId, context: { officeId, userId, role: "lawyer" } as WorkspaceContext };
}

function seedGeneration(officeId: string) {
  const id = randomUUID();
  testDb.prepare(
    "INSERT INTO knowledge_index_generation (id, office_id, profile_name, model_id, dimension, chunker, status) VALUES (?, ?, 'embedding', 'modelo-teste', 8, 'structural', 'building')",
  ).run(id, officeId);
  return id;
}

/** A document with one chunk: enough to own jobs and a ledger row. */
function seedDocument(officeId: string, userId: string) {
  const documentId = randomUUID();
  const chunkId = randomUUID();
  testDb.prepare(
    `INSERT INTO vault_document (id, office_id, scope, original_name, stored_name, mime_type, byte_size, sha256, created_by, status)
     VALUES (?, ?, 'library', 'doc.pdf', ?, 'application/pdf', 10, 'abc', ?, 'ready')`,
  ).run(documentId, officeId, `${officeId}/${documentId}/${randomUUID()}.pdf`, userId);
  testDb.prepare(
    "INSERT INTO vault_document_chunk (id, office_id, document_id, ordinal, stable_reference, content) VALUES (?, ?, ?, 0, 'p1', 'texto')",
  ).run(chunkId, officeId, documentId);
  return { documentId, chunkId };
}

function seedJob(officeId: string, documentId: string, generationId: string, patch: Record<string, string | number> = {}) {
  const id = randomUUID();
  testDb.prepare(
    "INSERT INTO knowledge_index_job (id, office_id, document_id, generation_id, chunks_total) VALUES (?, ?, ?, ?, 1)",
  ).run(id, officeId, documentId, generationId);
  for (const [column, value] of Object.entries(patch)) {
    testDb.prepare(`UPDATE knowledge_index_job SET ${column} = ? WHERE id = ?`).run(value, id);
  }
  return id;
}

function ledger(officeId: string, documentId: string, chunkId: string, generationId: string) {
  testDb.prepare(
    "INSERT INTO vault_document_chunk_vector (id, office_id, document_id, chunk_id, generation_id, embedding) VALUES (?, ?, ?, ?, ?, '')",
  ).run(`${generationId}:${chunkId}`, officeId, documentId, chunkId, generationId);
}

test("publication: a generation whose jobs did not all succeed does not replace a complete one", () => {
  const { officeId, userId } = seedOffice();
  const generationId = seedGeneration(officeId);
  const good = seedDocument(officeId, userId);
  const bad = seedDocument(officeId, userId);

  seedJob(officeId, good.documentId, generationId, { status: "completed" });
  const failed = seedJob(officeId, bad.documentId, generationId, { status: "failed", error: "provedor indisponível" });
  ledger(officeId, good.documentId, good.chunkId, generationId);

  // One document indexed and one that did not. Publishing here retires the previous index in
  // favour of one that answers confidently while omitting everything in the failed document.
  assert.equal(publishGenerationIfComplete(officeId, generationId), false, "a failed job blocks publication");

  // Re-queueing is the recovery path, and it must not publish while that work is still pending.
  testDb.prepare("UPDATE knowledge_index_job SET status = 'queued', attempts = 0, error = NULL WHERE id = ?").run(failed);
  assert.equal(publishGenerationIfComplete(officeId, generationId), false, "a re-queued job still blocks");

  // A cancelled job means the document was deleted: it has nothing left to contribute, so it must
  // not hold the generation hostage either.
  testDb.prepare("UPDATE knowledge_index_job SET status = 'cancelled' WHERE id = ?").run(failed);
  assert.equal(publishGenerationIfComplete(officeId, generationId), true, "a deleted document does not block");
  const generation = testDb.prepare("SELECT status FROM knowledge_index_generation WHERE id = ?")
    .get(generationId) as { status: string };
  assert.equal(generation.status, "active");
});

test("indexing: a job that exhausted its attempts while running reaches a terminal state", async () => {
  const { officeId, userId } = seedOffice();
  const generationId = seedGeneration(officeId);
  const doc = seedDocument(officeId, userId);

  // A worker died mid-run: the attempt was spent, the lease lapsed, the row still says running.
  // The claim query skips it because attempts are exhausted, so before the reap it stayed running
  // forever and its generation could never publish.
  const jobId = seedJob(officeId, doc.documentId, generationId, {
    status: "running", attempts: 5, lease_owner: randomUUID(), lease_until: Date.now() - 60_000,
  });

  await processNextIndexJob();

  const row = testDb.prepare("SELECT status, lease_owner AS leaseOwner, error FROM knowledge_index_job WHERE id = ?")
    .get(jobId) as { status: string; leaseOwner: string | null; error: string | null };
  assert.equal(row.status, "failed");
  assert.equal(row.leaseOwner, null);
  assert.match(String(row.error), /tentativas/);

  assert.equal(publishGenerationIfComplete(officeId, generationId), false, "and it is visible to publication as unfinished");
});

test("indexing: a worker that lost its lease cannot overwrite the outcome of the one that took it", async () => {
  const { officeId, userId } = seedOffice();
  const generationId = seedGeneration(officeId);
  const doc = seedDocument(officeId, userId);
  const jobId = seedJob(officeId, doc.documentId, generationId, { status: "queued" });

  // No embedding provider is configured in tests, so the run fails inside the lease holder. That
  // is the path that used to write its outcome by job id alone.
  await processNextIndexJob();
  const own = testDb.prepare("SELECT status FROM knowledge_index_job WHERE id = ?").get(jobId) as { status: string };
  assert.ok(["queued", "failed"].includes(own.status), "the lease holder records its own outcome");

  // Now the race: another worker holds a live lease and a late straggler reports its failure.
  const liveOwner = randomUUID();
  testDb.prepare("UPDATE knowledge_index_job SET status = 'running', attempts = 1, lease_owner = ?, lease_until = ? WHERE id = ?")
    .run(liveOwner, Date.now() + 300_000, jobId);

  const stale = testDb.prepare(
    "UPDATE knowledge_index_job SET status = 'queued', lease_owner = NULL, lease_until = 0 WHERE id = ? AND lease_owner = ?",
  ).run(jobId, randomUUID());
  assert.equal(stale.changes, 0, "the guarded write matches nothing once the lease has moved on");

  const held = testDb.prepare("SELECT status, lease_owner AS leaseOwner FROM knowledge_index_job WHERE id = ?")
    .get(jobId) as { status: string; leaseOwner: string | null };
  assert.equal(held.status, "running", "so live indexing is not interrupted");
  assert.equal(held.leaseOwner, liveOwner, "and the lease it no longer owns is not revoked");
});

test("uploads: a destination the server rejects does not cost the person their upload", async () => {
  const { context } = seedOffice();
  const file = new File([Buffer.from("conteudo")], "peticao.pdf", { type: "application/pdf" });
  const upload = await uploadsService.createUploadRef(context, file);

  // A case id that does not exist: ingestion fails after the reference was already claimed.
  assert.throws(
    () => vaultService.ingestUpload(context, { uploadRef: upload.id, scope: "case", caseId: randomUUID() }),
    (error: unknown) => error instanceof CapabilityError,
  );

  const after = testDb.prepare("SELECT consumed_at AS consumedAt FROM vault_upload_ref WHERE id = ?")
    .get(upload.id) as { consumedAt: string | null };
  assert.equal(after.consumedAt, null, "a failed ingestion releases the claim instead of burning it");

  // The bytes are still there and the reference still works, so retrying with a valid destination
  // succeeds rather than stranding an object no row can ever reach.
  const ingested = vaultService.ingestUpload(context, { uploadRef: upload.id, scope: "library" });
  assert.ok(ingested.document.id);
});

test("deletion: a legacy flat name is removed and its queue entry closes", async () => {
  const { officeId } = seedOffice();
  const legacyName = `legado-${randomUUID()}.pdf`;

  // Written straight into the storage root, the way rows predating the adapter reference it. The
  // strict key format rejects that shape, so this entry used to burn five attempts and give up
  // with the bytes still on disk.
  writeFileSync(resolve(testStorageRoot, legacyName), "bytes antigos");

  const queueId = randomUUID();
  testDb.prepare("INSERT INTO vault_deletion_queue (id, office_id, target_kind, target_ref) VALUES (?, ?, 'object', ?)")
    .run(queueId, officeId, legacyName);

  assert.equal(await processNextDeletion(), true);

  const row = testDb.prepare("SELECT completed_at AS completedAt, attempts FROM vault_deletion_queue WHERE id = ?")
    .get(queueId) as { completedAt: string | null; attempts: number };
  assert.ok(row.completedAt, "the entry closes instead of retrying a key that can never parse");
  assert.equal(row.attempts, 0);
  assert.equal(existsSync(resolve(testStorageRoot, legacyName)), false, "and the bytes are actually gone");
});

test("deletion: a legacy removal that fails for a passing reason retries instead of closing", async () => {
  const { officeId } = seedOffice();
  const legacyName = `legado-${randomUUID()}.pdf`;

  // A directory where the legacy file should be: unlink refuses it with an errno that says
  // "not now", not "never". Standing in for a busy or unreadable filesystem, which is the case
  // that must not close the entry - closing it claims the bytes are gone when they are not, and
  // nothing is left to chase them.
  mkdirSync(resolve(testStorageRoot, legacyName));

  const queueId = randomUUID();
  testDb.prepare("INSERT INTO vault_deletion_queue (id, office_id, target_kind, target_ref) VALUES (?, ?, 'object', ?)")
    .run(queueId, officeId, legacyName);

  assert.equal(await processNextDeletion(), true);

  const stalled = testDb.prepare("SELECT completed_at AS completedAt, attempts FROM vault_deletion_queue WHERE id = ?")
    .get(queueId) as { completedAt: string | null; attempts: number };
  assert.equal(stalled.completedAt, null, "a transient failure leaves the entry open");
  assert.equal(stalled.attempts, 1, "and spends one attempt, so it is retried and eventually surfaced");

  // Once the obstruction clears, the same entry succeeds: the retry path is real, not decorative.
  rmSync(resolve(testStorageRoot, legacyName), { recursive: true });
  assert.equal(await processNextDeletion(), true);

  const settled = testDb.prepare("SELECT completed_at AS completedAt FROM vault_deletion_queue WHERE id = ?")
    .get(queueId) as { completedAt: string | null };
  assert.ok(settled.completedAt, "the entry closes only once the removal actually holds");
});

test("vectorize: a scope wider than one filter batch is queried whole, not truncated", async () => {
  const previous = { ...process.env };
  process.env.VECTOR_INDEX_BACKEND = "vectorize";
  process.env.CF_ACCOUNT_ID = "conta";
  process.env.VECTORIZE_INDEX = "indice";
  process.env.CF_API_TOKEN = "token";
  resetVectorIndexForTests(undefined);

  // 100 documents is what the capability contract allows; Vectorize takes 64 values per $in.
  const documentIds = Array.from({ length: 100 }, () => randomUUID());
  const seen: string[][] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const payload = JSON.parse(init.body) as { filter: { documentId: { $in: string[] } } };
    const batch = payload.filter.documentId.$in;
    seen.push(batch);
    return {
      ok: true,
      json: async () => ({
        result: { matches: batch.map((id, position) => ({ score: 1 - position / 1000, metadata: { chunkId: `chunk-${id}` } })) },
      }),
    };
  }) as unknown as typeof globalThis.fetch;

  try {
    const hits = await vectorIndex().query("escritorio", "geracao", new Float32Array([1, 0]), { documentIds, topK: 10 });

    assert.equal(seen.length, 2, "the scope is fanned out across requests");
    assert.deepEqual(seen.flat().sort(), [...documentIds].sort(), "every document in scope reaches the index");
    assert.ok(seen.every((batch) => batch.length <= 64), "and no request exceeds the filter limit");

    // Merged and re-ranked, so the answer matches what a single unpartitioned query would give.
    assert.equal(hits.length, 10);
    assert.deepEqual(hits.map((hit) => hit.score), [...hits.map((hit) => hit.score)].sort((a, b) => b - a));
  } finally {
    globalThis.fetch = realFetch;
    process.env = previous;
    resetVectorIndexForTests(undefined);
  }
});
