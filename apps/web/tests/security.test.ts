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
import { assertStorageKey, storageKey } from "../src/lib/storage";
import { findVaultDocument, listVaultDocuments, retryVaultDocument, VaultHttpError } from "../src/lib/vault";
import { isTrustedOrigin } from "../src/lib/trusted-origins";

function seedOffices() {
  const userLawyer = randomUUID();
  const userAdmin = randomUUID();
  const userOfficeB = randomUUID();
  const officeA = randomUUID();
  const officeB = randomUUID();

  testDb.prepare("INSERT INTO user (id, email, name) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)").run(
    userLawyer, `lawyer-${randomUUID()}@alfa.test`, "Lawyer Alfa",
    userAdmin, `admin-${randomUUID()}@alfa.test`, "Admin Alfa",
    userOfficeB, `user-${randomUUID()}@beta.test`, "User Beta",
  );
  testDb.prepare("INSERT INTO office (id, name) VALUES (?, ?), (?, ?)").run(officeA, "Alfa", officeB, "Beta");
  testDb.prepare("INSERT INTO office_member (id, office_id, user_id, role) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)").run(
    randomUUID(), officeA, userLawyer, "lawyer",
    randomUUID(), officeA, userAdmin, "administrator",
    randomUUID(), officeB, userOfficeB, "lawyer",
  );

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
  const { lawyer, officeA } = seedOffices();

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

test("uploads: a reference is single use and bound to its office and its person", async () => {
  const { lawyer, admin, beta } = seedOffices();
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
  const { lawyer, officeA } = seedOffices();
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

  const queued = testDb.prepare(
    "SELECT count(*) AS n FROM vault_deletion_queue WHERE office_id=? AND completed_at IS NULL",
  ).get(officeA) as { n: number };
  assert.ok(Number(queued.n) >= 1, "physical cleanup is queued after the tombstone, not instead of it");
});

test("idempotency: a reused key with different arguments conflicts instead of replaying", async () => {
  const { lawyer, admin } = seedOffices();

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
  const { lawyer } = seedOffices();

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
  const { lawyer, admin } = seedOffices();
  const proposal = await approvalsService.createApprovalProposal(lawyer, "k5_vault_delete_document", { documentId: "doc-2" });

  await assert.rejects(
    () => approvalsService.approveProposal(admin, proposal.id),
    (error: unknown) => error instanceof CapabilityError && error.code === "NOT_FOUND",
  );
});

test("approval: concurrent decisions cannot overwrite the first transition", async () => {
  const { lawyer } = seedOffices();
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
