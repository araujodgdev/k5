import { testDb } from "./test-setup";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { CapabilityError } from "../src/lib/capabilities/errors";
import { publishedCapabilities } from "../src/lib/capabilities/contracts";
import type { WorkspaceContext } from "../src/lib/application/context";
import * as vaultService from "../src/lib/application/vault-service";
import * as approvalsService from "../src/lib/application/approvals-service";
import * as uploadsService from "../src/lib/application/uploads-service";
import { withIdempotency } from "../src/lib/application/idempotency-service";
import { assertStorageKey, objectStorage, resetObjectStorageForTests, storageKey } from "../src/lib/storage";
import { findVaultDocument, listVaultDocuments, retryVaultDocument, VaultHttpError } from "../src/lib/vault";
import { isTrustedOrigin } from "../src/lib/trusted-origins";
import { activityData } from "../src/lib/capabilities/agenda";

async function seedOffices() {
  const userLawyer = randomUUID();
  const userAdmin = randomUUID();
  const userOfficeB = randomUUID();
  const officeA = randomUUID();
  const officeB = randomUUID();
  const officeAdmin = randomUUID();

  (await testDb.prepare("INSERT INTO user (id, email, name) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)").run(
    userLawyer, `lawyer-${randomUUID()}@alfa.test`, "Lawyer Alfa",
    userAdmin, `admin-${randomUUID()}@alfa.test`, "Admin Alfa",
    userOfficeB, `user-${randomUUID()}@beta.test`, "User Beta",
  ));
  (await testDb.prepare("INSERT INTO office (id, name) VALUES (?, ?), (?, ?), (?, ?)").run(officeA, "Alfa", officeB, "Beta", officeAdmin, "Associado"));
  (await testDb.prepare("INSERT INTO office_member (id, office_id, user_id) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)").run(
    randomUUID(), officeA, userLawyer,
    randomUUID(), officeAdmin, userAdmin,
    randomUUID(), officeB, userOfficeB,
  ));

  return {
    lawyer: { officeId: officeA, userId: userLawyer } as WorkspaceContext,
    admin: { officeId: officeAdmin, userId: userAdmin } satisfies WorkspaceContext,
    beta: { officeId: officeB, userId: userOfficeB } as WorkspaceContext,
    officeA,
  };
}

function seedUpload(context: WorkspaceContext, name = "documento.pdf") {
  const file = new File([Buffer.from(`conteudo-${randomUUID()}`)], name, { type: "application/pdf" });
  return uploadsService.createUploadRef(context, file);
}

test('uploads: aceita 100 MB e recusa um byte a mais antes de armazenar', async () => {
  const { lawyer } = await seedOffices();
  const bytes = Buffer.alloc(100 * 1024 * 1024, 32);
  const oversized = new File([bytes, new Uint8Array([32])], 'grande.txt');
  await assert.rejects(uploadsService.createUploadRef(lawyer, oversized), /100 MB/);
  assert.equal((await testDb.prepare('SELECT count(*) AS n FROM vault_upload_ref WHERE office_id=?')
    .get<{ n: number }>(lawyer.officeId))?.n, 0);

  const file = new File([bytes], 'limite.txt');
  const upload = await uploadsService.createUploadRef(lawyer, file);
  try {
    assert.equal(upload.byteSize, bytes.length);
    const stored = await (await objectStorage()).get(upload.storageKey);
    assert.equal(stored.length, bytes.length);
    assert.equal(stored.compare(bytes), 0);
  } finally {
    await (await objectStorage()).delete(upload.storageKey);
    await testDb.prepare('DELETE FROM vault_upload_ref WHERE id=?').run(upload.id);
  }
});

test("storage: a caller-supplied key cannot escape the vault root", async () => {
  const { lawyer, officeA } = (await seedOffices());

  for (const hostile of ["../../../../etc/passwd", "..\\..\\..\\windows\\win.ini", "../uploads/outro-escritorio"]) {
    await assert.rejects(
      () => vaultService.ingestUpload(lawyer, { uploadRef: hostile, scope: "library" }),
      "a path fragment is not a valid upload reference",
    );
  }

  await assert.rejects(
    () => vaultService.ingestUpload(lawyer, { uploadRef: randomUUID(), scope: "library" }),
    (error: unknown) => error instanceof CapabilityError && error.code === "NOT_FOUND",
  );

  assert.throws(() => assertStorageKey("../../segredo.pdf"), /inválida/);
  assert.throws(() => assertStorageKey("arquivo-solto.pdf"), /inválida/);
  assert.ok(assertStorageKey(storageKey(officeA, randomUUID(), ".pdf")));
});

