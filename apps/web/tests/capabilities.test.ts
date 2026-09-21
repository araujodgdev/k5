import { testDb } from "./test-setup";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";

import {
  capabilities,
  capabilitiesForRole,
  capabilityNames,
  publishedCapabilitiesForRole,
} from "../src/lib/capabilities/contracts";
import { CapabilityError } from "../src/lib/capabilities/errors";
import { assertCapabilityAllowed, type WorkspaceContext } from "../src/lib/application/context";
import * as vaultService from "../src/lib/application/vault-service";
import * as artifactsService from "../src/lib/application/artifacts-service";
import * as conversationsService from "../src/lib/application/conversations-service";
import * as knowledgeService from "../src/lib/application/knowledge-service";
import * as approvalsService from "../src/lib/application/approvals-service";
import { withIdempotency } from "../src/lib/application/idempotency-service";
import { agentTools, toolSummary } from "../src/lib/agent-tools";
import { registerWebMCPCapabilities, executeViaHttp } from "../src/lib/webmcp/adapter";
import { strictBooleanQueryParam } from "../src/lib/query-params";
import * as uploadsService from "../src/lib/application/uploads-service";
import { vectorIndex } from "../src/lib/knowledge/vector-index";
import * as uiService from "../src/lib/application/ui-service";
import * as platformService from "../src/lib/application/platform-service";
import { grantPlatformAdmin } from "../src/lib/platform-core";
import { createSecretRef } from "../src/lib/application/secrets-service";

function seedFixture() {
  const userAdmin = randomUUID();
  const userLawyer = randomUUID();
  const userReviewer = randomUUID();
  const userOfficeB = randomUUID();

  const officeA = randomUUID();
  const officeB = randomUUID();

  testDb.prepare("INSERT INTO user (id, email, name) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?)")
    .run(
      userAdmin, `admin-${randomUUID()}@alfa.test`, "Admin Alfa",
      userLawyer, `lawyer-${randomUUID()}@alfa.test`, "Lawyer Alfa",
      userReviewer, `reviewer-${randomUUID()}@alfa.test`, "Reviewer Alfa",
      userOfficeB, `user-${randomUUID()}@beta.test`, "User Beta"
    );

  testDb.prepare("INSERT INTO office (id, name) VALUES (?, ?), (?, ?)")
    .run(officeA, "Alfa Advocacia", officeB, "Beta Advocacia");

  testDb.prepare("INSERT INTO office_member (id, office_id, user_id, role) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)")
    .run(
      randomUUID(), officeA, userAdmin, "administrator",
      randomUUID(), officeA, userLawyer, "lawyer",
      randomUUID(), officeA, userReviewer, "reviewer",
      randomUUID(), officeB, userOfficeB, "lawyer"
    );

  return { userAdmin, userLawyer, userReviewer, userOfficeB, officeA, officeB };
}

/** Mints a genuine upload reference: bytes through the storage adapter, row in the database. */
function seedUpload(context: WorkspaceContext, name = "documento.pdf") {
  const file = new File([Buffer.from(`conteudo-${randomUUID()}`)], name, { type: "application/pdf" });
  return uploadsService.createUploadRef(context, file);
}

test("capabilities contract: complete catalog and role permissions", () => {
  assert.equal(capabilityNames.length, 50, "All 50 capabilities declared");

  const reviewerCaps = capabilitiesForRole("reviewer");
  const lawyerCaps = capabilitiesForRole("lawyer");
  const adminCaps = capabilitiesForRole("administrator");

  // Reviewer only has read capabilities on office data (plus self session termination)
  for (const name of reviewerCaps) {
    if (name === 'k5_session_end_global') continue;
    assert.equal(capabilities[name].effect, "read", `Reviewer should only read, but ${name} has effect ${capabilities[name].effect}`);
  }

  // Lawyers and Admins have all capabilities
  assert.equal(lawyerCaps.length, 50);
  assert.equal(adminCaps.length, 50);
});

