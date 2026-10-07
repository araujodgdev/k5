import { testDb as db } from './test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { googleFixture } from './google-fixture';
import { recordingWriter } from './shared-writing-fixture';
import { createConversation } from '../src/lib/ai-store';
import { createPage, proposePageWrite } from '../src/lib/case-pages/service';
import { observePage } from '../src/lib/content-policy';
import { createPrivateDocument, updatePrivateDocument } from '../src/lib/documents/service';
import { deleteConversation } from '../src/lib/application/conversations-service';
import { runCapability } from '../src/lib/agent-tools';
import { createUploadRef } from '../src/lib/application/uploads-service';
import { createVaultDocument, processDocument } from '../src/lib/vault';
import { authorizeMessageScope } from '../src/lib/chat-scope-server';
import { recordPersonRequest } from '../src/lib/documents/shared-writing';
import { authStore } from '../src/lib/database';
import { exposedPolicies, personPolicy, type ContentPolicy } from '../src/lib/content-policy';
import { decideAgentApproval } from '../src/lib/application/agent-approvals';
import { getPage } from '../src/lib/case-pages/service';
import { requestOfficeDeletion, purgeOffice } from '../src/lib/office-deletion';

async function fixture() {
  const f = await googleFixture();
  const caseId = randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, f.officeId, 'Revisão 2', f.userId);
  const { id: conversationId } = await createConversation(db, f.context);
  return { ...f, caseId, conversationId };
}

test('a real shared-generation attempt permits ordinary conversation deletion', async t => {
  const f = await fixture();
  await recordingWriter(t, f.userId, [{ title: 'Página', content: 'Conteúdo aprovado para geração.' }]);
  const scope = await authorizeMessageScope(f.context, { caseId: f.caseId, documentIds: [], researchReferenceIds: [] });
  const submissionId = await recordPersonRequest(f.context, f.conversationId, randomUUID(), 'Crie uma página.', scope, []);
  await proposePageWrite({ ...f.context, invocation: 'agent', conversationId: f.conversationId, submissionId, generationId: randomUUID() },
    'k5_case_pages_create', { caseId: f.caseId, folderId: null });
  assert.ok(await db.prepare('SELECT 1 FROM content_generation_attempt WHERE submission_id=?').get(submissionId));
  let caught: unknown;
  try { await deleteConversation(f.context, { conversationId: f.conversationId }); } catch (error) { caught = error; }
  console.log(JSON.stringify({ conversationDelete: caught instanceof Error ? { message: caught.message, code: (caught as { code?: string }).code } : 'succeeded' }));
  assert.equal(caught, undefined, 'Generating a proposal must not prevent deleting its private conversation');
  assert.equal(await db.prepare('SELECT 1 FROM ai_conversation WHERE id=?').get(f.conversationId), undefined);
});

