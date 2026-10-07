import { testDb as db } from '../apps/web/tests/test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { googleFixture } from '../apps/web/tests/google-fixture';
import { recordingWriter } from '../apps/web/tests/shared-writing-fixture';
import { createConversation } from '../apps/web/src/lib/ai-store';
import { createPage, proposePageWrite } from '../apps/web/src/lib/case-pages/service';
import { observePage } from '../apps/web/src/lib/content-policy';
import { createPrivateDocument, updatePrivateDocument } from '../apps/web/src/lib/documents/service';
import { deleteConversation } from '../apps/web/src/lib/application/conversations-service';
import { runCapability } from '../apps/web/src/lib/agent-tools';
import { authorizeMessageScope } from '../apps/web/src/lib/chat-scope-server';
import { recordPersonRequest } from '../apps/web/src/lib/documents/shared-writing';

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