test("authorization: dynamic role check and membership revocation", () => {
  const { userAdmin, userReviewer, officeA } = seedFixture();

  const adminCtx: WorkspaceContext = { officeId: officeA, userId: userAdmin, role: "administrator" };
  const reviewerCtx: WorkspaceContext = { officeId: officeA, userId: userReviewer, role: "reviewer" };

  // Admin can do write operations
  assert.doesNotThrow(() => assertCapabilityAllowed(adminCtx, "k5_vault_create_case"));

  // Reviewer cannot do write operations
  assert.throws(
    () => assertCapabilityAllowed(reviewerCtx, "k5_vault_create_case"),
    (err: unknown) => err instanceof CapabilityError && err.code === "FORBIDDEN"
  );

  // Revoke user membership from office
  testDb.prepare("DELETE FROM office_member WHERE user_id=? AND office_id=?").run(userAdmin, officeA);

  assert.throws(
    () => assertCapabilityAllowed(adminCtx, "k5_vault_list_cases"),
    (err: unknown) => err instanceof CapabilityError && err.code === "FORBIDDEN"
  );
});

test("vault service: idempotent case creation, update and deletion with approval", () => {
  const { userLawyer, officeA } = seedFixture();
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer, role: "lawyer" };

  // 1. Create case
  const res1 = vaultService.createCase(context, { name: "Caso Silva vs. Souza" });
  assert.equal(res1.created, true);
  assert.equal(res1.case.name, "Caso Silva vs. Souza");

  // 2. Repeat creation -> Idempotent
  const res2 = vaultService.createCase(context, { name: "caso silva vs. souza" });
  assert.equal(res2.created, false);
  assert.equal(res2.case.id, res1.case.id);

  // 3. Update case
  const updated = vaultService.updateCase(context, { caseId: res1.case.id, name: "Caso Silva vs. Souza e Filhos" });
  assert.equal(updated.case.name, "Caso Silva vs. Souza e Filhos");

  // 4. Delete case without approval -> Fails with APPROVAL_REQUIRED and creates proposal
  assert.throws(
    () => vaultService.deleteCase(context, { caseId: res1.case.id }),
    (err: unknown) => err instanceof CapabilityError && err.code === "APPROVAL_REQUIRED"
  );

  // 5. Approve proposal and delete case
  const proposal = approvalsService.createApprovalProposal(context, "k5_vault_delete_case", { caseId: res1.case.id });
  approvalsService.approveProposal(context, proposal.id);

  const deleted = vaultService.deleteCase(context, { caseId: res1.case.id, approvalId: proposal.id });
  assert.equal(deleted.success, true);

  // Consumed approval cannot be re-used
  const anotherCase = vaultService.createCase(context, { name: "Outro Caso Para Excluir" });
  assert.throws(
    () => vaultService.deleteCase(context, { caseId: anotherCase.case.id, approvalId: proposal.id }),
    (err: unknown) => err instanceof CapabilityError && err.code === "CONFLICT"
  );
});

test("vault document service: versions, tombstone and office isolation", async () => {
  const { userLawyer, userOfficeB, officeA, officeB } = seedFixture();
  const contextA: WorkspaceContext = { officeId: officeA, userId: userLawyer, role: "lawyer" };
  const contextB: WorkspaceContext = { officeId: officeB, userId: userOfficeB, role: "lawyer" };

  // Ingest document for Office A through a real, server-issued upload reference
  const ingested = vaultService.ingestUpload(contextA, {
    uploadRef: (await seedUpload(contextA, "contrato.pdf")).id,
    scope: "library",
  });
  assert.ok(ingested.document.id);

  // Office B cannot access Office A document
  assert.throws(
    () => vaultService.getDocument(contextB, { documentId: ingested.document.id }),
    (err: unknown) => err instanceof CapabilityError && err.code === "NOT_FOUND"
  );

  // Add document version
  const v2 = vaultService.addDocumentVersion(contextA, {
    documentId: ingested.document.id,
    uploadRef: (await seedUpload(contextA, "contrato-v2.pdf")).id,
  });
  assert.equal(v2.version, 2, "version 2 follows the version 1 recorded at ingestion");

  // Delete document requires approval
  assert.throws(
    () => vaultService.deleteDocument(contextA, { documentId: ingested.document.id }),
    (err: unknown) => err instanceof CapabilityError && err.code === "APPROVAL_REQUIRED"
  );

  const proposal = approvalsService.createApprovalProposal(contextA, "k5_vault_delete_document", { documentId: ingested.document.id });
  approvalsService.approveProposal(contextA, proposal.id);

  const deleted = vaultService.deleteDocument(contextA, { documentId: ingested.document.id, approvalId: proposal.id });
  assert.equal(deleted.success, true);
});

