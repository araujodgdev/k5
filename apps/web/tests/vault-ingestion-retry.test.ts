import { testDb } from "./test-setup";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { WorkspaceContext } from "../src/lib/application/context";
import * as vaultService from "../src/lib/application/vault-service";
import * as uploadsService from "../src/lib/application/uploads-service";
import { ContainerBindingError } from "../src/lib/container-bindings";
import { objectStorage, resetObjectStorageForTests, type ObjectStorage } from "../src/lib/storage";
import { claimQueuedDocument, findVaultDocument, processDocument, retryVaultDocument, STORAGE_RETRY_DELAYS_SECONDS } from "../src/lib/vault";

async function seedOffice(): Promise<WorkspaceContext> {
  const userId = randomUUID();
  const officeId = randomUUID();
  await testDb.prepare("INSERT INTO user (id, email, name) VALUES (?, ?, ?)").run(userId, `retry-${randomUUID()}@lume.test`, "Retry");
  await testDb.prepare("INSERT INTO office (id, name) VALUES (?, ?)").run(officeId, "Retry");
  await testDb.prepare("INSERT INTO office_member (id, office_id, user_id) VALUES (?, ?, ?)").run(randomUUID(), officeId, userId);
  return { officeId, userId } as WorkspaceContext;
}

const ingestion = (id: string) => testDb.prepare(
  "SELECT status, error_message AS error, ingestion_attempts AS attempts, retry_at > CURRENT_TIMESTAMP AS waiting FROM vault_document WHERE id=?",
).get<{ status: string; error: string | null; attempts: number; waiting: boolean | null }>(id);

// LUME-1E: during a deploy the processor's binding answered 403 for two originals, and the
// documents became terminal failures with a static message that no longer named the cause.
test("ingestion: a storage outage goes back to the queue with a delay, then fails after the last attempt", async () => {
  const office = await seedOffice();
  const upload = await uploadsService.createUploadRef(office, new File(["conteúdo"], "peticao.txt", { type: "text/plain" }));
  const documentId = (await vaultService.ingestUpload(office, { uploadRef: upload.id, scope: "library" })).document.id;

  const real = await objectStorage();
  const unavailable: ObjectStorage = { ...real, get: async () => { throw new ContainerBindingError(403, undefined); } };
  resetObjectStorageForTests(unavailable);
  try {
    await processDocument(documentId, office.officeId);
    let row = await ingestion(documentId);
    assert.equal(row?.status, "queued", "an outage is not a verdict on the document");
    assert.equal(row?.attempts, 1);
    assert.equal(row?.waiting, true, "the next attempt waits instead of spinning against the same outage");
    assert.equal(row?.error, null);
    const claimed = await claimQueuedDocument();
    assert.notEqual(claimed?.document.id, documentId, "not claimable before retry_at");

    await testDb.prepare("UPDATE vault_document SET ingestion_attempts=? WHERE id=?").run(STORAGE_RETRY_DELAYS_SECONDS.length, documentId);
    await assert.rejects(() => processDocument(documentId, office.officeId));
    row = await ingestion(documentId);
    assert.equal(row?.status, "failed", "after the last delay the document fails and the person can retry");
    assert.equal(row?.error, "Armazenamento de documentos indisponível.");
  } finally {
    resetObjectStorageForTests(undefined);
  }

  await retryVaultDocument(office.officeId, documentId);
  const reset = await ingestion(documentId);
  assert.equal(reset?.attempts, 0, "a manual retry starts the count again");
  assert.equal(reset?.waiting, null);
  await processDocument(documentId, office.officeId);
  assert.equal((await findVaultDocument(office.officeId, documentId, null))?.status, "ready");
});
