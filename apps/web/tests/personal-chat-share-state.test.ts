import { testDb as db, testStorageRoot } from './test-setup';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { personPolicy } from '../src/lib/content-policy';
import { test } from 'node:test';
import type { WorkspaceContext } from '../src/lib/application/context';
import type { PersonContext } from '../src/lib/personal-chat/auth';
import { createShareOutput, type CreateShareInput } from '../src/lib/personal-chat/domain';
import { ensureOfficeForUser } from '../src/lib/offices';
import { invite, respond, changeAccess } from '../src/lib/collaboration/service';
import { getMessageForViewer, startThread } from '../src/lib/personal-chat/service';
import { createShare, readDocumentShare, revokeDocumentShare } from '../src/lib/personal-chat/shares';
import { localObjectStorage, objectStorage, resetObjectStorageForTests, storageKey } from '../src/lib/storage';

resetObjectStorageForTests(localObjectStorage(testStorageRoot));

async function user(name: string) {
  const id = randomUUID(), email = `${id}@share-state.test`, sessionId = randomUUID();
  await db.prepare('INSERT INTO "user"(id,name,email,"emailVerified") VALUES(?,?,?,true)').run(id, name, email);
  await db.prepare(`INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt)
    VALUES(?,?,?,CURRENT_TIMESTAMP+INTERVAL '1 day',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(sessionId, id, randomUUID());
  const office = await ensureOfficeForUser(db, { id, officeName: `${name} Advocacia` });
  return {
    person: { userId: id, email, name, sessionId } satisfies PersonContext,
    workspace: { userId: id, officeId: office.officeId, sessionId } satisfies WorkspaceContext,
  };
}

async function fixture() {
  const owner = await user('Ana'), recipient = await user('Bia');
  const { thread } = await startThread(owner.person, owner.workspace.officeId, {
    requestId: randomUUID(), recipient: { kind: 'exact_email', email: recipient.person.email },
  });
  const documentId = randomUUID(), storedName = storageKey(owner.workspace.officeId, documentId, '.txt');
  const content = Buffer.from('Versão compartilhada.');
  const sha = createHash('sha256').update(content).digest('hex');
  await (await objectStorage()).put(storedName, content);
  await db.prepare(`INSERT INTO vault_document(id,office_id,scope,original_name,stored_name,mime_type,byte_size,sha256,status,created_by)
    VALUES(?,?,'library','Contrato.txt',?,'text/plain',?,?,'ready',?)`)
    .run(documentId, owner.workspace.officeId, storedName, content.length, sha, owner.person.userId);
  await db.prepare(`INSERT INTO vault_document_version(id,office_id,document_id,version,original_name,stored_name,mime_type,byte_size,sha256,created_by,independent_upload_by,content_policy)
    VALUES(?,?,?,1,'Contrato.txt',?,'text/plain',?,?,?,?,?::jsonb)`)
    .run(randomUUID(), owner.workspace.officeId, documentId, storedName, content.length, sha, owner.person.userId,owner.person.userId,JSON.stringify({...personPolicy('',''),digest:sha}));
  const input: CreateShareInput = { kind: 'document', documentId, version: 1, clientMessageId: randomUUID(), idempotencyKey: randomUUID() };
  return { owner, recipient, thread, documentId, input, content };
}

test('a document grant loses source access when its issuer leaves the office', async () => {
  const f = await fixture();
  const created = createShareOutput.parse(await createShare(f.owner.person, f.owner.workspace, f.thread.id, f.input));
  assert.equal(created.kind, 'document');
  if (created.kind !== 'document') assert.fail('Expected a document share.');
  assert.deepEqual((await readDocumentShare(f.recipient.person, created.share.id)).buffer, f.content);
  await db.prepare('DELETE FROM office_member WHERE office_id=? AND user_id=?').run(f.owner.workspace.officeId, f.owner.person.userId);
  for (const viewer of [f.recipient.person.userId, f.owner.person.userId]) {
    const message = await getMessageForViewer(created.message.id, viewer);
    assert.equal(message.body.kind, 'document_share');
    if (message.body.kind !== 'document_share') assert.fail('Expected a shared document.');
    assert.equal(message.body.state, 'unavailable');
    assert.equal(message.body.canRevoke, false);
  }
  await assert.rejects(readDocumentShare(f.recipient.person, created.share.id), { code: 'NOT_FOUND' });
  await assert.rejects(readDocumentShare(f.owner.person, created.share.id), { code: 'NOT_FOUND' });
});

test('replaying a document share returns its revoked or unavailable state without granting access again', async () => {
  const f = await fixture();
  const created = createShareOutput.parse(await createShare(f.owner.person, f.owner.workspace, f.thread.id, f.input));
  assert.equal(created.kind, 'document');
  if (created.kind !== 'document') assert.fail('Expected a document share.');
  await revokeDocumentShare(f.owner.workspace, created.share.id);
  const revoked = createShareOutput.parse(await createShare(f.owner.person, f.owner.workspace, f.thread.id, f.input));
  assert.equal(revoked.kind, 'document');
  if (revoked.kind !== 'document') assert.fail('Expected a document share.');
  assert.equal(revoked.message.id, created.message.id);
  assert.equal(revoked.share.state, 'revoked');
  await assert.rejects(readDocumentShare(f.recipient.person, revoked.share.id), { code: 'NOT_FOUND' });
  await db.prepare('UPDATE vault_document SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(f.documentId);
  const unavailable = createShareOutput.parse(await createShare(f.owner.person, f.owner.workspace, f.thread.id, f.input));
  assert.equal(unavailable.kind, 'document');
  if (unavailable.kind !== 'document') assert.fail('Expected a document share.');
  assert.equal(unavailable.share.state, 'unavailable');
  const operations = await db.prepare('SELECT count(*) AS count FROM personal_share_operation WHERE author_user_id=? AND idempotency_key=?')
    .get<{ count: string }>(f.owner.person.userId, f.input.idempotencyKey);
  assert.equal(Number(operations?.count), 1);
});

test('legacy case invitation history follows current case access and closed invitation states', async () => {
  const f = await fixture(), caseId = randomUUID(), invitationId = randomUUID(), messageId = randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)')
    .run(caseId, f.owner.workspace.officeId, 'Caso legado', f.owner.person.userId);
  await db.prepare(`INSERT INTO collaboration_invitation(id,office_id,kind,case_id,email,recipient_user_id,invited_by,token_hash,status)
    VALUES(?,?,'case',?,?,?,?,?,'accepted')`).run(invitationId, f.owner.workspace.officeId, caseId,
      f.recipient.person.email, f.recipient.person.userId, f.owner.person.userId, randomUUID());
  await db.prepare(`INSERT INTO personal_message(id,thread_id,sequence,sender_user_id,client_message_id,input_hash,body_kind,body_json)
    VALUES(?,?,1,?,?,?,'case_invitation',?::jsonb)`).run(messageId, f.thread.id, f.owner.person.userId, randomUUID(), 'legacy',
      JSON.stringify({ kind: 'case_invitation', invitationId, caseName: 'Caso legado', state: 'accepted', actionPath: `/app/vault/cases/${caseId}` }));
  const association = await invite(f.owner.workspace, { email: f.recipient.person.email });
  await respond(f.recipient.workspace, association.id, true);
  await changeAccess(f.owner.workspace, { action: 'participant', caseId, userId: f.recipient.person.userId, add: true });
  for (const viewer of [f.recipient.person.userId, f.owner.person.userId]) {
    const accepted = await getMessageForViewer(messageId, viewer);
    if (accepted.body.kind !== 'case_invitation') assert.fail('Expected legacy case history.');
    assert.equal(accepted.body.state, 'accepted');
    assert.equal(accepted.body.actionPath, `/app/vault/cases/${caseId}`);
  }
  await changeAccess(f.owner.workspace, { action: 'participant', caseId, userId: f.recipient.person.userId, add: false });
  const removed = await getMessageForViewer(messageId, f.recipient.person.userId);
  if (removed.body.kind !== 'case_invitation') assert.fail('Expected legacy case history.');
  assert.equal(removed.body.actionPath, null);
  for (const status of ['declined', 'revoked']) {
    await db.prepare('UPDATE collaboration_invitation SET status=? WHERE id=?').run(status, invitationId);
    for (const viewer of [f.recipient.person.userId, f.owner.person.userId]) {
      const closed = await getMessageForViewer(messageId, viewer);
      if (closed.body.kind !== 'case_invitation') assert.fail('Expected legacy case history.');
      assert.equal(closed.body.state, status);
      assert.equal(closed.body.actionPath, null);
    }
  }
});

test('share metadata and bytes withhold a contradictory or missing exact version binding',async()=>{
  const f=await fixture();
  const created=createShareOutput.parse(await createShare(f.owner.person,f.owner.workspace,f.thread.id,f.input));
  assert.equal(created.kind,'document');if(created.kind!=='document')assert.fail('Expected document share');
  const before=await getMessageForViewer(created.message.id,f.recipient.person.userId);
  assert.equal(before.body.kind,'document_share');if(before.body.kind!=='document_share')assert.fail('Expected document share');
  assert.equal(before.body.state,'active');
  await db.prepare(`UPDATE vault_document_share SET file_binding=jsonb_set(file_binding,'{sha256}',to_jsonb(?::text)) WHERE id=?`).run('b'.repeat(64),created.share.id);
  for(const binding of ['contradictory','missing']) {
    if(binding==='missing')await db.prepare('UPDATE vault_document_share SET file_binding=NULL WHERE id=?').run(created.share.id);
    const hidden=await getMessageForViewer(created.message.id,f.recipient.person.userId);
    assert.equal(hidden.body.kind,'document_share');if(hidden.body.kind!=='document_share')assert.fail('Expected document share');
    assert.equal(hidden.body.state,'unavailable');assert.equal(hidden.body.name,'Documento indisponível');assert.equal(hidden.body.contentUrl,'');
    await assert.rejects(readDocumentShare(f.recipient.person,created.share.id));
  }
});