test("storage: the Worker R2 binding is preferred without S3 credentials", async () => {
  const previous = { ...process.env };
  process.env.VAULT_STORAGE_BACKEND = "r2";
  delete process.env.R2_BUCKET;
  delete process.env.R2_ACCOUNT_ID;
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;

  const objects = new Map<string, Uint8Array>();
  resetObjectStorageForTests(undefined, {
    async put(key, value) {
      objects.set(key, value instanceof Blob ? new Uint8Array(await value.arrayBuffer())
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice());
    },
    async get(key) {
      const value = objects.get(key);
      return value ? { body: new Blob([value.slice()]).stream(), arrayBuffer: async () => value.slice().buffer } : null;
    },
    async delete(key) {
      objects.delete(key);
    },
  });

  try {
    const storage = await objectStorage();
    const key = storageKey(randomUUID(), randomUUID(), ".txt");
    await storage.put(key, Buffer.from("binding-r2"));
    assert.equal((await storage.get(key)).toString(), "binding-r2");
    assert.ok(storage.getStream);
    assert.equal(await new Response(await storage.getStream(key)).text(), 'binding-r2');
    await storage.delete(key);
    await assert.rejects(() => storage.get(key), /não encontrado/);
    const { lawyer } = await seedOffices();
    const upload = await uploadsService.createUploadRef(lawyer, new File(['binding-file'], 'via-binding.txt'));
    assert.equal((await storage.get(upload.storageKey)).toString(), 'binding-file');
    assert.equal(upload.sha256, createHash('sha256').update('binding-file').digest('hex'));
    await storage.delete(upload.storageKey);
    await testDb.prepare('DELETE FROM vault_upload_ref WHERE id=?').run(upload.id);
  } finally {
    process.env = previous;
    resetObjectStorageForTests(undefined);
  }
});

test("uploads: a reference is single use and bound to its office and its person", async () => {
  const { lawyer, admin, beta } = (await seedOffices());
  const upload = await seedUpload(lawyer, "peticao.pdf");

  await assert.rejects(
    () => vaultService.ingestUpload(beta, { uploadRef: upload.id, scope: "library" }),
    (error: unknown) => error instanceof CapabilityError && error.code === "NOT_FOUND",
    "another office cannot claim this upload",
  );
  await assert.rejects(
    () => vaultService.ingestUpload(admin, { uploadRef: upload.id, scope: "library" }),
    (error: unknown) => error instanceof CapabilityError && error.code === "NOT_FOUND",
    "another member cannot claim an upload they did not make",
  );

  const first = await vaultService.ingestUpload(lawyer, { uploadRef: upload.id, scope: "library" });
  assert.ok(first.document.id);

  await assert.rejects(
    () => vaultService.ingestUpload(lawyer, { uploadRef: upload.id, scope: "library" }),
    (error: unknown) => error instanceof CapabilityError && error.code === "CONFLICT",
    "one reference ingests one file, once",
  );
});

test("tombstone: a deleted document cannot be resurrected through retry", async () => {
  const { lawyer, officeA } = (await seedOffices());
  const upload = await seedUpload(lawyer, "sigiloso.pdf");
  const documentId = (await vaultService.ingestUpload(lawyer, { uploadRef: upload.id, scope: "library" })).document.id;

  const proposal = await approvalsService.createApprovalProposal(lawyer, "k5_vault_delete_document", { documentId });
  await approvalsService.approveProposal(lawyer, proposal.id);
  await vaultService.deleteDocument(lawyer, { documentId, approvalId: proposal.id });

  await assert.rejects(
    () => retryVaultDocument(officeA, documentId),
    (error: unknown) => error instanceof VaultHttpError && error.status === 409,
  );
  assert.equal(await findVaultDocument(officeA, documentId, null), undefined, "gone from every live lookup");
  assert.equal(
    (await listVaultDocuments(officeA, null, {})).some((document) => document.id === documentId),
    false,
    "and from the list the interface renders",
  );

  const queued = (await testDb.prepare(
    "SELECT count(*) AS n FROM vault_deletion_queue WHERE office_id=? AND completed_at IS NULL",
  ).get(officeA)) as { n: number };
  assert.ok(Number(queued.n) >= 1, "physical cleanup is queued after the tombstone, not instead of it");
});