test("knowledge engine: hybrid retrieval, source inspection and audit", async () => {
  const { userLawyer, officeA } = seedFixture();
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer, role: "lawyer" };

  // Create a ready document with chunks
  const docId = randomUUID();
  testDb.prepare(`
    INSERT INTO vault_document (id, office_id, scope, original_name, stored_name, mime_type, byte_size, sha256, status, created_by)
    VALUES (?, ?, 'library', 'contrato-locacao.pdf', ?, 'application/pdf', 1024, 'sha', 'ready', ?)
  `).run(docId, officeA, `stored-${docId}.pdf`, userLawyer);

  const chunk1Id = randomUUID();
  const chunk2Id = randomUUID();
  testDb.prepare(`
    INSERT INTO vault_document_chunk (id, document_id, office_id, ordinal, stable_reference, content)
    VALUES (?, ?, ?, 0, 'página:1', 'O locatário pagará o aluguel mensal de cinco mil reais.'),
           (?, ?, ?, 1, 'página:2', 'O foro competente para dirimir conflitos é a Comarca de São Paulo.')
  `).run(chunk1Id, docId, officeA, chunk2Id, docId, officeA);

  // 1. Search knowledge (returns lexical chunks marked degraded: true because no active vector generation)
  const searchResult = await knowledgeService.searchKnowledge(context, {
    query: "aluguel mensal",
    documentIds: [docId],
  });

  assert.equal(searchResult.sources.length, 1);
  assert.match(searchResult.sources[0].text, /cinco mil reais/);
  assert.equal(searchResult.degraded, true);

  // 2. Verify audit table
  const audit = testDb.prepare("SELECT * FROM knowledge_retrieval_audit WHERE office_id=? ORDER BY created_at DESC LIMIT 1").get(officeA) as {
    query: string;
    degraded: number;
    source_count: number;
  };
  assert.ok(audit);
  assert.notEqual(audit.query, "aluguel mensal", "the question itself is not retained");
  assert.match(audit.query, /^[0-9a-f]{32}$/, "a hash identifies repeats without storing the text");
  assert.equal(audit.degraded, 1);

  // 3. Inspect source with adjacent context
  const sourceResult = knowledgeService.getKnowledgeSource(context, {
    documentId: docId,
    stableReference: "página:1",
  });
  assert.equal(sourceResult.source.sourceId, chunk1Id);
  assert.match(sourceResult.source.adjacentContext ?? "", /São Paulo/);

  // 4. Index status
  const status = knowledgeService.getKnowledgeIndexStatus(context, { documentId: docId });
  assert.equal(status.status, "ready");
  assert.equal(status.vectorIndexed, false);

  // 5. Reindex without an embedding profile is refused instead of falsely reporting success
  assert.throws(
    () => knowledgeService.reindexKnowledge(context, { documentId: docId }),
    (err: unknown) => err instanceof CapabilityError && err.code === "NOT_READY",
    "no embedding profile means no queue, and saying so beats returning enqueued: true"
  );
});

test("idempotency: cached execution prevents duplicated writes", () => {
  const { userLawyer, officeA } = seedFixture();
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer, role: "lawyer" };

  let counter = 0;
  const executeOperation = () => {
    counter++;
    return { counter, value: "sucesso" };
  };

  const key = `test-idempotency-key-${randomUUID()}`;
  const r1 = withIdempotency(context, "custom_op", key, { a: 1 }, executeOperation);
  assert.equal(r1.counter, 1);

  // Second call with same key returns cached result without incrementing counter
  const r2 = withIdempotency(context, "custom_op", key, { a: 1 }, executeOperation);
  assert.equal(r2.counter, 1);
  assert.equal(counter, 1);
});

