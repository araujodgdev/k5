import { testDb, testDatabase } from "./test-setup";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { workspaceCapabilityInputs } from './workspace-capability-inputs';

import {
  capabilities,
  capabilityNames,
  publishedCapabilities,
} from "../src/lib/capabilities/contracts";
import { CapabilityError } from "../src/lib/capabilities/errors";
import { assertCapabilityAllowed, type WorkspaceContext } from "../src/lib/application/context";
import * as vaultService from "../src/lib/application/vault-service";
import * as artifactsService from "../src/lib/application/artifacts-service";
import * as conversationsService from "../src/lib/application/conversations-service";
import * as knowledgeService from "../src/lib/application/knowledge-service";
import * as approvalsService from "../src/lib/application/approvals-service";
import { agentTools, toolSummary } from "../src/lib/agent-tools";
import { registerWebMCPCapabilities, executeViaHttp } from "../src/lib/webmcp/adapter";
import { strictBooleanQueryParam } from "../src/lib/query-params";
import * as uploadsService from "../src/lib/application/uploads-service";
import { vectorIndex } from "../src/lib/knowledge/vector-index";
import * as uiService from "../src/lib/application/ui-service";
import * as platformService from "../src/lib/application/platform-service";
import { grantPlatformAdmin } from "../src/lib/platform-core";
import { createSecretRef } from "../src/lib/application/secrets-service";

async function seedFixture() {
  const userLawyer = randomUUID();
  const userOfficeB = randomUUID();

  const userAdmin = userLawyer;

  const officeA = randomUUID();
  const officeB = randomUUID();

  (await testDb.prepare("INSERT INTO user (id, email, name) VALUES (?, ?, ?), (?, ?, ?)")
    .run(
      userLawyer, `lawyer-${randomUUID()}@alfa.test`, "Lawyer Alfa",
      userOfficeB, `user-${randomUUID()}@beta.test`, "User Beta"
    ));

  (await testDb.prepare("INSERT INTO office (id, name) VALUES (?, ?), (?, ?)")
    .run(officeA, "Alfa Advocacia", officeB, "Beta Advocacia"));

  (await testDb.prepare("INSERT INTO office_member (id, office_id, user_id) VALUES (?, ?, ?), (?, ?, ?)")
    .run(
      randomUUID(), officeA, userLawyer,
      randomUUID(), officeB, userOfficeB
    ));

  return { userAdmin, userLawyer, userOfficeB, officeA, officeB };
}

async function pinTestDocument(id:string) {
  await testDb.prepare('INSERT INTO vault_document_version(id,office_id,document_id,version,original_name,stored_name,mime_type,byte_size,sha256,created_by,is_active) SELECT ?,office_id,id,1,original_name,stored_name,mime_type,byte_size,sha256,created_by,1 FROM vault_document WHERE id=?').run(randomUUID(),id);
  await testDb.prepare('UPDATE vault_document SET extracted_version=1,extracted_sha256=sha256 WHERE id=?').run(id);
}

function seedUpload(context: WorkspaceContext, name = "documento.pdf") {
  const file = new File([Buffer.from(`conteudo-${randomUUID()}`)], name, { type: "application/pdf" });
  return uploadsService.createUploadRef(context, file);
}

test("capabilities contract: complete catalog without office roles", () => {
  assert.equal(new Set(capabilityNames).size, capabilityNames.length, "Capability names are unique");
  for (const name of capabilityNames) assert.ok(!('roles' in capabilities[name]), `${name} declares no office role`);
});

test("authorization: membership is re-read and its removal takes effect", async () => {
  const { userAdmin, userOfficeB, officeA } = (await seedFixture());

  const adminCtx: WorkspaceContext = { officeId: officeA, userId: userAdmin };
  const outsiderCtx: WorkspaceContext = { officeId: officeA, userId: userOfficeB };

  await assert.doesNotReject(() => assertCapabilityAllowed(adminCtx, "k5_vault_create_case"));

  await assert.rejects(
    () => assertCapabilityAllowed(outsiderCtx, "k5_vault_list_cases"),
    (err: unknown) => err instanceof CapabilityError && err.code === "FORBIDDEN"
  );

  (await testDb.prepare("DELETE FROM office_member WHERE user_id=? AND office_id=?").run(userAdmin, officeA));

  await assert.rejects(
    () => assertCapabilityAllowed(adminCtx, "k5_vault_list_cases"),
    (err: unknown) => err instanceof CapabilityError && err.code === "FORBIDDEN"
  );
});