test("retry: a document left in the queue can be requeued, a live one cannot", async () => {
  const { lawyer, officeA } = (await seedOffices());
  const upload = await seedUpload(lawyer, "parado.pdf");
  const documentId = (await vaultService.ingestUpload(lawyer, { uploadRef: upload.id, scope: "library" })).document.id;

  assert.equal((await findVaultDocument(officeA, documentId, null))?.status, "queued");
  await retryVaultDocument(officeA, documentId);
  assert.equal((await findVaultDocument(officeA, documentId, null))?.status, "queued", "still claimable");

  (await testDb.prepare("UPDATE vault_document SET status='processing' WHERE id=?").run(documentId));
  await assert.rejects(
    () => retryVaultDocument(officeA, documentId),
    (error: unknown) => error instanceof VaultHttpError && error.status === 409,
  );
});

async function approved(context: WorkspaceContext, capability: string, input: Record<string, unknown>) {
  const proposal = await approvalsService.createApprovalProposal(context, capability, input);
  await approvalsService.approveProposal(context, proposal.id);
  return proposal.id;
}

test("case deletion: the documents filed in a case go with it", async () => {
  const { lawyer, officeA } = (await seedOffices());
  const created = (await vaultService.createCase(lawyer, { name: "Simons vs Hugsfield" })).case;
  const upload = await seedUpload(lawyer, "peticao.pdf");
  const documentId = (await vaultService.ingestUpload(lawyer, { uploadRef: upload.id, scope: "case", caseId: created.id })).document.id;
  (await testDb.prepare("INSERT INTO vault_document_chunk (id, document_id, office_id, ordinal, stable_reference, content) VALUES (?, ?, ?, 0, 'página:1', 'texto')")
    .run(randomUUID(), documentId, officeA));

  await vaultService.deleteCase(lawyer, { caseId: created.id, approvalId: await approved(lawyer, "k5_vault_delete_case", { caseId: created.id }) });

  assert.equal(await findVaultDocument(officeA, documentId, null), undefined, "gone from every live lookup");
  assert.equal((await listVaultDocuments(officeA, null, {})).length, 0, "and from the list the interface renders");
  const chunks = (await testDb.prepare("SELECT count(*) AS n FROM vault_document_chunk WHERE document_id=?").get(documentId)) as { n: number };
  assert.equal(Number(chunks.n), 0, "searchability is lost in the same batch as the tombstone");

  const queued = (await testDb.prepare("SELECT target_kind AS kind FROM vault_deletion_queue WHERE office_id=? AND completed_at IS NULL").all(officeA)) as Array<{ kind: string }>;
  assert.ok(queued.some((row) => row.kind === "vector_document"), "the index entry is queued for removal");
  assert.ok(queued.some((row) => row.kind === "object"), "so are the stored bytes");
});

test("case deletion: targetCaseId moves the documents instead of deleting them", async () => {
  const { lawyer, officeA } = (await seedOffices());
  const source = (await vaultService.createCase(lawyer, { name: "Caso de origem" })).case;
  const target = (await vaultService.createCase(lawyer, { name: "Caso de destino" })).case;
  const upload = await seedUpload(lawyer, "contrato.pdf");
  const documentId = (await vaultService.ingestUpload(lawyer, { uploadRef: upload.id, scope: "case", caseId: source.id })).document.id;

  const input = { caseId: source.id, targetCaseId: target.id };
  await vaultService.deleteCase(lawyer, { ...input, approvalId: await approved(lawyer, "k5_vault_delete_case", input) });

  const moved = await findVaultDocument(officeA, documentId, null);
  assert.equal(moved?.caseId, target.id, "the escape hatch is what keeps the documents");
  const queued = (await testDb.prepare("SELECT count(*) AS n FROM vault_deletion_queue WHERE office_id=?").get(officeA)) as { n: number };
  assert.equal(Number(queued.n), 0, "and nothing is queued for physical removal");
});

test("case deletion: no approval, no deletion", async () => {
  const { lawyer, officeA } = (await seedOffices());
  const created = (await vaultService.createCase(lawyer, { name: "Caso protegido" })).case;
  const upload = await seedUpload(lawyer, "sigiloso.pdf");
  const documentId = (await vaultService.ingestUpload(lawyer, { uploadRef: upload.id, scope: "case", caseId: created.id })).document.id;

  await assert.rejects(
    () => vaultService.deleteCase(lawyer, { caseId: created.id }),
    (error: unknown) => error instanceof CapabilityError && error.code === "APPROVAL_REQUIRED",
  );
  assert.ok(await findVaultDocument(officeA, documentId, null), "the documents are untouched");
});

