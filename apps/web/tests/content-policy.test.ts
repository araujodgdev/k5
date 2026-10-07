import { fixtureSession } from './session-fixture';
import { testDb as db } from './test-setup';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { recordingWriter } from './shared-writing-fixture';
import { ensureOfficeForUser } from '../src/lib/offices';
import { createConversation } from '../src/lib/ai-store';
import { authorizeMessageScope } from '../src/lib/chat-scope-server';
import { recordPersonRequest } from '../src/lib/documents/shared-writing';
import { createPrivateDocument, updatePrivateDocument, documentTransaction } from '../src/lib/documents/service';
import { createPage, updatePage, getPage, proposePageWrite, publishPage, approvalPreview } from '../src/lib/case-pages/service';
import { approveProposal, rejectProposal, getApprovalProposal } from '../src/lib/application/approvals-service';
import { decideAgentApproval } from '../src/lib/application/agent-approvals';
import { artifactPolicy, assertPolicyAccess, legacyGuards, observePage, personPolicy } from '../src/lib/content-policy';
import { saveInstruction } from '../src/lib/agent-instructions';
import { saveArtifactToVault, updateDocument } from '../src/lib/application/vault-service';
import { countVaultDocuments, listVaultDocuments, getDocumentChunks, readVaultDocumentFile, processDocument, createVaultFolder, updateVaultFolderAccess } from '../src/lib/vault';
import { vaultPolicy } from '../src/lib/content-policy';
import { recordProvenance } from '../src/lib/case-pages/provenance';
import { authStore } from '../src/lib/database';
import { createChatAttachment, resolveChatAttachments, claimChatAttachments } from '../src/lib/chat-attachments';
import type { WorkspaceContext } from '../src/lib/application/context';

async function fixture() {
  const userId = randomUUID();
  await db.prepare('INSERT INTO "user"(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@sources.test`, 'Pessoa');
  const { officeId } = await ensureOfficeForUser(db, { id: userId, officeName: 'Fontes' });
  const context: WorkspaceContext = { userId, officeId, sessionId: await fixtureSession(userId) };
  const caseId = randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, officeId, 'Caso selecionado', userId);
  const { id: conversationId } = await createConversation(db, context);
  const request = async (text: string, pageId?: string, continuationId?: string) => {
    const scope = await authorizeMessageScope(context, { caseId, documentIds: [], researchReferenceIds: [], ...(pageId ? { document: { kind: 'case-page' as const, caseId, id: pageId } } : {}) });
    return { ...context, invocation: 'agent' as const, conversationId, generationId: randomUUID(),
      submissionId: await recordPersonRequest(context, conversationId, randomUUID(), text, scope, [], { continuationId }) };
  };
  return { context, caseId, conversationId, request };
}

