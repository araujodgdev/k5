import { testDb } from "./test-setup";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";

import {
  capabilities,
  capabilitiesForRole,
  capabilityNames,
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
import * as uiService from "../src/lib/application/ui-service";
import * as platformService from "../src/lib/application/platform-service";
import { grantPlatformAdmin } from "../src/lib/platform-core";

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

test("capabilities contract: complete catalog and role permissions", () => {
  assert.equal(capabilityNames.length, 35, "All 35 capabilities declared");

  const reviewerCaps = capabilitiesForRole("reviewer");
  const lawyerCaps = capabilitiesForRole("lawyer");
  const adminCaps = capabilitiesForRole("administrator");

  // Reviewer only has read capabilities on office data (plus self session termination)
  for (const name of reviewerCaps) {
    if (name === 'k5_session_end_global') continue;
    assert.equal(capabilities[name].effect, "read", `Reviewer should only read, but ${name} has effect ${capabilities[name].effect}`);
  }

  // Lawyers and Admins have all capabilities
  assert.equal(lawyerCaps.length, 35);
  assert.equal(adminCaps.length, 35);
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

test("vault document service: versions, tombstone and office isolation", () => {
  const { userLawyer, userOfficeB, officeA, officeB } = seedFixture();
  const contextA: WorkspaceContext = { officeId: officeA, userId: userLawyer, role: "lawyer" };
  const contextB: WorkspaceContext = { officeId: officeB, userId: userOfficeB, role: "lawyer" };

  // Ingest document for Office A
  const ingested = vaultService.ingestUpload(contextA, {
    uploadRef: `upload-doc-${randomUUID()}`,
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
    uploadRef: "upload-doc-v2",
  });
  assert.equal(v2.version, 2);

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

test("knowledge engine: hybrid retrieval, source inspection and audit", () => {
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
  const searchResult = knowledgeService.searchKnowledge(context, {
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
  assert.equal(audit.query, "aluguel mensal");
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

  // 5. Reindex
  const reindexRes = knowledgeService.reindexKnowledge(context, { documentId: docId });
  assert.equal(reindexRes.enqueued, true);
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
  assert.equal(Object.keys(tools).length, 35);

  // Formatting summaries
  const s1 = toolSummary("k5_vault_list_cases", { cases: [{}, {}] }, false);
  assert.equal(s1, "Consultou os casos do Cofre: 2 caso(s)");

  const s2 = toolSummary("k5_vault_create_case", { case: { name: "Caso Alfa" } }, false);
  assert.equal(s2, "Criou um caso no Cofre: Caso Alfa");

  const s3 = toolSummary("k5_runs_cancel", null, true);
  assert.equal(s3, "Cancelou uma tarefa: não foi possível concluir");
});

test("webmcp: registration adapter handles mock browser modelContext", () => {
  const registered: string[] = [];
  const mockContext = {
    registerTool: (def: { name: string }) => {
      registered.push(def.name);
      return { unregister: () => {} };
    },
  };

  (globalThis as unknown as { window: unknown; document: { modelContext: typeof mockContext } }).window = globalThis;
  (globalThis as unknown as { document: { modelContext: typeof mockContext } }).document = {
    modelContext: mockContext,
  };

  const cleanup = registerWebMCPCapabilities("reviewer");
  // Reviewer should only register read capabilities
  const reviewerCount = capabilitiesForRole("reviewer").length;
  assert.equal(registered.length, reviewerCount);
  assert.ok(registered.includes("k5_vault_list_cases"));
  assert.ok(!registered.includes("k5_vault_create_case"));

  assert.doesNotThrow(() => cleanup());

  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { document?: unknown }).document;
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

test("knowledge engine: vector cosine similarity and RRF fusion in hybrid retrieval", () => {
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

  // Create active generation with dimension 3
  testDb.prepare(`
    INSERT INTO knowledge_index_generation (id, office_id, profile_name, model_id, dimension, chunker, status)
    VALUES (?, ?, 'default', 'test-embed', 3, 'structural', 'active')
  `).run(genId, officeA);

  // Chunk 1 has embedding [1, 0, 0], Chunk 2 has embedding [0, 1, 0]
  testDb.prepare(`
    INSERT INTO vault_document_chunk_vector (id, office_id, document_id, chunk_id, generation_id, embedding)
    VALUES (?, ?, ?, ?, ?, '[1, 0, 0]'),
           (?, ?, ?, ?, ?, '[0, 1, 0]')
  `).run(randomUUID(), officeA, docId, chunkId1, genId, randomUUID(), officeA, docId, chunkId2, genId);

  // 1. Without queryVector -> falls back to degraded lexical
  const lexicalOnly = knowledgeService.searchKnowledge(context, {
    query: "rescisão",
    documentIds: [docId],
  });
  assert.equal(lexicalOnly.degraded, true);
  assert.equal(lexicalOnly.sources.length, 1);
  assert.equal(lexicalOnly.sources[0].sourceId, chunkId1);

  // 2. With queryVector matching chunk 2 ([0, 1, 0]) while lexical query matches chunk 1 ("rescisão")
  // Both chunks should appear in hybrid fusion, with chunk 2 included due to semantic vector similarity!
  const hybrid = knowledgeService.searchKnowledge(context, {
    query: "rescisão",
    documentIds: [docId],
    queryVector: [0, 1, 0],
  });
  assert.equal(hybrid.degraded, false);
  assert.ok(hybrid.sources.length >= 2);
  const foundChunk2 = hybrid.sources.find(s => s.sourceId === chunkId2);
  assert.ok(foundChunk2, "Chunk 2 must be retrieved via vector cosine similarity");

  // 3. Soft-deleted document is rejected
  testDb.prepare("UPDATE vault_document SET deleted_at=CURRENT_TIMESTAMP WHERE id=?").run(docId);
  assert.throws(
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
  assert.equal(res.path, `/app/vault?caseId=${encodeURIComponent(localCase.case.id)}`);
});

test("webmcp: executeViaHttp handles all 35 capabilities without throwing unsupported operation", async () => {
  // Mock global fetch to return dummy JSON
  const originalFetch = globalThis.fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = async () => ({
    ok: true,
    json: async () => ({ success: true, dummy: true }),
  } as unknown as Response);

  try {
    for (const name of capabilityNames) {
      // Execute via HTTP adapter: no capability must throw "não suportada"
      const result = await executeViaHttp(name, {
        caseId: "c1",
        documentId: "d1",
        artifactId: "a1",
        runId: "r1",
        conversationId: "conv1",
        uploadRef: "u1",
        documentIds: ["d1"],
        query: "teste",
        name: "nome",
        title: "titulo",
        content: "conteudo",
        version: 1,
        instructions: "instrucoes",
        resourceType: "vault",
      });
      assert.ok(result !== undefined, `Capability ${name} returned undefined`);
    }
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
    apiKey: "sk-test-fake-key-12345",
    enabled: true,
    models: { chat: "gpt-4o", extraction: null, drafting: null },
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
    models: { chat: null, extraction: null, drafting: null },
  });
  assert.equal(updated.connection.name, "Conexão Teste OpenAI v2");

  // 4. Delete connection
  const deleted = platformService.platformDeleteConnection(context, {
    officeId: officeA,
    connectionId: created.connection.id,
  });
  assert.equal(deleted.success, true);
});