test("idempotency: a reused key with different arguments conflicts instead of replaying", async () => {
  const { lawyer, admin } = (await seedOffices());

  let calls = 0;
  const run = () => { calls += 1; return Promise.resolve({ calls, value: "ok" }); };
  const key = `key-${randomUUID()}`;

  assert.equal((await withIdempotency(lawyer, "k5_vault_create_case", key, { name: "Alfa" }, run, async () => ({ format: 2, payloadDigest: 'test-only', contentIdentities: [], identities: [], policies: [] }), async result => result)).calls, 1);
  assert.equal((await withIdempotency(lawyer, "k5_vault_create_case", key, { name: "Alfa" }, run, async () => ({ format: 2, payloadDigest: 'test-only', contentIdentities: [], identities: [], policies: [] }), async result => result)).calls, 1);
  assert.equal(calls, 1, "a replay returns the stored response without running again");

  await assert.rejects(
    () => withIdempotency(lawyer, "k5_vault_create_case", key, { name: "Beta" }, run, async () => ({ format: 2, payloadDigest: 'test-only', contentIdentities: [], identities: [], policies: [] }), async result => result),
    (error: unknown) => error instanceof CapabilityError && error.code === "CONFLICT",
    "different arguments under the same key is a conflict, not a stale replay",
  );
  await assert.rejects(
    () => withIdempotency(lawyer, "k5_conversations_create", key, { name: "Alfa" }, run, async () => ({ format: 2, payloadDigest: 'test-only', contentIdentities: [], identities: [], policies: [] }), async result => result),
    (error: unknown) => error instanceof CapabilityError && error.code === "CONFLICT",
    "a key minted for one capability does not answer for another",
  );

  assert.equal((await withIdempotency(admin, "k5_vault_create_case", key, { name: "Gama" }, run, async () => ({ format: 2, payloadDigest: 'test-only', contentIdentities: [], identities: [], policies: [] }), async result => result)).calls, 2);
});

test("concurrency: simultaneous creations with the same name resolve to one case", async () => {
  const { lawyer, officeA } = (await seedOffices());

  const results = await Promise.all(Array.from({ length: 12 }, () => vaultService.createCase(lawyer, { name: "Caso Único" })));

  assert.equal(new Set(results.map((result) => result.case.id)).size, 1, "every caller gets the same case back");
  assert.equal(results.filter((result) => result.created).length, 1, "exactly one caller created it");
  const rows = (await testDb.prepare("SELECT count(*) AS n FROM vault_case WHERE office_id=? AND deleted_at IS NULL AND lower(name)=lower(?)").get(officeA, "Caso Único")) as { n: number };
  assert.equal(Number(rows.n), 1, "and the office holds a single row with that name");
});

test("concurrency: simultaneous calls with the same idempotencyKey run the write once", async () => {
  const { lawyer, officeA } = (await seedOffices());

  let executions = 0;
  const key = `key-${randomUUID()}`;
  const binding = async () => ({ format: 2 as const, payloadDigest: 'test-only', contentIdentities: [], identities: [], policies: [] });
  const slowCreate = async () => {
    executions += 1;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    return vaultService.createCase(lawyer, { name: "Alfa" });
  };
  const results = await Promise.all(Array.from({ length: 6 }, () =>
    withIdempotency(lawyer, "k5_vault_create_case", key, { name: "Alfa" }, slowCreate, binding, async (result) => result)));

  assert.equal(executions, 1, "only the caller that claimed the key runs the write");
  assert.equal(new Set(results.map((result) => result.case.id)).size, 1, "the others replay its response");
  const rows = (await testDb.prepare("SELECT count(*) AS n FROM vault_case WHERE office_id=? AND deleted_at IS NULL").get(officeA)) as { n: number };
  assert.equal(Number(rows.n), 1, "one row reaches the database");
});

test("approval: a nested argument change invalidates the approval", async () => {
  const { lawyer } = (await seedOffices());

  const proposal = await approvalsService.createApprovalProposal(lawyer, "k5_vault_delete_document", {
    documentId: "doc-1",
    options: { mode: "replace", keepHistory: true },
  });
  await approvalsService.approveProposal(lawyer, proposal.id);

  await assert.rejects(
    () => approvalsService.requireAndConsumeApproval(lawyer, "k5_vault_delete_document", proposal.id, {
      documentId: "doc-1",
      options: { mode: "delete", keepHistory: true },
    }),
    (error: unknown) => error instanceof CapabilityError && error.code === "FORBIDDEN",
  );

  await approvalsService.requireAndConsumeApproval(lawyer, "k5_vault_delete_document", proposal.id, {
    options: { keepHistory: true, mode: "replace" },
    documentId: "doc-1",
  });

  await assert.rejects(
    () => approvalsService.requireAndConsumeApproval(lawyer, "k5_vault_delete_document", proposal.id, {
      options: { keepHistory: true, mode: "replace" },
      documentId: "doc-1",
    }),
    (error: unknown) => error instanceof CapabilityError && error.code === "CONFLICT",
    "an approval is spent once",
  );
});