test("authorization: a live session is checked by its resolved column", async () => {
  const { userAdmin, officeA } = (await seedFixture());
  const sessionId = randomUUID();
  (await testDb.prepare("INSERT INTO session (id,userId,token,expiresAt,createdAt,updatedAt) VALUES (?,?,gen_random_uuid()::text,CURRENT_TIMESTAMP+INTERVAL '1 day',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run(sessionId, userAdmin));
  const context: WorkspaceContext = { officeId: officeA, userId: userAdmin, sessionId };

  await assert.doesNotReject(() => assertCapabilityAllowed(context, "k5_vault_list_cases"));
  (await testDb.prepare("DELETE FROM session WHERE id = ?").run(sessionId));
  await assert.rejects(
    () => assertCapabilityAllowed(context, "k5_vault_list_cases"),
    (error: unknown) => error instanceof CapabilityError && error.code === "UNAUTHENTICATED",
  );
});

test("vault service: idempotent case creation, update and deletion with approval", async () => {
  const { userLawyer, officeA } = (await seedFixture());
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer };

  const res1 = await vaultService.createCase(context, { name: "Caso Silva vs. Souza" });
  assert.equal(res1.created, true);
  assert.equal(res1.case.name, "Caso Silva vs. Souza");

  const res2 = await vaultService.createCase(context, { name: "caso silva vs. souza" });
  assert.equal(res2.created, false);
  assert.equal(res2.case.id, res1.case.id);

  const updated = await vaultService.updateCase(context, { caseId: res1.case.id, name: "Caso Silva vs. Souza e Filhos" });
  assert.equal(updated.case.name, "Caso Silva vs. Souza e Filhos");

  await assert.rejects(
    () => vaultService.deleteCase(context, { caseId: res1.case.id }),
    (err: unknown) => err instanceof CapabilityError && err.code === "APPROVAL_REQUIRED"
  );

  const proposal = await approvalsService.createApprovalProposal(context, "k5_vault_delete_case", { caseId: res1.case.id });
  await approvalsService.approveProposal(context, proposal.id);

  const deleted = await vaultService.deleteCase(context, { caseId: res1.case.id, approvalId: proposal.id });
  assert.equal(deleted.success, true);

  const anotherCase = await vaultService.createCase(context, { name: "Outro Caso Para Excluir" });
  await assert.rejects(
    () => vaultService.deleteCase(context, { caseId: anotherCase.case.id, approvalId: proposal.id }),
    (err: unknown) => err instanceof CapabilityError && err.code === "CONFLICT"
  );
});

test("vault deletion clears stale folders when documents move to another case", async () => {
  const { userLawyer, officeA } = (await seedFixture());
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer };
  const source = await vaultService.createCase(context, { name: `Origem ${randomUUID()}` });
  const target = await vaultService.createCase(context, { name: `Destino ${randomUUID()}` });
  const folder = await vaultService.createFolder(context, { caseId: source.case.id, name: "Pasta antiga" });
  const documentId = randomUUID();
  (await testDb.prepare(`
    INSERT INTO vault_document
      (id, office_id, case_id, folder_id, scope, original_name, stored_name, mime_type, byte_size, sha256, status, created_by)
    VALUES (?, ?, ?, ?, 'case', 'prova.pdf', ?, 'application/pdf', 10, 'sha', 'ready', ?)
  `).run(documentId, officeA, source.case.id, folder.folder.id, `stored-${documentId}.pdf`, userLawyer));

  const proposal = await approvalsService.createApprovalProposal(context, "k5_vault_delete_case", {
    caseId: source.case.id,
    targetCaseId: target.case.id,
  });
  await approvalsService.approveProposal(context, proposal.id);
  await vaultService.deleteCase(context, { caseId: source.case.id, targetCaseId: target.case.id, approvalId: proposal.id });

  const moved = (await testDb.prepare("SELECT case_id AS caseId, folder_id AS folderId FROM vault_document WHERE id=?").get(documentId)) as { caseId: string; folderId: string | null };
  assert.equal(moved.caseId, target.case.id);
  assert.equal(moved.folderId, null);
});

test("vault deletion can resume after approval consumption", async () => {
  const { userLawyer, officeA } = (await seedFixture());
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer };
  const source = await vaultService.createCase(context, { name: `Retomavel ${randomUUID()}` });
  const proposal = await approvalsService.createApprovalProposal(context, "k5_vault_delete_case", { caseId: source.case.id });
  await approvalsService.approveProposal(context, proposal.id);

  await testDb.exec(`CREATE FUNCTION capability_delete_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected transaction failure'; END $$ LANGUAGE plpgsql;
    CREATE TRIGGER capability_delete_fail BEFORE UPDATE OF deleted_at ON vault_case FOR EACH ROW EXECUTE FUNCTION capability_delete_fail();`);
  try {
    await assert.rejects(
      () => vaultService.deleteCase(context, { caseId: source.case.id, approvalId: proposal.id }),
      /injected transaction failure/,
    );
  } finally {
    await testDb.exec('DROP TRIGGER capability_delete_fail ON vault_case; DROP FUNCTION capability_delete_fail()');
  }

  assert.equal((await approvalsService.getApprovalProposal(context, proposal.id)).status, "consumed");
  assert.ok((await testDb.prepare("SELECT id FROM vault_case WHERE id=? AND deleted_at IS NULL").get(source.case.id)));

  const retried = await vaultService.deleteCase(context, { caseId: source.case.id, approvalId: proposal.id });
  assert.equal(retried.success, true);
  assert.equal((await testDb.prepare("SELECT id FROM vault_case WHERE id=? AND deleted_at IS NULL").get(source.case.id)), undefined);
});