test('actual structured provider request excludes private transcript, opaque memory, planner text and legacy settings; retry/follow-up/regeneration remain exact', async t => {
  const f = await fixture();
  await db.prepare('UPDATE ai_conversation SET messages=? WHERE id=?').run(JSON.stringify([
    { id: 'old', role: 'assistant', parts: [{ type: 'text', text: 'PRIVATE_TRANSCRIPT_SENTINEL' }, { type: 'data-approval', data: { summary: 'PRIVATE_PREVIEW_SENTINEL' } }] },
  ]), f.conversationId);
  await saveInstruction(f.context, 'personal', { title: 'Tom', content: 'ELIGIBLE_STYLE_SENTINEL', appliesTo: 'all', enabled: true });
  await saveInstruction({ ...f.context, invocation: 'agent' }, 'personal', { title: 'Privada', content: 'PRIVATE_SETTING_SENTINEL', appliesTo: 'all', enabled: true });
  await db.prepare('INSERT INTO agent_instruction(id,office_id,user_id,title,content,applies_to,enabled,updated_by) VALUES(?,?,?,?,?,?,true,?)')
    .run(randomUUID(), f.context.officeId, f.context.userId, 'Legada', 'LEGACY_SETTING_SENTINEL', 'all', f.context.userId);
  await recordProvenance(f.context, 'conversation', f.conversationId, { complete: false, dependencies: [] });
  const wire = await recordingWriter(t, f.context.userId, [
    { title: 'Proposta exata', content: 'ELIGIBLE_PREVIOUS_OUTPUT' },
    { title: 'Versão breve', content: 'FOLLOWUP_OUTPUT' },
    { title: 'Nova tentativa', content: 'REGENERATED_OUTPUT' },
  ]);
  const context = await f.request('PERSON_REQUEST_SENTINEL: crie uma página.');
  const target = { caseId: f.caseId, folderId: null, title: 'PRIVATE_PLANNER_SENTINEL', content: 'PRIVATE_PLAN_SENTINEL' };
  const first = await proposePageWrite(context, 'k5_case_pages_create', target);
  const retry = await proposePageWrite(context, 'k5_case_pages_create', target);
  assert.equal(first.approvalId, retry.approvalId);
  assert.equal(wire.length, 1);
  const sent = JSON.stringify(wire[0].body);
  assert.match(sent, /PERSON_REQUEST_SENTINEL/);
  assert.match(sent, /ELIGIBLE_STYLE_SENTINEL/);
  assert.doesNotMatch(sent, /PRIVATE_|LEGACY_SETTING|previous_response_id|item_reference/);
  assert.match(wire[0].session!, /^lume-task-/);
  assert.equal(wire[0].body.store, false);
  assert.deepEqual(wire[0].body.tools ?? [], []);
  const followup = await f.request('Deixe mais breve.', undefined, first.approvalId);
  const next = await proposePageWrite(followup, 'k5_case_pages_create', { caseId: f.caseId, folderId: null });
  assert.match(JSON.stringify(wire[1].body), /ELIGIBLE_PREVIOUS_OUTPUT/);
  assert.match(JSON.stringify(wire[1].body), /Deixe mais breve/);
  assert.notEqual(first.approvalId, next.approvalId);
  await proposePageWrite({ ...followup, generationId: randomUUID() }, 'k5_case_pages_create', { caseId: f.caseId, folderId: null });
  assert.equal(wire.length, 3);
  assert.equal(new Set(wire.map(request => request.session)).size, 3);
  assert.equal((await approvalPreview(f.context, first.approvalId)).content, 'ELIGIBLE_PREVIOUS_OUTPUT');
  const results = await Promise.all([decideAgentApproval(f.context, first.approvalId, 'confirm'), decideAgentApproval(f.context, first.approvalId, 'confirm')]);
  assert.deepEqual(results.map(result => result.state), ['confirmed', 'confirmed']);
  const rows = await db.prepare('SELECT * FROM case_page WHERE case_id=?').all<{ id: string; version: number }>(f.caseId);
  assert.equal(rows.length, 1);
  await updatePage(f.context, { caseId: f.caseId, pageId: rows[0].id, version: 1, title: 'Alteração posterior', content: 'OTHER_REVISION' });
  const input = JSON.parse((await getApprovalProposal(f.context, first.approvalId)).normalized_input);
  const { createPage: confirm } = await import('../src/lib/case-pages/service');
  const replay = await confirm(context, { ...input, approvalId: first.approvalId });
  assert.equal(replay.page.version, 1); assert.equal(replay.page.content, 'ELIGIBLE_PREVIOUS_OUTPUT');
});