test("artifacts service: version history and rollback restoration", () => {
  const { userLawyer, officeA } = seedFixture();
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer, role: "lawyer" };

  // Create a run and artifact
  const runId = randomUUID();
  testDb.prepare(`
    INSERT INTO ai_run (id, office_id, user_id, kind, input, status)
    VALUES (?, ?, ?, 'draft', '{}', 'completed')
  `).run(runId, officeA, userLawyer);

  const artifactId = randomUUID();
  testDb.prepare(`
    INSERT INTO ai_artifact (id, office_id, user_id, run_id, title, content, version)
    VALUES (?, ?, ?, ?, 'Minuta Inicial', 'Conteúdo da versão 1', 1)
  `).run(artifactId, officeA, userLawyer, runId);

  testDb.prepare(`
    INSERT INTO ai_artifact_version (artifact_id, version, title, content, user_id)
    VALUES (?, 1, 'Minuta Inicial', 'Conteúdo da versão 1', ?)
  `).run(artifactId, userLawyer);

  // 1. Update artifact to version 2
  const updated = artifactsService.saveArtifact(context, {
    artifactId,
    title: "Minuta Atualizada",
    content: "Conteúdo da versão 2 com aditivos",
    version: 1,
  });
  assert.equal(updated.artifact.version, 2);

  // 2. List versions
  const versions = artifactsService.listArtifactVersions(context, { artifactId });
  assert.equal(versions.versions.length, 2);
  assert.equal(versions.versions[0].version, 2);
  assert.equal(versions.versions[1].version, 1);

  // 3. Restore version 1 (generates version 3 with version 1's content)
  const restored = artifactsService.restoreArtifactVersion(context, {
    artifactId,
    version: 1,
  });
  assert.equal(restored.artifact.version, 3);
  assert.equal(restored.artifact.content, "Conteúdo da versão 1");
});

test("conversations service: lifecycle and processing locking", () => {
  const { userLawyer, officeA } = seedFixture();
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer, role: "lawyer" };

  // Create conversation
  const created = conversationsService.createNewConversation(context, { title: "Dúvidas Tributárias" });
  assert.equal(created.conversation.title, "Dúvidas Tributárias");

  // Get conversation
  const got = conversationsService.getConversation(context, { conversationId: created.conversation.id });
  assert.equal(got.conversation.title, "Dúvidas Tributárias");

  // Mark conversation busy (processing)
  testDb.prepare("UPDATE ai_conversation SET busy_until=? WHERE id=?")
    .run(Date.now() + 60_000, created.conversation.id);

  // Deletion blocked while busy
  assert.throws(
    () => conversationsService.deleteConversation(context, { conversationId: created.conversation.id }),
    (err: unknown) => err instanceof CapabilityError && err.code === "CONFLICT"
  );

  // Free conversation and delete
  testDb.prepare("UPDATE ai_conversation SET busy_until=0 WHERE id=?").run(created.conversation.id);
  const deleted = conversationsService.deleteConversation(context, { conversationId: created.conversation.id });
  assert.equal(deleted.success, true);
});

test("agent tools: mastra tools creation and summary formatting", () => {
  const { userLawyer, officeA } = seedFixture();
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer, role: "lawyer" };

  const tools = agentTools(context);
  // The catalog is the published set for this role, not every capability the role may exercise:
  // global logout stays out of it even though a lawyer is allowed to log themselves out.
  assert.deepEqual(Object.keys(tools).sort(), publishedCapabilitiesForRole("lawyer", "agent").sort());
  assert.ok(!Object.keys(tools).includes("k5_session_end_global"));

  // Formatting summaries
  const s1 = toolSummary("k5_vault_list_cases", { cases: [{}, {}] }, false);
  assert.equal(s1, "Consultou os casos do Cofre: 2 caso(s)");

  const s2 = toolSummary("k5_vault_create_case", { case: { name: "Caso Alfa" } }, false);
  assert.equal(s2, "Criou um caso no Cofre: Caso Alfa");

  const s3 = toolSummary("k5_runs_cancel", null, true);
  assert.equal(s3, "Cancelou uma tarefa: não foi possível concluir");
});