test("vault document service: versions, tombstone and office isolation", async () => {
  const { userLawyer, userOfficeB, officeA, officeB } = (await seedFixture());
  const contextA: WorkspaceContext = { officeId: officeA, userId: userLawyer };
  const contextB: WorkspaceContext = { officeId: officeB, userId: userOfficeB };

  const ingested = await vaultService.ingestUpload(contextA, {
    uploadRef: (await seedUpload(contextA, "contrato.pdf")).id,
    scope: "library",
  });
  assert.ok(ingested.document.id);

  await assert.rejects(
    () => vaultService.getDocument(contextB, { documentId: ingested.document.id }),
    (err: unknown) => err instanceof CapabilityError && err.code === "NOT_FOUND"
  );

  const v2 = await vaultService.addDocumentVersion(contextA, {
    documentId: ingested.document.id,
    uploadRef: (await seedUpload(contextA, "contrato-v2.pdf")).id,
  });
  assert.equal(v2.version, 2, "version 2 follows the version 1 recorded at ingestion");

  await assert.rejects(
    () => vaultService.deleteDocument(contextA, { documentId: ingested.document.id }),
    (err: unknown) => err instanceof CapabilityError && err.code === "APPROVAL_REQUIRED"
  );

  const proposal = await approvalsService.createApprovalProposal(contextA, "k5_vault_delete_document", { documentId: ingested.document.id });
  await approvalsService.approveProposal(contextA, proposal.id);

  const deleted = await vaultService.deleteDocument(contextA, { documentId: ingested.document.id, approvalId: proposal.id });
  assert.equal(deleted.success, true);
});

test("knowledge engine: hybrid retrieval, source inspection and audit", async () => {
  const { userLawyer, officeA } = (await seedFixture());
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer };

  const docId = randomUUID();
  (await testDb.prepare(`
    INSERT INTO vault_document (id, office_id, scope, original_name, stored_name, mime_type, byte_size, sha256, status, created_by)
    VALUES (?, ?, 'library', 'contrato-locacao.pdf', ?, 'application/pdf', 1024, 'sha', 'ready', ?)
  `).run(docId, officeA, `stored-${docId}.pdf`, userLawyer));

  await pinTestDocument(docId);
  const chunk1Id = randomUUID();
  const chunk2Id = randomUUID();
  (await testDb.prepare(`
    INSERT INTO vault_document_chunk (id, document_id, office_id, ordinal, stable_reference, content)
    VALUES (?, ?, ?, 0, 'página:1', 'O locatário pagará o aluguel mensal de cinco mil reais.'),
           (?, ?, ?, 1, 'página:2', 'O foro competente para dirimir conflitos é a Comarca de São Paulo.')
  `).run(chunk1Id, docId, officeA, chunk2Id, docId, officeA));

  const searchResult = await knowledgeService.searchKnowledge(context, {
    query: "aluguel mensal",
    documentIds: [docId],
  });

  assert.equal(searchResult.sources.length, 1);
  assert.match(searchResult.sources[0].text, /cinco mil reais/);
  assert.equal(searchResult.degraded, true);

  const audit = (await testDb.prepare("SELECT * FROM knowledge_retrieval_audit WHERE office_id=? ORDER BY created_at DESC LIMIT 1").get(officeA)) as {
    query: string;
    degraded: number;
    source_count: number;
  };
  assert.ok(audit);
  assert.notEqual(audit.query, "aluguel mensal", "the question itself is not retained");
  assert.match(audit.query, /^[0-9a-f]{32}$/, "a hash identifies repeats without storing the text");
  assert.equal(audit.degraded, 1);

  const sourceResult = await knowledgeService.getKnowledgeSource(context, {
    documentId: docId,
    stableReference: "página:1",
  });
  assert.equal(sourceResult.source.sourceId, chunk1Id);
  assert.match(sourceResult.source.adjacentContext ?? "", /São Paulo/);

  const status = await knowledgeService.getKnowledgeIndexStatus(context, { documentId: docId });
  assert.equal(status.status, "ready");
  assert.equal(status.vectorIndexed, false);

  await assert.rejects(
    () => knowledgeService.reindexKnowledge(context, { documentId: docId }),
    (err: unknown) => err instanceof CapabilityError && err.code === "NOT_READY",
    "no embedding profile means no queue, and saying so beats returning enqueued: true"
  );
});

