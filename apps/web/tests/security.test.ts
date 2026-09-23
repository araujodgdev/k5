import { testDb } from "./test-setup";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { CapabilityError } from "../src/lib/capabilities/errors";
import { publishedCapabilitiesForRole } from "../src/lib/capabilities/contracts";
import type { WorkspaceContext } from "../src/lib/application/context";
import * as vaultService from "../src/lib/application/vault-service";
import * as approvalsService from "../src/lib/application/approvals-service";
import * as uploadsService from "../src/lib/application/uploads-service";
import { withIdempotency } from "../src/lib/application/idempotency-service";
import { assertStorageKey, objectStorage, resetObjectStorageForTests, storageKey } from "../src/lib/storage";
import { findVaultDocument, listVaultDocuments, retryVaultDocument, VaultHttpError } from "../src/lib/vault";
import { isTrustedOrigin } from "../src/lib/trusted-origins";
import { vaultErrorResponse } from "../src/lib/vault-api";
import { activityData } from "../src/lib/capabilities/agenda";

async function seedOffices() {
  const userLawyer = randomUUID();
  const userAdmin = randomUUID();
  const userOfficeB = randomUUID();
  const officeA = randomUUID();
  const officeB = randomUUID();

  (await testDb.prepare("INSERT INTO user (id, email, name) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)").run(
    userLawyer, `lawyer-${randomUUID()}@alfa.test`, "Lawyer Alfa",
    userAdmin, `admin-${randomUUID()}@alfa.test`, "Admin Alfa",
    userOfficeB, `user-${randomUUID()}@beta.test`, "User Beta",
  ));
  (await testDb.prepare("INSERT INTO office (id, name) VALUES (?, ?), (?, ?)").run(officeA, "Alfa", officeB, "Beta"));
  (await testDb.prepare("INSERT INTO office_member (id, office_id, user_id, role) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)").run(
    randomUUID(), officeA, userLawyer, "lawyer",
    randomUUID(), officeA, userAdmin, "administrator",
    randomUUID(), officeB, userOfficeB, "lawyer",
  ));

  return {
    lawyer: { officeId: officeA, userId: userLawyer, role: "lawyer" } as WorkspaceContext,
    admin: { officeId: officeA, userId: userAdmin, role: "administrator" } as WorkspaceContext,
    beta: { officeId: officeB, userId: userOfficeB, role: "lawyer" } as WorkspaceContext,
    officeA,
  };
}

function seedUpload(context: WorkspaceContext, name = "documento.pdf") {
  const file = new File([Buffer.from(`conteudo-${randomUUID()}`)], name, { type: "application/pdf" });
  return uploadsService.createUploadRef(context, file);
}