test("webmcp: registration adapter handles mock browser modelContext", () => {
  const registered: Array<{ name: string; hints?: { untrustedContentHint?: boolean } }> = [];
  const mockContext = {
    registerTool: (def: { name: string; hints?: { untrustedContentHint?: boolean } }) => {
      registered.push(def);
      return { unregister: () => {} };
    },
  };

  (globalThis as unknown as { window: unknown; document: { modelContext: typeof mockContext } }).window = globalThis;
  (globalThis as unknown as { document: { modelContext: typeof mockContext } }).document = {
    modelContext: mockContext,
  };

  const cleanup = registerWebMCPCapabilities("reviewer");
  // A reviewer registers exactly the read capabilities published to the browser.
  assert.deepEqual(registered.map((definition) => definition.name).sort(), publishedCapabilitiesForRole("reviewer", "webmcp").sort());
  assert.ok(registered.some((definition) => definition.name === "k5_vault_list_cases"));
  assert.ok(!registered.some((definition) => definition.name === "k5_vault_create_case"));
  assert.equal(registered.find((definition) => definition.name === "k5_judicial_list_publications")?.hints?.untrustedContentHint, true);
  assert.equal(registered.find((definition) => definition.name === "k5_judicial_get_publication")?.hints?.untrustedContentHint, true);

  assert.doesNotThrow(() => cleanup());

  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { document?: unknown }).document;
});

test("capability routes: boolean query parameters accept only one exact true or false", () => {
  assert.equal(strictBooleanQueryParam(undefined, "activeOnly"), undefined);
  assert.equal(strictBooleanQueryParam("true", "activeOnly"), true);
  assert.equal(strictBooleanQueryParam("false", "activeOnly"), false);

  for (const value of ["TRUE", "1", "", ["true", "false"]]) {
    assert.throws(
      () => strictBooleanQueryParam(value, "activeOnly"),
      (error: unknown) => error instanceof CapabilityError && error.code === "INVALID",
    );
  }
});

test("approval security: rejects modified target resource or modified input arguments", () => {
  const { userLawyer, officeA } = seedFixture();
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer, role: "lawyer" };

  const c1 = vaultService.createCase(context, { name: "Caso Original" });
  const c2 = vaultService.createCase(context, { name: "Caso Invasor" });

  // Proposal created for c1
  const proposal = approvalsService.createApprovalProposal(context, "k5_vault_delete_case", { caseId: c1.case.id });
  approvalsService.approveProposal(context, proposal.id);

  // Attempting to consume proposal intended for c1 to delete c2 fails with FORBIDDEN
  assert.throws(
    () => vaultService.deleteCase(context, { caseId: c2.case.id, approvalId: proposal.id }),
    (err: unknown) => err instanceof CapabilityError && err.code === "FORBIDDEN"
  );

  // Proposal with targetCaseId
  const proposalWithTarget = approvalsService.createApprovalProposal(context, "k5_vault_delete_case", { caseId: c1.case.id, targetCaseId: c2.case.id });
  approvalsService.approveProposal(context, proposalWithTarget.id);

  // Attempting to consume with different targetCaseId fails with FORBIDDEN
  assert.throws(
    () => vaultService.deleteCase(context, { caseId: c1.case.id, targetCaseId: "different-target", approvalId: proposalWithTarget.id }),
    (err: unknown) => err instanceof CapabilityError && err.code === "FORBIDDEN"
  );
});