test("knowledge search covers ready documents while another selected one is still processing", async () => {
  const { userLawyer, officeA } = (await seedFixture());
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer };
  const ready = randomUUID();
  const processing = randomUUID();
  await testDb.prepare(`
    INSERT INTO vault_document (id, office_id, scope, original_name, stored_name, mime_type, byte_size, sha256, status, created_by)
    VALUES (?, ?, 'library', 'peticao.pdf', ?, 'application/pdf', 1024, 'sha', 'ready', ?),
           (?, ?, 'library', 'laudo-escaneado.pdf', ?, 'application/pdf', 1024, 'sha', 'processing', ?)
  `).run(ready, officeA, `stored-${ready}.pdf`, userLawyer, processing, officeA, `stored-${processing}.pdf`, userLawyer);
  await testDb.prepare(`INSERT INTO vault_document_chunk (id, document_id, office_id, ordinal, stable_reference, content)
    VALUES (?, ?, ?, 0, 'página:1', 'Requer o restabelecimento do benefício assistencial.')`).run(randomUUID(), ready, officeA);

  await pinTestDocument(ready); await pinTestDocument(processing);
  const result = await knowledgeService.searchKnowledge(context, { query: "benefício assistencial", documentIds: [ready, processing] });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].documentId, ready);

  await assert.rejects(
    () => knowledgeService.searchKnowledge(context, { query: "laudo", documentIds: [processing] }),
    (err: unknown) => err instanceof CapabilityError && err.code === "NOT_READY",
    "with nothing processed yet, the search says so instead of returning an empty answer",
  );
});

test("artifacts service: version history and rollback restoration", async () => {
  const { userLawyer, officeA } = (await seedFixture());
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer };

  const runId = randomUUID();
  (await testDb.prepare(`
    INSERT INTO ai_run (id, office_id, user_id, kind, input, status)
    VALUES (?, ?, ?, 'draft', '{}', 'completed')
  `).run(runId, officeA, userLawyer));

  const artifactId = randomUUID();
  (await testDb.prepare(`
    INSERT INTO ai_artifact (id, office_id, user_id, run_id, title, content, version)
    VALUES (?, ?, ?, ?, 'Minuta Inicial', 'Conteúdo da versão 1', 1)
  `).run(artifactId, officeA, userLawyer, runId));

  (await testDb.prepare(`
    INSERT INTO ai_artifact_version (artifact_id, version, title, content, user_id)
    VALUES (?, 1, 'Minuta Inicial', 'Conteúdo da versão 1', ?)
  `).run(artifactId, userLawyer));

  const updated = await artifactsService.saveArtifact(context, {
    artifactId,
    title: "Minuta Atualizada",
    content: "Conteúdo da versão 2 com aditivos",
    version: 1,
  });
  assert.equal(updated.artifact.version, 2);

  const versions = await artifactsService.listArtifactVersions(context, { artifactId });
  assert.equal(versions.versions.length, 2);
  assert.equal(versions.versions[0].version, 2);
  assert.equal(versions.versions[1].version, 1);

  const restored = await artifactsService.restoreArtifactVersion(context, {
    artifactId,
    version: 1,
  });
  assert.equal(restored.artifact.version, 3);
  assert.equal(restored.artifact.content, "Conteúdo da versão 1");
});

test("conversations service: lifecycle and processing locking", async () => {
  const { userLawyer, officeA } = (await seedFixture());
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer };

  const created = await conversationsService.createNewConversation(context, { title: "Dúvidas Tributárias" });
  assert.equal(created.conversation.title, "Dúvidas Tributárias");

  const got = await conversationsService.getConversation(context, { conversationId: created.conversation.id });
  assert.equal(got.conversation.title, "Dúvidas Tributárias");

  (await testDb.prepare("UPDATE ai_conversation SET busy_until=? WHERE id=?")
    .run(Date.now() + 60_000, created.conversation.id));

  await assert.rejects(
    () => conversationsService.deleteConversation(context, { conversationId: created.conversation.id }),
    (err: unknown) => err instanceof CapabilityError && err.code === "CONFLICT"
  );

  (await testDb.prepare("UPDATE ai_conversation SET busy_until=0 WHERE id=?").run(created.conversation.id));
  const deleted = await conversationsService.deleteConversation(context, { conversationId: created.conversation.id });
  assert.equal(deleted.success, true);
});