test("storage: a caller-supplied key cannot escape the vault root", async () => {
  const { lawyer, officeA } = (await seedOffices());

  // Ingest used to write `${uploadRef}.pdf` straight into stored_name, so a traversal sequence in
  // the reference became a readable path on the next download. References are uuids the server
  // minted, and anything else is refused before a row exists.
  for (const hostile of ["../../../../etc/passwd", "..\\..\\..\\windows\\win.ini", "../uploads/outro-escritorio"]) {
    await assert.rejects(
      () => vaultService.ingestUpload(lawyer, { uploadRef: hostile, scope: "library" }),
      "a path fragment is not a valid upload reference",
    );
  }

  // A well-formed but unknown reference is equally refused: existence is checked, not assumed.
  await assert.rejects(
    () => vaultService.ingestUpload(lawyer, { uploadRef: randomUUID(), scope: "library" }),
    (error: unknown) => error instanceof CapabilityError && error.code === "NOT_FOUND",
  );

  // The storage adapter rejects any key it did not mint, including a bare legacy-looking name.
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
      objects.set(key, new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice());
    },
    async get(key) {
      const value = objects.get(key);
      return value ? { arrayBuffer: async () => value.slice().buffer } : null;
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
    await storage.delete(key);
    await assert.rejects(() => storage.get(key), /não encontrado/);
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

  // Deletion parks the row in `failed`, which is exactly the state retry accepts. Without the
  // tombstone check the worker would re-extract the original and put it back into search.
  await assert.rejects(
    () => retryVaultDocument(officeA, documentId),
    (error: unknown) => error instanceof VaultHttpError && error.status === 409,
  );
  assert.equal(await findVaultDocument(officeA, documentId), undefined, "gone from every live lookup");
  assert.equal(
    (await listVaultDocuments(officeA, {})).some((document) => document.id === documentId),
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

  // Ingestion on Workers is kicked by the request that queues the document. When that kick never
  // lands the row sits in `queued`, and rejecting it here would leave the interface with a stuck
  // document and no button that does anything about it.
  assert.equal((await findVaultDocument(officeA, documentId))?.status, "queued");
  await retryVaultDocument(officeA, documentId);
  assert.equal((await findVaultDocument(officeA, documentId))?.status, "queued", "still claimable");

  // `processing` is someone else's lease, and `ready` is work that is done. Neither is stuck.
  (await testDb.prepare("UPDATE vault_document SET status='processing' WHERE id=?").run(documentId));
  await assert.rejects(
    () => retryVaultDocument(officeA, documentId),
    (error: unknown) => error instanceof VaultHttpError && error.status === 409,
  );
});

/** Proposes and approves in one step, the way a confirmation dialog in the interface does. */
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

  // Not reassigned to the library: a case that is gone does not leave its filings behind.
  assert.equal(await findVaultDocument(officeA, documentId), undefined, "gone from every live lookup");
  assert.equal((await listVaultDocuments(officeA, {})).length, 0, "and from the list the interface renders");
  const chunks = (await testDb.prepare("SELECT count(*) AS n FROM vault_document_chunk WHERE document_id=?").get(documentId)) as { n: number };
  assert.equal(Number(chunks.n), 0, "searchability is lost in the same batch as the tombstone");

  // Bytes and vectors are chased afterwards, by a queue that can retry without ever making the
  // document visible again.
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

  const moved = await findVaultDocument(officeA, documentId);
  assert.equal(moved?.caseId, target.id, "the escape hatch is what keeps the documents");
  const queued = (await testDb.prepare("SELECT count(*) AS n FROM vault_deletion_queue WHERE office_id=?").get(officeA)) as { n: number };
  assert.equal(Number(queued.n), 0, "and nothing is queued for physical removal");
});

test("case deletion: no approval, no deletion", async () => {
  const { lawyer, officeA } = (await seedOffices());
  const created = (await vaultService.createCase(lawyer, { name: "Caso protegido" })).case;
  const upload = await seedUpload(lawyer, "sigiloso.pdf");
  const documentId = (await vaultService.ingestUpload(lawyer, { uploadRef: upload.id, scope: "case", caseId: created.id })).document.id;

  // An agent reaching for this gets a proposal to show the person, never a deleted case.
  await assert.rejects(
    () => vaultService.deleteCase(lawyer, { caseId: created.id }),
    (error: unknown) => error instanceof CapabilityError && error.code === "APPROVAL_REQUIRED",
  );
  assert.ok(await findVaultDocument(officeA, documentId), "the documents are untouched");
});

test("idempotency: a reused key with different arguments conflicts instead of replaying", async () => {
  const { lawyer, admin } = (await seedOffices());

  let calls = 0;
  const run = () => { calls += 1; return Promise.resolve({ calls, value: "ok" }); };
  const key = `key-${randomUUID()}`;

  assert.equal((await withIdempotency(lawyer, "k5_vault_create_case", key, { name: "Alfa" }, run)).calls, 1);
  assert.equal((await withIdempotency(lawyer, "k5_vault_create_case", key, { name: "Alfa" }, run)).calls, 1);
  assert.equal(calls, 1, "a replay returns the stored response without running again");

  await assert.rejects(
    () => withIdempotency(lawyer, "k5_vault_create_case", key, { name: "Beta" }, run),
    (error: unknown) => error instanceof CapabilityError && error.code === "CONFLICT",
    "different arguments under the same key is a conflict, not a stale replay",
  );
  await assert.rejects(
    () => withIdempotency(lawyer, "k5_conversations_create", key, { name: "Alfa" }, run),
    (error: unknown) => error instanceof CapabilityError && error.code === "CONFLICT",
    "a key minted for one capability does not answer for another",
  );

  // Keys are scoped per person: a colleague reusing the same string runs their own call rather
  // than receiving someone else's stored response body.
  assert.equal((await withIdempotency(admin, "k5_vault_create_case", key, { name: "Gama" }, run)).calls, 2);
});