test("knowledge engine: vectors fuse with lexical hits and tombstones stay out", async () => {
  const { userLawyer, officeA } = seedFixture();
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer, role: "lawyer" };

  const docId = randomUUID();
  const chunkId1 = randomUUID();
  const chunkId2 = randomUUID();
  const genId = randomUUID();

  testDb.prepare(`
    INSERT INTO vault_document (id, office_id, scope, original_name, stored_name, mime_type, byte_size, sha256, status, created_by)
    VALUES (?, ?, 'library', 'contrato-vetor.pdf', 'contrato-vetor.pdf', 'application/pdf', 2048, 'hash-v', 'ready', ?)
  `).run(docId, officeA, userLawyer);

  testDb.prepare(`
    INSERT INTO vault_document_chunk (id, document_id, office_id, ordinal, stable_reference, content)
    VALUES (?, ?, ?, 0, 'página:1', 'Cláusula de rescisão antecipada com multa contratual.'),
           (?, ?, ?, 1, 'página:2', 'Foro de eleição na comarca de Curitiba Paraná.')
  `).run(chunkId1, docId, officeA, chunkId2, docId, officeA);

  testDb.prepare(`
    INSERT INTO knowledge_index_generation (id, office_id, profile_name, model_id, dimension, chunker, status)
    VALUES (?, ?, 'embedding', 'test-embed', 3, 'structural', 'active')
  `).run(genId, officeA);

  // The index adapter stores float32 blobs; the query vector is produced by the server, never
  // by the caller, so the test drives the adapter the same way the worker does.
  await vectorIndex().upsert(officeA, genId, [
    { chunkId: chunkId1, documentId: docId, embedding: Float32Array.from([1, 0, 0]) },
    { chunkId: chunkId2, documentId: docId, embedding: Float32Array.from([0, 1, 0]) },
  ]);

  const hits = await vectorIndex().query(officeA, genId, Float32Array.from([0, 1, 0]), { documentIds: [docId], topK: 5 });
  assert.equal(hits[0]?.chunkId, chunkId2, "cosine similarity ranks the semantically closest chunk first");

  // Without an embedding profile the search degrades to lexical, and says so.
  const lexical = await knowledgeService.searchKnowledge(context, { query: "rescisão", documentIds: [docId] });
  assert.equal(lexical.degraded, true);
  assert.ok(lexical.degradedReason, "a degraded search explains why it is degraded");
  assert.equal(lexical.sources[0].sourceId, chunkId1);

  // A tombstoned document is refused even though its vectors are still in the index.
  testDb.prepare("UPDATE vault_document SET deleted_at=CURRENT_TIMESTAMP WHERE id=?").run(docId);
  await assert.rejects(
    () => knowledgeService.searchKnowledge(context, { query: "rescisão", documentIds: [docId] }),
    (err: unknown) => err instanceof CapabilityError && err.code === "NOT_FOUND"
  );
});

test("knowledge scope: updating sources for a conversation does not duplicate rows", () => {
  const { userLawyer, officeA } = seedFixture();
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer, role: "lawyer" };

  const conv = conversationsService.createNewConversation(context, { title: "Escopo Conversa" });
  const docId = randomUUID();
  testDb.prepare(`
    INSERT INTO vault_document (id, office_id, scope, original_name, stored_name, mime_type, byte_size, sha256, status, created_by)
    VALUES (?, ?, 'library', 'doc-escopo.pdf', 'doc-escopo.pdf', 'application/pdf', 1000, 'hash', 'ready', ?)
  `).run(docId, officeA, userLawyer);

  // Set scope once
  knowledgeService.setScopeSources(context, { conversationId: conv.conversation.id, documentIds: [docId] });

  // Set scope second time with same conversation
  knowledgeService.setScopeSources(context, { conversationId: conv.conversation.id, documentIds: [docId] });

  const rows = testDb.prepare("SELECT count(*) AS n FROM knowledge_scope WHERE office_id=? AND conversation_id=?").get(officeA, conv.conversation.id) as { n: number };
  assert.equal(rows.n, 1, "There must only be 1 scope record per conversation");
});

test("ui service: openResource validates resource access and throws NOT_FOUND on cross-office or invalid IDs", () => {
  const { userLawyer, officeA, officeB } = seedFixture();
  const contextA: WorkspaceContext = { officeId: officeA, userId: userLawyer, role: "lawyer" };

  const foreignCaseId = randomUUID();
  testDb.prepare("INSERT INTO vault_case (id, office_id, name, created_by) VALUES (?, ?, 'Caso Alheio', ?)")
    .run(foreignCaseId, officeB, userLawyer);

  // Office A attempting to open Office B's case is refused
  assert.throws(
    () => uiService.openResource(contextA, { resourceType: "case", resourceId: foreignCaseId }),
    (err: unknown) => err instanceof CapabilityError && err.code === "NOT_FOUND"
  );

  // Valid internal case resolves path
  const localCase = vaultService.createCase(contextA, { name: "Caso Alfa Local" });
  const res = uiService.openResource(contextA, { resourceType: "case", resourceId: localCase.case.id });
  assert.equal(res.path, `/app/vault/cases/${encodeURIComponent(localCase.case.id)}`);
});