test("agent tools: mastra tools creation and summary formatting", async () => {
  const { userLawyer, officeA } = (await seedFixture());
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer };

  const tools = agentTools(context, undefined, { whatsappEnabled: true });

  assert.deepEqual(Object.keys(tools).sort(), publishedCapabilities("agent").sort());
  assert.ok(!Object.keys(tools).includes("k5_session_end_global"));
  assert.deepEqual(Object.keys(tools).filter(name => name.startsWith('k5_whatsapp_')).sort(), [
    'k5_whatsapp_list_threads', 'k5_whatsapp_read_thread', 'k5_whatsapp_send',
  ]);
  const withoutWhatsApp = publishedCapabilities("agent").filter(name => capabilities[name].module !== 'whatsapp').sort();
  assert.deepEqual(Object.keys(agentTools(context, undefined, { whatsappEnabled: false })).sort(), withoutWhatsApp);
  assert.deepEqual(Object.keys(agentTools(context)).sort(), withoutWhatsApp);

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

  try {
    for (const whatsappEnabled of [false, true]) {
      registered.length = 0;
      const cleanup = registerWebMCPCapabilities({ whatsappEnabled });
      try {
        const published = publishedCapabilities('webmcp');
        const expected = whatsappEnabled ? published : published.filter(name => capabilities[name].module !== 'whatsapp');
        const names = registered.map(definition => definition.name).sort();
        assert.deepEqual(names, expected.sort(), `the complete catalog with WhatsApp ${whatsappEnabled ? 'enabled' : 'disabled'}`);
        assert.deepEqual(names.filter(name => name.startsWith('k5_whatsapp_')), !whatsappEnabled ? []
          : ['k5_whatsapp_list_threads', 'k5_whatsapp_read_thread', 'k5_whatsapp_send']);
        assert.ok(names.includes('k5_vault_list_cases'));
        assert.ok(names.includes('k5_vault_create_case'));
        for (const name of ['k5_judicial_list_publications', 'k5_judicial_get_publication', ...(whatsappEnabled ? ['k5_whatsapp_list_threads', 'k5_whatsapp_read_thread'] : [])]) {
          assert.equal(registered.find(definition => definition.name === name)?.hints?.untrustedContentHint, true);
        }
      } finally { assert.doesNotThrow(() => cleanup()); }
    }
    registered.length = 0;
    const cleanup = registerWebMCPCapabilities();
    assert.deepEqual(registered.map(definition => definition.name).sort(), publishedCapabilities('webmcp')
      .filter(name => capabilities[name].module !== 'whatsapp').sort());
    cleanup();
  } finally {
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { document?: unknown }).document;
  }
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

test("approval security: rejects modified target resource or modified input arguments", async () => {
  const { userLawyer, officeA } = (await seedFixture());
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer };

  const c1 = await vaultService.createCase(context, { name: "Caso Original" });
  const c2 = await vaultService.createCase(context, { name: "Caso Invasor" });

  const proposal = await approvalsService.createApprovalProposal(context, "k5_vault_delete_case", { caseId: c1.case.id });
  await approvalsService.approveProposal(context, proposal.id);

  await assert.rejects(
    () => vaultService.deleteCase(context, { caseId: c2.case.id, approvalId: proposal.id }),
    (err: unknown) => err instanceof CapabilityError && err.code === "FORBIDDEN"
  );

  const proposalWithTarget = await approvalsService.createApprovalProposal(context, "k5_vault_delete_case", { caseId: c1.case.id, targetCaseId: c2.case.id });
  await approvalsService.approveProposal(context, proposalWithTarget.id);

  await assert.rejects(
    () => vaultService.deleteCase(context, { caseId: c1.case.id, targetCaseId: "different-target", approvalId: proposalWithTarget.id }),
    (err: unknown) => err instanceof CapabilityError && err.code === "FORBIDDEN"
  );
});

test("knowledge engine: vectors fuse with lexical hits and tombstones stay out", async () => {
  const { userLawyer, officeA } = (await seedFixture());
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer };

  const docId = randomUUID();
  const chunkId1 = randomUUID();
  const chunkId2 = randomUUID();
  const genId = randomUUID();

  (await testDb.prepare(`
    INSERT INTO vault_document (id, office_id, scope, original_name, stored_name, mime_type, byte_size, sha256, status, created_by)
    VALUES (?, ?, 'library', 'contrato-vetor.pdf', 'contrato-vetor.pdf', 'application/pdf', 2048, 'hash-v', 'ready', ?)
  `).run(docId, officeA, userLawyer));

  (await testDb.prepare(`
    INSERT INTO vault_document_chunk (id, document_id, office_id, ordinal, stable_reference, content)
    VALUES (?, ?, ?, 0, 'página:1', 'Cláusula de rescisão antecipada com multa contratual.'),
           (?, ?, ?, 1, 'página:2', 'Foro de eleição na comarca de Curitiba Paraná.')
  `).run(chunkId1, docId, officeA, chunkId2, docId, officeA));

  (await testDb.prepare(`
    INSERT INTO knowledge_index_generation (id, office_id, profile_name, model_id, dimension, chunker, status)
    VALUES (?, ?, 'embedding', 'test-embed', 3, 'structural', 'active')
  `).run(genId, officeA));

  await pinTestDocument(docId);

  await (await vectorIndex()).upsert(officeA, genId, [
    { chunkId: chunkId1, documentId: docId, embedding: Float32Array.from([1, 0, 0]) },
    { chunkId: chunkId2, documentId: docId, embedding: Float32Array.from([0, 1, 0]) },
  ]);

  const hits = await (await vectorIndex()).query(officeA, genId, Float32Array.from([0, 1, 0]), { documentIds: [docId], topK: 5 });
  assert.equal(hits[0]?.chunkId, chunkId2, "cosine similarity ranks the semantically closest chunk first");

  const lexical = await knowledgeService.searchKnowledge(context, { query: "rescisão", documentIds: [docId] });
  assert.equal(lexical.degraded, true);
  assert.ok(lexical.degradedReason, "a degraded search explains why it is degraded");
  assert.equal(lexical.sources[0].sourceId, chunkId1);

  (await testDb.prepare("UPDATE vault_document SET deleted_at=CURRENT_TIMESTAMP WHERE id=?").run(docId));
  await assert.rejects(
    () => knowledgeService.searchKnowledge(context, { query: "rescisão", documentIds: [docId] }),
    (err: unknown) => err instanceof CapabilityError && err.code === "NOT_FOUND"
  );
});