test('a real capability restore retry denies protected bytes after source revocation', async () => {
  const f = await fixture();
  const page = (await createPage(f.context, { caseId: f.caseId, title: 'Fonte restrita', content: 'Fonte' })).page;
  const source = (await observePage(f.userId, page.id, f.caseId)).policy;
  const artifact = await createPrivateDocument(f.context, { title: 'PROTECTED_REPLAY_TITLE', content: 'PROTECTED_REPLAY_BODY', sources: [source] });
  await updatePrivateDocument(f.context, { id: artifact.id, version: artifact.version, title: 'V2', content: 'Conteúdo V2' });
  const input = { artifactId: artifact.id, version: 1, idempotencyKey: randomUUID() };
  const initial = await runCapability(f.context, 'k5_artifacts_restore_version', input);
  assert.match(JSON.stringify(initial), /PROTECTED_REPLAY_BODY/);
  await db.prepare('UPDATE vault_case SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(f.caseId);
  let cached: unknown, caught: unknown;
  try { cached = await runCapability(f.context, 'k5_artifacts_restore_version', input); } catch (error) { caught = error; }
  console.log(JSON.stringify({ retryProtectedContent: JSON.stringify(cached ?? null).includes('PROTECTED_REPLAY_BODY'), code: (caught as { code?: string } | undefined)?.code ?? null }));
  assert.ok(caught && (caught as { code?: string }).code === 'NOT_FOUND', 'A replay must reauthorize the exact protected result');
});

test('pending, failed and consumed attempts delete through the capability while committed pages and approvals survive', async t => {
  const f = await fixture();
  await recordingWriter(t, f.userId, [{ title: 'Committed', content: 'Immutable committed bytes' }, { title: 'Pending', content: 'Pending bytes' }]);
  const scope = await authorizeMessageScope(f.context, { caseId: f.caseId, documentIds: [], researchReferenceIds: [] });
  async function proposal() {
    const submissionId = await recordPersonRequest(f.context, f.conversationId, randomUUID(), 'Create a page.', scope, []);
    return proposePageWrite({ ...f.context, invocation: 'agent', conversationId: f.conversationId, submissionId, generationId: randomUUID() }, 'k5_case_pages_create', { caseId: f.caseId, folderId: null });
  }
  const consumed = await proposal();
  assert.equal((await decideAgentApproval(f.context, consumed.approvalId, 'confirm')).state, 'confirmed');
  const pending = await proposal();
  await assert.rejects(proposal());
  assert.equal((await db.prepare("SELECT count(*)::int AS n FROM content_generation_attempt WHERE office_id=? AND state='failed'").get<{ n: number }>(f.officeId))?.n, 1);
  const page = await db.prepare('SELECT id FROM case_page WHERE case_id=?').get<{ id: string }>(f.caseId);
  assert.ok(page);
  await runCapability(f.context, 'k5_conversations_delete', { conversationId: f.conversationId });
  assert.equal(await db.prepare('SELECT 1 FROM content_generation_attempt WHERE office_id=?').get(f.officeId), undefined);
  assert.ok(await db.prepare('SELECT 1 FROM capability_approval WHERE id=?').get(pending.approvalId));
  assert.equal((await getPage(f.context, { caseId: f.caseId, pageId: page.id })).page.content, 'Immutable committed bytes');
  assert.equal((await decideAgentApproval(f.context, consumed.approvalId, 'confirm')).state, 'confirmed');
  assert.equal((await db.prepare('SELECT count(*)::int AS n FROM case_page_version WHERE page_id=?').get<{ n: number }>(page.id))?.n, 1);
});

test('office purge discovers real attempts and independent approvals without touching another office', async t => {
  const f = await fixture(), other = await fixture();
  await recordingWriter(t, f.userId, [{ title: 'Consumed', content: 'Committed purge' }, { title: 'Pending', content: 'Pending purge' }]);
  const scope = await authorizeMessageScope(f.context, { caseId: f.caseId, documentIds: [], researchReferenceIds: [] });
  async function proposal() {
    const submissionId = await recordPersonRequest(f.context, f.conversationId, randomUUID(), 'Create a page.', scope, []);
    return proposePageWrite({ ...f.context, invocation: 'agent', conversationId: f.conversationId, submissionId, generationId: randomUUID() }, 'k5_case_pages_create', { caseId: f.caseId, folderId: null });
  }
  const consumed = await proposal(); await decideAgentApproval(f.context, consumed.approvalId, 'confirm');
  await proposal(); await assert.rejects(proposal());
  const request = await requestOfficeDeletion(f.context);
  const report = await purgeOffice(request.id, { dryRun: false });
  assert.equal(report.officeId, f.officeId);
  assert.equal(await db.prepare('SELECT 1 FROM content_generation_attempt WHERE office_id=?').get(f.officeId), undefined);
  assert.equal(await db.prepare('SELECT 1 FROM capability_approval WHERE office_id=?').get(f.officeId), undefined);
  assert.ok(await db.prepare('SELECT 1 FROM ai_conversation WHERE id=?').get(other.conversationId));
});

test('concurrent capability saves reserve one effect and replay the exact historical result and exposure', { timeout: 15_000 }, async () => {
  const f = await fixture();
  const sourcePage = (await createPage(f.context, { caseId: f.caseId, title: 'Source', content: 'Protected original' })).page;
  const policy = (await observePage(f.userId, sourcePage.id, f.caseId)).policy;
  const artifact = await createPrivateDocument(f.context, { title: 'V1', content: 'Original historical body', sources: [policy] });
  const input = { artifactId: artifact.id, version: artifact.version, title: 'V2', content: 'Saved once', idempotencyKey: randomUUID() };
  const holder = await (await authStore()).connect();
  let pending: Promise<unknown[]> | undefined;
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM ai_artifact WHERE id=$1 FOR UPDATE', [artifact.id]);
    pending = Promise.all([runCapability(f.context, 'k5_artifacts_update', input), runCapability(f.context, 'k5_artifacts_update', input)]);
    let observed = false;
    for (let i = 0; i < 200; i++) {
      await holder.query('SELECT pg_stat_clear_snapshot()');
      const lock = await holder.query("SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%ai_artifact%FOR UPDATE%'");
      if (lock.rowCount) { observed = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(observed, 'the actual artifact writer waited while the retry reused its reservation');
    await holder.query('COMMIT');
    const [first, second] = await pending;
    assert.deepEqual(second, first);
    assert.equal((await db.prepare('SELECT count(*)::int AS n FROM ai_artifact_version WHERE artifact_id=?').get<{ n: number }>(artifact.id))?.n, 2);
    await updatePrivateDocument(f.context, { id: artifact.id, version: 2, title: 'V3', content: 'Later revision' });
    const contentSources: ContentPolicy[] = [];
    const replay = await runCapability({ ...f.context, invocation: 'agent', conversationId: f.conversationId, contentSources }, 'k5_artifacts_update', input);
    assert.deepEqual(replay, first);
    assert.ok(exposedPolicies(replay)?.some(source => source.guards.some(guard => guard.id === sourcePage.id)));
    assert.ok(contentSources.some(source => source.guards.some(guard => guard.id === sourcePage.id)));
    assert.equal((await db.prepare('SELECT version FROM ai_artifact WHERE id=?').get<{ version: number }>(artifact.id))?.version, 3);
    await assert.rejects(runCapability(f.context, 'k5_artifacts_update', { ...input, content: 'Mismatch' }), { code: 'CONFLICT' });
    await db.prepare('UPDATE vault_case SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(f.caseId);
    await assert.rejects(runCapability(f.context, 'k5_artifacts_update', input), { code: 'NOT_FOUND' });
  } finally { await holder.query('ROLLBACK').catch(() => undefined); holder.release(); await pending; }
});

test('legacy protected JSON cache rows cannot return bytes without a retained replay binding', async () => {
  const f = await fixture();
  const artifact = await createPrivateDocument(f.context, { title: 'Legacy', content: 'Legacy cached protected text' });
  const input = { artifactId: artifact.id, version: artifact.version, title: 'New', content: 'New bytes', idempotencyKey: randomUUID() };
  await runCapability(f.context, 'k5_artifacts_update', input);
  await db.prepare('UPDATE capability_idempotency SET replay_binding=NULL WHERE office_id=? AND idempotency_key=?').run(f.officeId, `${f.userId}:${input.idempotencyKey}`);
  await assert.rejects(runCapability(f.context, 'k5_artifacts_update', input), { code: 'NOT_FOUND' });
  assert.equal((await db.prepare('SELECT version FROM ai_artifact WHERE id=?').get<{ version: number }>(artifact.id))?.version, 2);
});

test('neighboring settings cache retains the exact knowledge note and reauthorizes its original file', async () => {
  const f = await fixture();
  const upload = await createUploadRef(f.context, new File(['Protected settings reference text.'], 'settings-reference.txt', { type: 'text/plain' }));
  const document = await createVaultDocument(f.context, upload, { scope: 'case', caseId: f.caseId, policy: personPolicy('', '') });
  await processDocument(document.id, f.officeId);
  const input = { idempotencyKey: randomUUID(), scope: 'personal', change: { action: 'add_knowledge', documentId: document.id, mode: 'search', note: 'PROTECTED_SETTINGS_NOTE' } };
  const initial = await runCapability(f.context, 'k5_agent_settings_change', input);
  const retry = await runCapability(f.context, 'k5_agent_settings_change', input);
  assert.deepEqual(retry, initial);
  assert.ok(exposedPolicies(retry)?.some(policy => policy.observed.some(pin => pin.id === document.id)));
  assert.equal((await db.prepare('SELECT count(*)::int AS n FROM agent_knowledge WHERE document_id=?').get<{ n: number }>(document.id))?.n, 1);
  await db.prepare('UPDATE vault_document SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(document.id);
  await assert.rejects(runCapability(f.context, 'k5_agent_settings_change', input), { code: 'NOT_FOUND' });
});