test("webmcp: every published capability has a route, a schema and typed failures", async () => {
  const originalFetch = globalThis.fetch;
  let lastUrl = "";
  (globalThis as unknown as { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL) => {
    lastUrl = String(input);
    return { ok: true, status: 200, json: async () => ({ success: true }) } as unknown as Response;
  };

  try {
    const published = publishedCapabilitiesForRole("administrator", "webmcp");
    assert.ok(!published.includes("k5_session_end_global"), "global logout is never a browser tool");

    for (const name of published) {
      const result = await executeViaHttp(name, {
        caseId: randomUUID(), documentId: randomUUID(), artifactId: randomUUID(),
        runId: randomUUID(), conversationId: randomUUID(), uploadRef: randomUUID(), folderId: randomUUID(),
        documentIds: [randomUUID()], query: "teste", name: "nome do caso", title: "titulo",
        content: "conteudo", version: 1, instructions: "instrucoes", resourceType: "vault",
        stableReference: "página:1", scope: "library",
        installationId: randomUUID(), linkId: randomUUID(), publicationId: randomUUID(),
        jobId: randomUUID(), alertId: randomUUID(), number: "0000001-05.2025.8.26.0100",
      });
      assert.equal(result.ok, true, `${name} should reach a route: ${JSON.stringify(result)}`);
    }
    assert.ok(lastUrl.startsWith("/api/"), "routes stay same-origin");

    // A refusal from the server is a typed failure, not a result the agent reads as success.
    (globalThis as unknown as { fetch: typeof fetch }).fetch = async () => ({
      ok: false, status: 403, json: async () => ({ error: "Origem não autorizada.", code: "FORBIDDEN" }),
    } as unknown as Response);
    const denied = await executeViaHttp("k5_vault_list_cases", {});
    assert.equal(denied.ok, false);
    assert.equal(denied.ok === false && denied.code, "FORBIDDEN");

    // Bad arguments fail against the same contract the server enforces.
    const invalid = await executeViaHttp("k5_knowledge_search", { query: "x", documentIds: [] });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.ok === false && invalid.code, "INVALID");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("platform service: create, list, and delete AI connection operations", () => {
  process.env.K5_CREDENTIALS_KEY = randomBytes(32).toString("base64");
  const { userAdmin, officeA } = seedFixture();
  const context: WorkspaceContext = { officeId: officeA, userId: userAdmin, role: "administrator" };

  // Make user a platform admin
  grantPlatformAdmin(testDb, userAdmin);

  // 1. Create connection
  const created = platformService.platformCreateConnection(context, {
    officeId: officeA,
    name: "Conexão Teste OpenAI",
    provider: "openai",
    // The key reached the server through a human form; the tool only carries the reference.
    secretRef: createSecretRef(userAdmin, "sk-test-fake-key-12345").id,
    enabled: true,
    models: { chat: "gpt-4o", extraction: null, drafting: null, embedding: null },
  });
  assert.equal(created.connection.name, "Conexão Teste OpenAI");
  assert.equal(created.connection.provider, "openai");

  // 2. List connections
  const list = platformService.platformListConnections(context, { officeId: officeA });
  const found = list.connections.find(c => c.id === created.connection.id);
  assert.ok(found);

  // 3. Update connection
  const updated = platformService.platformUpdateConnection(context, {
    officeId: officeA,
    connectionId: created.connection.id,
    name: "Conexão Teste OpenAI v2",
    models: { chat: null, extraction: null, drafting: null, embedding: null },
  });
  assert.equal(updated.connection.name, "Conexão Teste OpenAI v2");

  // 4. Delete connection
  const deleted = platformService.platformDeleteConnection(context, {
    officeId: officeA,
    connectionId: created.connection.id,
  });
  assert.equal(deleted.success, true);
});


test("vault drive: a case carries its client data and folders stay inside their own case", () => {
  const { userLawyer, officeA, officeB, userOfficeB } = seedFixture();
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer, role: "lawyer" };
  const other: WorkspaceContext = { officeId: officeB, userId: userOfficeB, role: "lawyer" };

  const created = vaultService.createCase(context, {
    name: `Drive ${randomUUID()}`,
    description: "Ação de rescisão contratual.",
    client: { name: "Maria Silva", document: "123.456.789-00", email: "maria@example.test" },
  });
  assert.equal(created.created, true);
  assert.equal(created.case.description, "Ação de rescisão contratual.");
  assert.equal(created.case.client.name, "Maria Silva");
  assert.equal(created.case.documentCount, 0);

  // A partial update keeps what it does not mention.
  const renamed = vaultService.updateCase(context, { caseId: created.case.id, name: "Caso renomeado" });
  assert.equal(renamed.case.name, "Caso renomeado");
  assert.equal(renamed.case.client.name, "Maria Silva");
  assert.equal(renamed.case.description, "Ação de rescisão contratual.");

  const root = vaultService.createFolder(context, { caseId: created.case.id, name: "Petições" });
  const child = vaultService.createFolder(context, { caseId: created.case.id, name: "2026", parentId: root.folder.id });
  assert.equal(child.folder.parentId, root.folder.id);
  assert.deepEqual(vaultService.listFolders(context, { caseId: created.case.id }).folders.map((f) => f.name), ["Petições"]);
  assert.deepEqual(vaultService.listFolders(context, { caseId: created.case.id, parentId: root.folder.id }).path.map((f) => f.name), ["Petições"]);

  // Siblings cannot share a name, and a folder of another office is not addressable from here.
  assert.throws(() => vaultService.createFolder(context, { caseId: created.case.id, name: "Petições" }), (error) => error instanceof CapabilityError && error.code === "NOT_READY");
  const foreign = vaultService.createCase(other, { name: `Beta ${randomUUID()}` });
  assert.throws(
    () => vaultService.createFolder(context, { caseId: foreign.case.id, name: "Qualquer" }),
    (error) => error instanceof CapabilityError && error.code === "NOT_FOUND",
  );

  // Removing a folder moves its contents up instead of deleting them.
  vaultService.deleteFolder(context, { folderId: root.folder.id });
  assert.deepEqual(vaultService.listFolders(context, { caseId: created.case.id }).folders.map((f) => f.name), ["2026"]);
});

test("knowledge engine: an empty scope searches this office's Cofre and never another's", async () => {
  const { userLawyer, officeA, officeB, userOfficeB } = seedFixture();
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer, role: "lawyer" };

  const seedDocument = (officeId: string, userId: string, name: string, text: string) => {
    const documentId = randomUUID();
    testDb.prepare(`
      INSERT INTO vault_document (id, office_id, scope, original_name, stored_name, mime_type, byte_size, sha256, status, created_by)
      VALUES (?, ?, 'library', ?, ?, 'application/pdf', 1024, 'sha', 'ready', ?)
    `).run(documentId, officeId, name, `stored-${documentId}.pdf`, userId);
    testDb.prepare(`
      INSERT INTO vault_document_chunk (id, document_id, office_id, ordinal, stable_reference, content)
      VALUES (?, ?, ?, 0, 'página:1', ?)
    `).run(randomUUID(), documentId, officeId, text);
    return documentId;
  };

  const mine = seedDocument(officeA, userLawyer, "laudo-pericial.pdf", "O laudo pericial apontou infiltração na laje.");
  seedDocument(officeB, userOfficeB, "laudo-alheio.pdf", "O laudo pericial do escritório vizinho.");

  const result = await knowledgeService.searchKnowledge(context, { query: "laudo pericial" });
  assert.ok(result.sources.length > 0, "the whole Cofre is in scope when no document is named");
  assert.ok(result.sources.every((source) => source.documentId === mine), "another office's documents never enter the scope");
});