test("knowledge scope: updating sources for a conversation does not duplicate rows", async () => {
  const { userLawyer, officeA } = (await seedFixture());
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer };

  const conv = await conversationsService.createNewConversation(context, { title: "Escopo Conversa" });
  const docId = randomUUID();
  (await testDb.prepare(`
    INSERT INTO vault_document (id, office_id, scope, original_name, stored_name, mime_type, byte_size, sha256, status, created_by)
    VALUES (?, ?, 'library', 'doc-escopo.pdf', 'doc-escopo.pdf', 'application/pdf', 1000, 'hash', 'ready', ?)
  `).run(docId, officeA, userLawyer));

  await pinTestDocument(docId);

  await knowledgeService.setScopeSources(context, { conversationId: conv.conversation.id, documentIds: [docId] });

  await knowledgeService.setScopeSources(context, { conversationId: conv.conversation.id, documentIds: [docId] });

  const rows = (await testDb.prepare("SELECT count(*) AS n FROM knowledge_scope WHERE office_id=? AND conversation_id=?").get(officeA, conv.conversation.id)) as { n: number };
  assert.equal(rows.n, 1, "There must only be 1 scope record per conversation");
});

test("ui service: openResource validates resource access and throws NOT_FOUND on cross-office or invalid IDs", async () => {
  const { userLawyer, officeA, officeB } = (await seedFixture());
  const contextA: WorkspaceContext = { officeId: officeA, userId: userLawyer };

  const foreignCaseId = randomUUID();
  (await testDb.prepare("INSERT INTO vault_case (id, office_id, name, created_by) VALUES (?, ?, 'Caso Alheio', ?)")
    .run(foreignCaseId, officeB, userLawyer));

  await assert.rejects(
    () => uiService.openResource(contextA, { resourceType: "case", resourceId: foreignCaseId }),
    (err: unknown) => err instanceof CapabilityError && err.code === "NOT_FOUND"
  );

  const localCase = await vaultService.createCase(contextA, { name: "Caso Alfa Local" });
  const res = await uiService.openResource(contextA, { resourceType: "case", resourceId: localCase.case.id });
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
    const published = publishedCapabilities("webmcp");
    assert.ok(!published.includes("k5_session_end_global"), "global logout is never a browser tool");

    for (const name of published) {
      const result = await executeViaHttp(name, workspaceCapabilityInputs[name] ?? {
        caseId: randomUUID(), documentId: randomUUID(), artifactId: randomUUID(),
        runId: randomUUID(), conversationId: randomUUID(), uploadRef: randomUUID(), folderId: randomUUID(),
        documentIds: [randomUUID()], query: "teste", name: "nome do caso", title: "titulo",
        content: "conteudo", version: 1, instructions: "instrucoes", resourceType: "vault",
        stableReference: "página:1", scope: "library",
        installationId: randomUUID(), linkId: randomUUID(), publicationId: randomUUID(),
        jobId: randomUUID(), alertId: randomUUID(), number: "0000001-05.2025.8.26.0100",
        clientId: randomUUID(), activityId: randomUUID(), kind: 'task', message: 'Criar tarefa de revisão', proposalId: randomUUID(),
        theme: 'guarda da avó', judgmentId: randomUUID(),
        scanDocumentId: randomUUID(), items: [{ label: 'Procuração', startPage: 1, endPage: 1 }],
        ...(capabilities[name].module === 'whatsapp' ? {
          threadId: randomUUID(), text: 'Recebemos seu documento.', idempotencyKey: randomUUID(),
        } : {}),
        ...(capabilities[name].module === 'google' ? {
          scope: name === 'k5_drive_import_file' || name === 'k5_drive_list_imports' ? 'case' : 'series', from: '2026-09-01T00:00:00-03:00', to: '2026-09-30T00:00:00-03:00',
          calendarId: randomUUID(), eventId: randomUUID(), threadId: randomUUID(), draftId: randomUUID(),
          fileId: randomUUID(), messageId: randomUUID(), partId: '1', permissionId: randomUUID(),
          response: 'accepted', changes: { title: 'Título' }, email: 'pessoa@example.com', role: 'reader',
          revisionId: 'revision', edits: [{ find: 'Original', replace: 'Revisado' }],
          ...(name === 'k5_gmail_send' || name === 'k5_gmail_save_draft' ? { to: ['pessoa@example.com'] } : {}),
        } : {}),
      });
      assert.equal(result.ok, true, `${name} should reach a route: ${JSON.stringify(result)}`);
    }
    assert.ok(lastUrl.startsWith("/api/"), "routes stay same-origin");

    (globalThis as unknown as { fetch: typeof fetch }).fetch = async () => ({
      ok: false, status: 403, json: async () => ({ error: "Origem não autorizada.", code: "FORBIDDEN" }),
    } as unknown as Response);
    const denied = await executeViaHttp("k5_vault_list_cases", {});
    assert.equal(denied.ok, false);
    assert.equal(denied.ok === false && denied.code, "FORBIDDEN");

    const invalid = await executeViaHttp("k5_knowledge_search", { query: "x", documentIds: [] });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.ok === false && invalid.code, "INVALID");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('vault pagination reaches older documents with stable ordering and preserves office, case and folder scopes', async () => {
  const { userLawyer, officeA, officeB } = await seedFixture();
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer };
  const prefix = randomUUID();
  await testDb.prepare(`INSERT INTO vault_document (id,office_id,scope,original_name,stored_name,mime_type,byte_size,sha256,status,created_by,created_at)
    SELECT ? || '-' || lpad(n::text,3,'0'),?,'library','Arquivo ' || n,? || '-' || n,'text/plain',1,'hash','ready',?,'2026-01-01' FROM generate_series(1,201) n`)
    .run(prefix, officeA, prefix, userLawyer);
  await testDb.prepare(`INSERT INTO vault_document (id,office_id,scope,original_name,stored_name,mime_type,byte_size,sha256,status,created_by,deleted_at)
    VALUES (?,?,'library','Excluído',?,'text/plain',1,'hash','ready',?,CURRENT_TIMESTAMP),
    (?,?,'library','Outro escritório',?,'text/plain',1,'hash','ready',?,NULL)`)
    .run(randomUUID(), officeA, randomUUID(), userLawyer, randomUUID(), officeB, randomUUID(), userLawyer);
  const pinned=await testDb.prepare('SELECT id FROM vault_document WHERE office_id=? AND deleted_at IS NULL').all<{id:string}>(officeA);
  for(const row of pinned)await pinTestDocument(row.id);
  const ids: string[] = [];
  for (let offset = 0; offset < 201; offset += 50) {
    const input = capabilities.k5_vault_list_documents.input.parse({ scope: 'library', limit: 50, offset });
    const page = await vaultService.listDocuments(context, input);
    assert.equal(page.total, 201);
    assert.ok(page.documents.length <= 50);
    ids.push(...page.documents.map(document => document.id));
    assert.deepEqual((await vaultService.listDocuments(context, input)).documents, page.documents);
  }
  assert.deepEqual(ids, Array.from({ length: 201 }, (_, i) => `${prefix}-${String(201 - i).padStart(3, '0')}`));
  assert.equal(new Set(ids).size, 201);
  assert.equal((await vaultService.listDocuments(context, { scope: 'library', limit: 50, offset: 250 })).documents.length, 0);
  for (const offset of [-1, 0.5, Infinity]) assert.equal(capabilities.k5_vault_list_documents.input.safeParse({ offset }).success, false);

  const { case: vaultCase } = await vaultService.createCase(context, { name: `Paginação ${prefix}` });
  const { folder } = await vaultService.createFolder(context, { caseId: vaultCase.id, name: 'Pasta' });
  for (const folderId of [null, folder.id]) {
    await testDb.prepare(`INSERT INTO vault_document (id,office_id,case_id,folder_id,scope,original_name,stored_name,mime_type,byte_size,sha256,status,created_by)
      VALUES (?,?,?,?,'case','No caso',?,'text/plain',1,'hash','ready',?)`)
      .run(randomUUID(), officeA, vaultCase.id, folderId, randomUUID(), userLawyer);
  }
  for(const row of await testDb.prepare('SELECT id FROM vault_document WHERE case_id=?').all<{id:string}>(vaultCase.id))await pinTestDocument(row.id);
  const root = await vaultService.listDocuments(context, { caseId: vaultCase.id, folderId: null, limit: 50, offset: 0 });
  assert.equal(root.total, 1);
  assert.equal(root.documents[0].folderId, null);
  const nested = await vaultService.listDocuments(context, { caseId: vaultCase.id, folderId: folder.id, limit: 50, offset: 0 });
  assert.equal(nested.total, 1);
  assert.equal(nested.documents[0].folderId, folder.id);
  const scoped = await vaultService.listDocuments({ ...context, caseScope: { caseId: vaultCase.id, homeOfficeId: officeB } }, { scope: 'library', limit: 50, offset: 0 });
  assert.equal(scoped.total, 2);
  assert.ok(scoped.documents.every(document => document.caseId === vaultCase.id));

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async input => {
      const url = new URL(String(input), 'http://localhost');
      assert.equal(url.searchParams.get('limit'), '50');
      assert.equal(url.searchParams.get('offset'), '200');
      return Response.json(await vaultService.listDocuments(context, { scope: 'library', limit: 50, offset: 200 }));
    };
    const result = await executeViaHttp('k5_vault_list_documents', { scope: 'library', limit: 50, offset: 200 });
    assert.equal(result.ok, true);
  } finally { globalThis.fetch = originalFetch; }
});