test("approval: a nested argument change invalidates the approval", async () => {
  const { lawyer } = (await seedOffices());

  const proposal = await approvalsService.createApprovalProposal(lawyer, "k5_vault_delete_document", {
    documentId: "doc-1",
    options: { mode: "replace", keepHistory: true },
  });
  await approvalsService.approveProposal(lawyer, proposal.id);

  // `JSON.stringify(obj, Object.keys(obj).sort())` reads like a sort but is a recursive property
  // filter, so nested fields dropped out of the canonical form and changing one went unnoticed.
  await assert.rejects(
    () => approvalsService.requireAndConsumeApproval(lawyer, "k5_vault_delete_document", proposal.id, {
      documentId: "doc-1",
      options: { mode: "delete", keepHistory: true },
    }),
    (error: unknown) => error instanceof CapabilityError && error.code === "FORBIDDEN",
  );

  // Reordering the same values is still the same request.
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

  // Both calls reach their first await before either continuation runs. Rejection is deliberately
  // started first, so an unconditional approval update would overwrite it on the next microtask.
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
  const agentNames = publishedCapabilitiesForRole("administrator", "agent");
  const browserNames = publishedCapabilitiesForRole("administrator", "webmcp");

  // Terminal, irreversible, and triggerable from text the agent is reading. The interface keeps
  // the button; neither adapter gets a tool for it.
  assert.ok(!agentNames.includes("k5_session_end_global"));
  assert.ok(!browserNames.includes("k5_session_end_global"));
  assert.ok(agentNames.includes("k5_knowledge_search"));

  // Role still decides the rest.
  assert.ok(!publishedCapabilitiesForRole("reviewer", "agent").includes("k5_vault_delete_document"));
});

test("origins: the wildcard the tunnel default declares is honoured, and nothing wider", () => {
  const patterns = ["http://localhost:3000", "https://*.trycloudflare.com"];

  // The exact app URL and a quick tunnel of the configured zone.
  assert.equal(isTrustedOrigin("http://localhost:3000", patterns), true);
  assert.equal(isTrustedOrigin("https://going-officials-kenny-axis.trycloudflare.com", patterns), true);

  // One label only: neither the apex nor a deeper subdomain is covered by `*.`.
  assert.equal(isTrustedOrigin("https://trycloudflare.com", patterns), false);
  assert.equal(isTrustedOrigin("https://a.b.trycloudflare.com", patterns), false);

  // A suffix that merely ends in the same characters is a different host.
  assert.equal(isTrustedOrigin("https://eviltrycloudflare.com", patterns), false);
  assert.equal(isTrustedOrigin("https://trycloudflare.com.evil.test", patterns), false);

  // Scheme and port are part of an origin and are never wildcarded.
  assert.equal(isTrustedOrigin("http://tunnel.trycloudflare.com", patterns), false);
  assert.equal(isTrustedOrigin("https://tunnel.trycloudflare.com:8443", patterns), false);
  assert.equal(isTrustedOrigin("http://localhost:3001", patterns), false);

  // A missing header, a path, or anything that is not an origin fails closed.
  assert.equal(isTrustedOrigin(null, patterns), false);
  assert.equal(isTrustedOrigin("", patterns), false);
  assert.equal(isTrustedOrigin("http://localhost:3000/api/chat", patterns), false);
  assert.equal(isTrustedOrigin("null", patterns), false);
  assert.equal(isTrustedOrigin("https://going-officials-kenny-axis.trycloudflare.com", []), false);
});

test("vault routes answer domain validation errors with 400 and the domain message", async () => {
  const response = vaultErrorResponse(new CapabilityError("INVALID", "O arquivo está vazio."));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "O arquivo está vazio.", code: "INVALID" });
});

test("approval responses omit tenant ids and the stored input", () => {
  const dto = approvalsService.publicApproval({
    id: "a1", office_id: "o1", user_id: "u1", capability_name: "k5_vault_delete_case", normalized_input: "{}",
    target_resource_id: "c1", target_version: null, status: "pending", expires_at: 0, created_at: "2026-09-23", consumed_at: null,
  });
  assert.deepEqual(Object.keys(dto).sort(), ["capabilityName", "createdAt", "expiresAt", "id", "status", "targetResourceId"]);
  assert.equal(dto.expiresAt, "1970-01-01T00:00:00.000Z");
});

// apiError shows the first Zod issue only when it is `custom`, so person-facing rules must stay custom.
test("meeting ending before it starts fails with a custom pt-BR issue", () => {
  const parsed = activityData.safeParse({ kind: "meeting", title: "Reunião", startsAt: "2026-09-23T10:00:00Z", endsAt: "2026-09-23T09:00:00Z" });
  assert.ok(!parsed.success);
  assert.equal(parsed.error.issues[0].code, "custom");
  assert.equal(parsed.error.issues[0].message, "Reuniões exigem início e fim posterior; tarefas usam apenas uma data.");
});