test('A/B/A and reciprocal old-version observations use flat immutable obligations, with finite cyclic legacy compatibility', async () => {
  const f = await fixture();
  const a = (await createPage(f.context, { caseId: f.caseId, folderId: null, title: 'A', content: 'A1' })).page;
  const b = (await createPage(f.context, { caseId: f.caseId, folderId: null, title: 'B', content: 'B1' })).page;
  const [a1, b1] = await Promise.all([observePage(f.context.userId, a.id, f.caseId), observePage(f.context.userId, b.id, f.caseId)]);
  async function derivative(source: typeof a1, title: string) {
    const artifact = await createPrivateDocument(f.context, { title, content: source.content, sources: [source.policy] });
    const input = { caseId: f.caseId, folderId: null, artifactId: artifact.id, artifactVersion: 1 };
    const approval = await proposePageWrite(f.context, 'k5_case_pages_publish', input);
    await approveProposal(f.context, approval.approvalId);
    return (await publishPage(f.context, { ...input, approvalId: approval.approvalId })).page;
  }
  const [a2, b2] = await Promise.all([derivative(b1, 'A de B'), derivative(a1, 'B de A')]);
  const back = await derivative(await observePage(f.context.userId, a2.id, f.caseId), 'B de A de B');
  assert.equal((await getPage(f.context, { caseId: f.caseId, pageId: back.id })).page.content, 'B1');
  assert.equal((await getPage(f.context, { caseId: f.caseId, pageId: b2.id })).page.content, 'A1');
  await db.prepare('UPDATE case_page SET content_policy=NULL,source_dependencies=?::jsonb WHERE id=?').run(JSON.stringify([{ kind: 'page', id: b.id, caseId: f.caseId }]), a.id);
  await db.prepare('UPDATE case_page SET content_policy=NULL,source_dependencies=?::jsonb WHERE id=?').run(JSON.stringify([{ kind: 'page', id: a.id, caseId: f.caseId }]), b.id);
  let reads = 0;
  const counted = { prepare(sql: string) { reads++; return db.prepare(sql); } };
  const guards = await legacyGuards([{ kind: 'page', id: a.id, caseId: f.caseId }], counted);
  assert.equal(guards.length, 2); assert.equal(reads, 1);
  await assertPolicyAccess(f.context.userId, { ...personPolicy('', ''), guards });
});

test('failed private content/history/policy write leaves classification and version intact; unsampled versions keep policy without text history', async () => {
  const f = await fixture();
  const artifact = await createPrivateDocument(f.context, { title: 'Humana', content: 'Original' });
  const original = await artifactPolicy(f.context, artifact.id);
  await db.exec("ALTER TABLE ai_artifact_policy ADD CONSTRAINT reject_test_policy CHECK(version<>2) NOT VALID");
  try { await assert.rejects(updatePrivateDocument({ ...f.context, invocation: 'agent' }, { id: artifact.id, version: 1, title: 'Gerada', content: 'FAILED_PRIVATE', snapshot: false })); }
  finally { await db.exec('ALTER TABLE ai_artifact_policy DROP CONSTRAINT reject_test_policy'); }
  assert.deepEqual(await artifactPolicy(f.context, artifact.id), original);
  assert.equal((await db.prepare('SELECT version FROM ai_artifact WHERE id=?').get<{ version: number }>(artifact.id))!.version, 1);
  await updatePrivateDocument(f.context, { id: artifact.id, version: 1, title: 'Humana', content: 'Autosave', snapshot: false });
  assert.equal((await artifactPolicy(f.context, artifact.id, db, 2)).eligible, true);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM ai_artifact_version WHERE artifact_id=?').get<{ n: number }>(artifact.id))!.n, 1);
  assert.equal(await updatePrivateDocument({ ...f.context, invocation: 'agent' }, { id: artifact.id, version: 1, title: 'Stale', content: 'PRIVATE', snapshot: false }), null);
  assert.equal((await artifactPolicy(f.context, artifact.id)).eligible, true);
});