test("platform service: create, list, and delete the platform's AI connections", async () => {
  process.env.K5_CREDENTIALS_KEY = randomBytes(32).toString("base64");
  const { userAdmin, officeA } = (await seedFixture());
  const context: WorkspaceContext = { officeId: officeA, userId: userAdmin };

  await grantPlatformAdmin(testDatabase, userAdmin);

  const created = await platformService.platformCreateConnection(context, {
    name: "Conexão Teste OpenAI",
    provider: "openai",

    secretRef: (await createSecretRef(userAdmin, "sk-test-fake-key-12345")).id,
    enabled: true,
    models: { embedding: null },
  });
  assert.equal(created.connection.name, "Conexão Teste OpenAI");
  assert.equal(created.connection.provider, "openai");

  const list = await platformService.platformListConnections(context);
  const found = list.connections.find(c => c.id === created.connection.id);
  assert.ok(found);

  const updated = await platformService.platformUpdateConnection(context, {
    connectionId: created.connection.id,
    name: "Conexão Teste OpenAI v2",
    models: { embedding: null },
  });
  assert.equal(updated.connection.name, "Conexão Teste OpenAI v2");

  const deleted = await platformService.platformDeleteConnection(context, {
    connectionId: created.connection.id,
  });
  assert.equal(deleted.success, true);
});

