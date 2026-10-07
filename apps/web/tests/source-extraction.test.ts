import { testDb as db } from './test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { googleFixture } from './google-fixture';
import { createUploadRef } from '../src/lib/application/uploads-service';
import { addDocumentVersion } from '../src/lib/application/vault-service';
import { createVaultDocument, processDocument } from '../src/lib/vault';
import { personPolicy, observeDocument } from '../src/lib/content-policy';
import { randomUUID } from 'node:crypto';
import { objectStorage } from '../src/lib/storage';
import { createConversation } from '../src/lib/ai-store';
import { authorizeMessageScope } from '../src/lib/chat-scope-server';
import { recordPersonRequest } from '../src/lib/documents/shared-writing';
import { recordingWriter } from './shared-writing-fixture';
import { proposePageWrite } from '../src/lib/case-pages/service';

test('actual replacement rejects shared submission until exact V2 extraction; its writer receives only V2', async t => {
  const f = await googleFixture();
  const original = await createUploadRef(f.context, new File(['FIRST_VERSION_DEADLINE: cinco dias.'], 'prazo.txt', { type: 'text/plain' }));
  const document = await createVaultDocument(f.context, original, { scope: 'library', policy: personPolicy(original.originalName, original.sha256) });
  await processDocument(document.id, f.officeId);
  const first = await observeDocument(f.userId, document.id);
  assert.match(first.content, /FIRST_VERSION_DEADLINE/);
  const replacement = await createUploadRef(f.context, new File(['SECOND_VERSION_DEADLINE: quinze dias.'], 'prazo.txt', { type: 'text/plain' }));
  const result = await addDocumentVersion(f.context, { documentId: document.id, uploadRef: replacement.id });
  assert.equal(result.version, 2);
  const row = await db.prepare('SELECT status FROM vault_document WHERE id=?').get<{ status: string }>(document.id);
  assert.equal(row?.status, 'queued');
  const caseId = randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, f.officeId, 'Resumo', f.userId);
  const conversation = await createConversation(db, f.context);
  const scope = await authorizeMessageScope(f.context, { caseId, documentIds: [document.id], researchReferenceIds: [] });
  const submit = () => recordPersonRequest(f.context, conversation.id, randomUUID(), 'Resuma o prazo do contrato.', scope, []);
  await assert.rejects(submit(), { code: 'NOT_READY' });
  assert.equal(await db.prepare('SELECT 1 FROM content_submission WHERE conversation_id=?').get(conversation.id), undefined);
  await processDocument(document.id, f.officeId);
  const wire = await recordingWriter(t, f.userId, [{ title: 'Prazo', content: 'quinze dias' }]);
  const submissionId = await submit();
  await proposePageWrite({ ...f.context, conversationId: conversation.id, submissionId, generationId: randomUUID(), invocation: 'agent' }, 'k5_case_pages_create', { caseId, folderId: null });
  assert.match(JSON.stringify(wire[0].body), /SECOND_VERSION_DEADLINE/);
  assert.doesNotMatch(JSON.stringify(wire[0].body), /FIRST_VERSION_DEADLINE/);
});

test('actual stale extraction completion cannot overwrite replacement chunks or readiness', async t => {
  const f = await googleFixture();
  const original = await createUploadRef(f.context, new File(['STALE_WORKER_CONTENT'], 'contrato.txt', { type: 'text/plain' }));
  const document = await createVaultDocument(f.context, original, { scope: 'library', policy: personPolicy('', '') });
  const storage = await objectStorage(), get = storage.get.bind(storage);
  const entered = Promise.withResolvers<void>(), released = Promise.withResolvers<void>();
  t.mock.method(storage, 'get', async (key: string) => {
    const bytes = await get(key);
    if (key === original.storageKey) { entered.resolve(); await released.promise; }
    return bytes;
  });
  const worker = processDocument(document.id, f.officeId);
  const failed = assert.rejects(worker, /perdeu/);
  await entered.promise;
  const replacement = await createUploadRef(f.context, new File(['CURRENT_REPLACEMENT_CONTENT'], 'contrato.txt', { type: 'text/plain' }));
  await addDocumentVersion(f.context, { documentId: document.id, uploadRef: replacement.id });
  released.resolve(); await failed;
  assert.equal(await db.prepare('SELECT 1 FROM vault_document_chunk WHERE document_id=?').get(document.id), undefined);
  await assert.rejects(observeDocument(f.userId, document.id), { code: 'NOT_READY' });
  await processDocument(document.id, f.officeId);
  const actual = await observeDocument(f.userId, document.id);
  assert.match(actual.content, /CURRENT_REPLACEMENT_CONTENT/);
  assert.doesNotMatch(actual.content, /STALE_WORKER_CONTENT/);
  assert.equal(actual.policy.observed.find(pin => pin.kind === 'document')?.version, '2');
});