test('ACL changes and content commits acquire opposite sides of the real database gate before row locks', async () => {
  const f = await fixture();
  const pool = await authStore();
  const client = await pool.connect();
  const acquired = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const content = documentTransaction(f.context, async tx => {
    await tx.prepare('SELECT id FROM vault_case WHERE id=?').get(f.caseId);
    acquired.resolve(); await release.promise;
    await tx.prepare('SELECT 1 FROM vault_case WHERE id=? AND deleted_at IS NULL').get(f.caseId);
  });
  await acquired.promise;
  const pid = Number((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
  const revoke = client.query('UPDATE vault_case SET deleted_at=CURRENT_TIMESTAMP WHERE id=$1', [f.caseId]);
  try {
    for (let reads = 0; ; reads++) {
      const row = await db.prepare("SELECT wait_event FROM pg_stat_activity WHERE pid=?").get<{ wait_event: string | null }>(pid);
      if (row?.wait_event === 'advisory') break;
      assert.ok(reads < 100, 'ACL writer must block on the shared content gate');
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  } finally { release.resolve(); await content; await revoke; client.release(); }
  await assert.rejects(assertPolicyAccess(f.context.userId, { ...personPolicy('', ''), guards: [{ kind: 'case', id: f.caseId }] }), { code: 'NOT_FOUND' });
});

test('managed archive, move, list/count/chunks/download retain owner and original folder restrictions', async () => {
  const f = await fixture(), guest = await fixture();
  await db.prepare('INSERT INTO case_participant(office_id,case_id,user_id,invited_by) VALUES(?,?,?,?)').run(f.context.officeId, f.caseId, guest.context.userId, f.context.userId);
  const folder = await createVaultFolder(f.context.officeId, guest.context.userId, f.caseId, 'Origem protegida', null, { visibility: 'restricted', memberIds: [f.context.userId] }, { ...guest.context, officeId: f.context.officeId, caseScope: { caseId: f.caseId, homeOfficeId: guest.context.officeId } });
  const original = (await createPage(f.context, { caseId: f.caseId, folderId: folder.id, title: 'Fonte', content: 'PROTECTED_ORIGINAL_SENTINEL' })).page;
  const observed = await observePage(f.context.userId, original.id, f.caseId);
  const draft = await createPrivateDocument({ ...f.context, invocation: 'agent', contentSources: [observed.policy] }, { title: 'Rascunho privado', content: observed.content });
  const archived = await saveArtifactToVault(f.context, { artifactId: draft.id, version: 1, format: 'docx', scope: 'library' });
  await processDocument(archived.document.id, f.context.officeId);
  const copied = await vaultPolicy(archived.document.id);
  assert.equal(copied.eligible, false); assert.deepEqual(copied.owners, [f.context.userId]);
  assert.ok((await readVaultDocumentFile(f.context.officeId, archived.document.id, f.context.userId)).buffer.length > 100);
  await updateDocument(f.context, { documentId: archived.document.id, caseId: f.caseId, folderId: null });
  assert.equal(await countVaultDocuments(f.context.officeId, guest.context.userId, { caseId: f.caseId }), 0);
  assert.deepEqual(await listVaultDocuments(f.context.officeId, guest.context.userId, { caseId: f.caseId }), []);
  await assert.rejects(getDocumentChunks(f.context.officeId, guest.context.userId, [archived.document.id]));
  await assert.rejects(readVaultDocumentFile(f.context.officeId, archived.document.id, guest.context.userId));
  await updateVaultFolderAccess(f.context.officeId, folder.id, guest.context.userId, { visibility: 'private' }, { ...guest.context, officeId: f.context.officeId, caseScope: { caseId: f.caseId, homeOfficeId: guest.context.officeId } });
  await assert.rejects(artifactPolicy(f.context, draft.id).then(policy => assertPolicyAccess(f.context.userId, policy)), { code: 'NOT_FOUND' });
  assert.equal(await countVaultDocuments(f.context.officeId, f.context.userId, { caseId: f.caseId }), 0);
  assert.deepEqual(await listVaultDocuments(f.context.officeId, f.context.userId, { caseId: f.caseId }), []);
  await assert.rejects(getDocumentChunks(f.context.officeId, f.context.userId, [archived.document.id]));
  await assert.rejects(readVaultDocumentFile(f.context.officeId, archived.document.id, f.context.userId));
});

test('reciprocal A2 from B1 and B2 from A1 commit concurrently on the same page identities', async t => {
  const f = await fixture();
  const a = (await createPage(f.context, { caseId: f.caseId, folderId: null, title: 'A', content: 'A1' })).page;
  const b = (await createPage(f.context, { caseId: f.caseId, folderId: null, title: 'B', content: 'B1' })).page;
  async function sourceFile(page: typeof a) {
    const source = await observePage(f.context.userId, page.id, f.caseId);
    const artifact = await createPrivateDocument(f.context, { title: source.title, content: source.content, sources: [source.policy] });
    const copy = await saveArtifactToVault(f.context, { artifactId: artifact.id, version: 1, format: 'docx', scope: 'library' });
    await processDocument(copy.document.id, f.context.officeId);
    return copy.document.id;
  }
  const [aFile, bFile] = await Promise.all([sourceFile(a), sourceFile(b)]);
  async function request(page: typeof a, sourceId: string) {
    const convo = await createConversation(db, f.context);
    const scope = await authorizeMessageScope(f.context, { caseId: f.caseId, documentIds: [sourceId], researchReferenceIds: [], document: { kind: 'case-page', id: page.id, caseId: f.caseId } });
    return { ...f.context, invocation: 'agent' as const, conversationId: convo.id, generationId: randomUUID(),
      submissionId: await recordPersonRequest(f.context, convo.id, randomUUID(), 'Incorpore a fonte selecionada.', scope, []) };
  }
  const [ac, bc] = await Promise.all([request(a, bFile), request(b, aFile)]);
  await recordingWriter(t, f.context.userId, [{ title: 'A', content: 'A2 de B1' }, { title: 'B', content: 'B2 de A1' }, { title: 'A', content: 'A3 de B2' }]);
  const [ap, bp] = await Promise.all([
    proposePageWrite(ac, 'k5_case_pages_update', { caseId: f.caseId, pageId: a.id, version: 1 }),
    proposePageWrite(bc, 'k5_case_pages_update', { caseId: f.caseId, pageId: b.id, version: 1 }),
  ]);
  await Promise.all([decideAgentApproval(f.context, ap.approvalId, 'confirm'), decideAgentApproval(f.context, bp.approvalId, 'confirm')]);
  const a2 = (await getPage(f.context, { caseId: f.caseId, pageId: a.id })).page;
  const b2 = (await getPage(f.context, { caseId: f.caseId, pageId: b.id })).page;
  assert.equal(a2.version, 2); assert.equal(b2.version, 2);
  const back = await request(a2, await sourceFile(b2));
  const a3 = await proposePageWrite(back, 'k5_case_pages_update', { caseId: f.caseId, pageId: a.id, version: 2 });
  await decideAgentApproval(f.context, a3.approvalId, 'confirm');
  assert.equal((await getPage(f.context, { caseId: f.caseId, pageId: a.id })).page.version, 3);
  assert.equal((await getPage(f.context, { caseId: f.caseId, pageId: b.id })).page.version, 2);
});

test('cancellation and confirmation have one durable winner and cannot consume without content', async () => {
  const f = await fixture();
  const draft = await createPrivateDocument(f.context, { title: 'Aprovação', content: 'Exato' });
  const input = { caseId: f.caseId, folderId: null, artifactId: draft.id, artifactVersion: 1 };
  const p = await proposePageWrite(f.context, 'k5_case_pages_publish', input);
  await approveProposal(f.context, p.approvalId);
  const outcomes = await Promise.allSettled([publishPage(f.context, { ...input, approvalId: p.approvalId }), rejectProposal(f.context, p.approvalId)]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await getApprovalProposal(f.context, p.approvalId)).status, 'consumed');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM case_page WHERE case_id=?').get<{ n: number }>(f.caseId))!.n, 1);
  const cancelled = await proposePageWrite(f.context, 'k5_case_pages_publish', input);
  await rejectProposal(f.context, cancelled.approvalId);
  assert.equal((await decideAgentApproval(f.context, cancelled.approvalId, 'confirm')).state, 'failed');
  assert.equal((await getApprovalProposal(f.context, cancelled.approvalId)).status, 'rejected');
});

test('an authenticated image attachment reaches the actual structured provider as exact bytes without private continuation', async t => {
  const f = await fixture();
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF8cAAAAASUVORK5CYII=', 'base64');
  const attachment = await createChatAttachment(f.context, f.conversationId, new File([bytes], 'fonte.png', { type: 'image/png' }));
  const messageId = randomUUID();
  const rows = await resolveChatAttachments(f.context, f.conversationId, messageId, [attachment.id]);
  const scope = await authorizeMessageScope(f.context, { caseId: f.caseId, documentIds: [], researchReferenceIds: [] });
  const submissionId = await recordPersonRequest(f.context, f.conversationId, messageId, 'Descreva a imagem anexada.', scope, rows);
  await claimChatAttachments(f.context, f.conversationId, messageId, rows);
  const wire = await recordingWriter(t, f.context.userId, [{ title: 'Imagem', content: 'Imagem anexada pela pessoa.' }]);
  await proposePageWrite({ ...f.context, invocation: 'agent', conversationId: f.conversationId, submissionId, generationId: randomUUID() },
    'k5_case_pages_create', { caseId: f.caseId, folderId: null });
  const sent = JSON.stringify(wire[0].body);
  assert.match(sent, /input_image/);
  assert.ok(sent.includes(bytes.toString('base64')));
  assert.doesNotMatch(sent, /previous_response_id|item_reference/);
  assert.deepEqual(wire[0].body.tools ?? [], []);
});

test('malformed current policies deny real page reads and Vault list, count, chunks and downloads', async () => {
  const f = await fixture();
  const page = (await createPage(f.context, { caseId: f.caseId, folderId: null, title: 'Página', content: 'Texto' })).page;
  await db.prepare('UPDATE case_page SET content_policy=?::jsonb WHERE id=?').run(JSON.stringify({ format: 1, eligible: true }), page.id);
  await assert.rejects(getPage(f.context, { caseId: f.caseId, pageId: page.id }), { code: 'NOT_FOUND' });
  const original = await createPrivateDocument(f.context, { title: 'Pessoal', content: 'Arquivo pessoal' });
  const copy = await saveArtifactToVault(f.context, { artifactId: original.id, version: 1, format: 'docx', scope: 'library' });
  await db.prepare('UPDATE vault_document_version SET content_policy=?::jsonb WHERE document_id=?').run(JSON.stringify({ format: 1, eligible: true, guards: [] }), copy.document.id);
  assert.equal(await countVaultDocuments(f.context.officeId, f.context.userId, {}), 0);
  assert.deepEqual(await listVaultDocuments(f.context.officeId, f.context.userId, {}), []);
  await assert.rejects(getDocumentChunks(f.context.officeId, f.context.userId, [copy.document.id]));
  await assert.rejects(readVaultDocumentFile(f.context.officeId, copy.document.id, f.context.userId));
});
test('pending confirmation and cancellation contend on the real approval row before either can write content', async () => {
  const f = await fixture();
  const artifact = await createPrivateDocument(f.context, { title: 'Disputa', content: 'Uma decisão' });
  const input = { caseId: f.caseId, folderId: null, artifactId: artifact.id, artifactVersion: 1 };
  const proposal = await proposePageWrite(f.context, 'k5_case_pages_publish', input);
  const pool = await authStore(), holder = await pool.connect();
  await holder.query('BEGIN');
  await holder.query('SELECT id FROM capability_approval WHERE id=$1 FOR UPDATE', [proposal.approvalId]);
  const results = Promise.allSettled([approveProposal(f.context, proposal.approvalId), rejectProposal(f.context, proposal.approvalId)]);
  try {
    for (let observations = 0; ; observations++) {
      await holder.query('SELECT pg_stat_clear_snapshot()');
      const waiters = await holder.query("SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%UPDATE capability_approval%'");
      if (Number(waiters.rows[0].n) >= 2) break;
      assert.ok(observations < 200, 'Both production decisions must wait for the independent row lock');
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  } finally { await holder.query('COMMIT'); holder.release(); }
  const outcomes = await results;
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  const approved = (await getApprovalProposal(f.context, proposal.approvalId)).status === 'approved';
  if (approved) await publishPage(f.context, { ...input, approvalId: proposal.approvalId });
  else await assert.rejects(publishPage(f.context, { ...input, approvalId: proposal.approvalId }));
  assert.equal((await db.prepare('SELECT count(*) AS n FROM case_page WHERE case_id=?').get<{ n: number }>(f.caseId))!.n, approved ? 1 : 0);
});