test("vault drive: a case carries its client data and folders stay inside their own case", async () => {
  const { userLawyer, officeA, officeB, userOfficeB } = (await seedFixture());
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer };
  const other: WorkspaceContext = { officeId: officeB, userId: userOfficeB };

  const created = await vaultService.createCase(context, {
    name: `Drive ${randomUUID()}`,
    description: "Ação de rescisão contratual.",
    client: { name: "Maria Silva", document: "123.456.789-00", email: "maria@example.test" },
  });
  assert.equal(created.created, true);
  assert.equal(created.case.description, "Ação de rescisão contratual.");
  assert.equal(created.case.client.name, "Maria Silva");
  assert.equal(created.case.documentCount, 0);

  const renamed = await vaultService.updateCase(context, { caseId: created.case.id, name: "Caso renomeado" });
  assert.equal(renamed.case.name, "Caso renomeado");
  assert.equal(renamed.case.client.name, "Maria Silva");
  assert.equal(renamed.case.description, "Ação de rescisão contratual.");

  const root = await vaultService.createFolder(context, { caseId: created.case.id, name: "Petições" });
  const child = await vaultService.createFolder(context, { caseId: created.case.id, name: "2026", parentId: root.folder.id });
  assert.equal(child.folder.parentId, root.folder.id);
  assert.deepEqual((await vaultService.listFolders(context, { caseId: created.case.id })).folders.map((f) => f.name), ["Petições"]);
  assert.deepEqual((await vaultService.listFolders(context, { caseId: created.case.id, parentId: root.folder.id })).path.map((f) => f.name), ["Petições"]);

  await assert.rejects(() => vaultService.createFolder(context, { caseId: created.case.id, name: "Petições" }), (error) => error instanceof CapabilityError && error.code === "CONFLICT");
  const foreign = await vaultService.createCase(other, { name: `Beta ${randomUUID()}` });
  await assert.rejects(
    () => vaultService.createFolder(context, { caseId: foreign.case.id, name: "Qualquer" }),
    (error) => error instanceof CapabilityError && error.code === "NOT_FOUND",
  );

  await vaultService.deleteFolder(context, { folderId: root.folder.id });
  assert.deepEqual((await vaultService.listFolders(context, { caseId: created.case.id })).folders.map((f) => f.name), ["2026"]);
});

test("knowledge engine: an empty scope searches this office's Cofre and never another's", async () => {
  const { userLawyer, officeA, officeB, userOfficeB } = (await seedFixture());
  const context: WorkspaceContext = { officeId: officeA, userId: userLawyer };

  const seedDocument = async (officeId: string, userId: string, name: string, text: string) => {
    const documentId = randomUUID();
    (await testDb.prepare(`
      INSERT INTO vault_document (id, office_id, scope, original_name, stored_name, mime_type, byte_size, sha256, status, created_by)
      VALUES (?, ?, 'library', ?, ?, 'application/pdf', 1024, 'sha', 'ready', ?)
    `).run(documentId, officeId, name, `stored-${documentId}.pdf`, userId));
    (await testDb.prepare(`
      INSERT INTO vault_document_chunk (id, document_id, office_id, ordinal, stable_reference, content)
      VALUES (?, ?, ?, 0, 'página:1', ?)
    `).run(randomUUID(), documentId, officeId, text));
    await pinTestDocument(documentId);
    return documentId;
  };

  const mine = await seedDocument(officeA, userLawyer, "laudo-pericial.pdf", "O laudo pericial apontou infiltração na laje.");
  await seedDocument(officeB, userOfficeB, "laudo-alheio.pdf", "O laudo pericial do escritório vizinho.");

  const result = await knowledgeService.searchKnowledge(context, { query: "laudo pericial" });
  assert.ok(result.sources.length > 0, "the whole Cofre is in scope when no document is named");
  assert.ok(result.sources.every((source) => source.documentId === mine), "another office's documents never enter the scope");
});