test("approval: a colleague cannot approve a proposal addressed to someone else", async () => {
  const { lawyer, admin } = (await seedOffices());
  const proposal = await approvalsService.createApprovalProposal(lawyer, "k5_vault_delete_document", { documentId: "doc-2" });

  await assert.rejects(
    () => approvalsService.approveProposal(admin, proposal.id),
    (error: unknown) => error instanceof CapabilityError && error.code === "NOT_FOUND",
  );
});

test("approval: concurrent decisions cannot overwrite the first transition", async () => {
  const { lawyer } = (await seedOffices());
  const proposal = await approvalsService.createApprovalProposal(lawyer, "k5_vault_delete_document", { documentId: "doc-race" });

  const [rejected, approved] = await Promise.allSettled([
    approvalsService.rejectProposal(lawyer, proposal.id),
    approvalsService.approveProposal(lawyer, proposal.id),
  ]);

  assert.equal(rejected.status, "fulfilled");
  assert.equal(approved.status, "rejected");
  assert.ok(approved.status === "rejected" && approved.reason instanceof CapabilityError && approved.reason.code === "CONFLICT");
  assert.equal((await approvalsService.getApprovalProposal(lawyer, proposal.id)).status, "rejected");
});

test("publication: no adapter may offer a capability marked unpublished", () => {
  const agentNames = publishedCapabilities("agent");
  const browserNames = publishedCapabilities("webmcp");

  assert.ok(!agentNames.includes("k5_session_end_global"));
  assert.ok(!browserNames.includes("k5_session_end_global"));
  assert.ok(agentNames.includes("k5_knowledge_search"));

  assert.ok(agentNames.includes("k5_vault_delete_document"));
});

test("origins: the wildcard the tunnel default declares is honoured, and nothing wider", () => {
  const patterns = ["http://localhost:3000", "https://*.trycloudflare.com"];

  assert.equal(isTrustedOrigin("http://localhost:3000", patterns), true);
  assert.equal(isTrustedOrigin("https://going-officials-kenny-axis.trycloudflare.com", patterns), true);

  assert.equal(isTrustedOrigin("https://trycloudflare.com", patterns), false);
  assert.equal(isTrustedOrigin("https://a.b.trycloudflare.com", patterns), false);

  assert.equal(isTrustedOrigin("https://eviltrycloudflare.com", patterns), false);
  assert.equal(isTrustedOrigin("https://trycloudflare.com.evil.test", patterns), false);

  assert.equal(isTrustedOrigin("http://tunnel.trycloudflare.com", patterns), false);
  assert.equal(isTrustedOrigin("https://tunnel.trycloudflare.com:8443", patterns), false);
  assert.equal(isTrustedOrigin("http://localhost:3001", patterns), false);

  assert.equal(isTrustedOrigin(null, patterns), false);
  assert.equal(isTrustedOrigin("", patterns), false);
  assert.equal(isTrustedOrigin("http://localhost:3000/api/chat", patterns), false);
  assert.equal(isTrustedOrigin("null", patterns), false);
  assert.equal(isTrustedOrigin("https://going-officials-kenny-axis.trycloudflare.com", []), false);
});

test("approval responses omit tenant ids and the stored input", () => {
  const dto = approvalsService.publicApproval({
    id: "a1", office_id: "o1", user_id: "u1", capability_name: "k5_vault_delete_case", normalized_input: "{}",
    target_resource_id: "c1", target_version: null, status: "pending", expires_at: 0, created_at: "2026-09-23", consumed_at: null,
  });
  assert.deepEqual(Object.keys(dto).sort(), ["capabilityName", "createdAt", "expiresAt", "id", "status", "targetResourceId"]);
  assert.equal(dto.expiresAt, "1970-01-01T00:00:00.000Z");
});

test("meeting ending before it starts fails with a custom pt-BR issue", () => {
  const parsed = activityData.safeParse({ kind: "meeting", title: "Reunião", startsAt: "2026-09-23T10:00:00Z", endsAt: "2026-09-23T09:00:00Z" });
  assert.ok(!parsed.success);
  assert.equal(parsed.error.issues[0].code, "custom");
  assert.equal(parsed.error.issues[0].message, "Reuniões exigem início e fim posterior; tarefas usam apenas uma data.");
});
