import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { testDb as db } from './test-setup';
import type { WorkspaceContext } from '../src/lib/application/context';
import { createShareInput } from '../src/lib/personal-chat/domain';
import { ensureOfficeForUser } from '../src/lib/offices';
import type { PersonContext } from '../src/lib/personal-chat/auth';
import {
  claimAddress, getMessageForViewer, getThread, listMessages, listThreads, sendMessage, startThread,
} from '../src/lib/personal-chat/service';
import { createShare, readDocumentShare, revokeDocumentShare } from '../src/lib/personal-chat/shares';
import { decryptCredential, parseCredentialKeyring } from '../src/lib/platform-crypto';
import { objectStorage, storageKey } from '../src/lib/storage';

type TestPerson = { person: PersonContext; workspace: WorkspaceContext };

async function createSession(userId: string) {
  const id = randomUUID();
  await db.prepare(`INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt)
    VALUES(?,?,?,CURRENT_TIMESTAMP+INTERVAL '1 day',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    .run(id, userId, randomUUID());
  return id;
}

async function person(name: string, verified = false, email = `${randomUUID()}@messages.test`): Promise<TestPerson> {
  const id = randomUUID();
  await db.prepare('INSERT INTO "user"(id,name,email,"emailVerified") VALUES(?,?,?,?)').run(id, name, email, verified);
  const office = await ensureOfficeForUser(db, { id, officeName: `${name} Advocacia` });
  const sessionId = await createSession(id);
  return {
    person: { userId: id, email, name, sessionId },
    workspace: { userId: id, officeId: office.officeId, sessionId },
  };
}

async function replaceSession(subject: TestPerson) {
  const sessionId = await createSession(subject.person.userId);
  return {
    person: { ...subject.person, sessionId }, workspace: { ...subject.workspace, sessionId },
  } satisfies TestPerson;
}

async function documentFixture(owner: TestPerson, caseId: string | null = null, name = 'Contrato.pdf') {
  const documentId = randomUUID();
  const versionId = randomUUID();
  const currentKey = storageKey(owner.workspace.officeId, documentId, 'pdf');
  const versionKey = storageKey(owner.workspace.officeId, documentId, 'pdf');
  const bytes = Buffer.from('%PDF-1.7\nconteúdo imutável');
  await (await objectStorage()).put(versionKey, bytes);
  await db.prepare(`INSERT INTO vault_document(
      id,office_id,case_id,scope,original_name,stored_name,mime_type,byte_size,sha256,status,created_by
    ) VALUES(?,?,?,?,?,?,'application/pdf',?,?,'ready',?)`)
    .run(documentId, owner.workspace.officeId, caseId, caseId ? 'case' : 'library', name, currentKey,
      bytes.byteLength, 'a'.repeat(64), owner.person.userId);
  await db.prepare(`INSERT INTO vault_document_version(
      id,office_id,document_id,version,original_name,stored_name,mime_type,byte_size,sha256,created_by
    ) VALUES(?,?,?,1,?,?,'application/pdf',?,?,?)`)
    .run(versionId, owner.workspace.officeId, documentId, name, versionKey, bytes.byteLength,
      'a'.repeat(64), owner.person.userId);
  return { documentId, versionId, bytes };
}

async function invitationToken(threadId: string) {
  const row = await db.prepare('SELECT encrypted_token FROM personal_thread_invitation WHERE thread_id=?')
    .get<{ encrypted_token: string }>(threadId);
  assert.ok(row);
  return decryptCredential(row.encrypted_token, parseCredentialKeyring());
}

test('unverified exact address stays outbound and claim exposes only future messages', async () => {
  const sender = await person('Ana');
  const recipient = await person('Bia');
  const stranger = await person('Clara');
  const requestId = randomUUID();
  const [started, concurrent] = await Promise.all([
    startThread(sender.person, sender.workspace.officeId, {
      requestId, recipient: { kind: 'exact_email', email: recipient.person.email },
    }),
    startThread(sender.person, sender.workspace.officeId, {
      requestId: randomUUID(), recipient: { kind: 'exact_email', email: recipient.person.email },
    }),
  ]);
  assert.equal(concurrent.thread.id, started.thread.id);
  assert.equal(started.thread.channel, 'email_outbound');

  const clientMessageId = randomUUID();
  const first = await sendMessage(sender.person, started.thread.id, {
    clientMessageId, body: { kind: 'text', text: 'antes' },
  });
  const duplicate = await sendMessage(sender.person, started.thread.id, {
    clientMessageId, body: { kind: 'text', text: 'antes' },
  });
  assert.equal(duplicate.message.id, first.message.id);
  await assert.rejects(sendMessage(sender.person, started.thread.id, {
    clientMessageId, body: { kind: 'text', text: 'mudou' },
  }), { code: 'CONFLICT' });
  await assert.rejects(getThread(stranger.person, started.thread.id), { code: 'NOT_FOUND' });

  const token = await invitationToken(started.thread.id);
  const receipt = await claimAddress(recipient.person, token);
  assert.equal(receipt.threadId, started.thread.id);
  assert.equal(receipt.grantId, null);
  assert.equal((await claimAddress(recipient.person, token)).threadId, started.thread.id);
  const retried = await startThread(sender.person, sender.workspace.officeId, {
    requestId, recipient: { kind: 'exact_email', email: recipient.person.email },
  });
  assert.equal(retried.thread.id, started.thread.id);
  await assert.rejects(startThread(sender.person, sender.workspace.officeId, {
    requestId, recipient: { kind: 'exact_email', email: stranger.person.email },
  }), { code: 'CONFLICT' });
  assert.equal((await listMessages(recipient.person, started.thread.id, { limit: 50 })).messages.length, 0);
  await assert.rejects(getMessageForViewer(first.message.id, recipient.person.userId), { code: 'NOT_FOUND' });

  await sendMessage(sender.person, started.thread.id, {
    clientMessageId: randomUUID(), body: { kind: 'text', text: 'depois' },
  });
  const visible = await listMessages(recipient.person, started.thread.id, { limit: 50 });
  assert.equal(visible.messages.length, 1);
  assert.equal(visible.messages[0]?.body.kind, 'text');

  await db.prepare('DELETE FROM session WHERE id=?').run(sender.person.sessionId);
  await assert.rejects(sendMessage(sender.person, started.thread.id, {
    clientMessageId: randomUUID(), body: { kind: 'text', text: 'sessão revogada' },
  }), { code: 'UNAUTHENTICATED' });
});

test('verified address resolves to immutable user id rather than an email invitation', async () => {
  const sender = await person('Dora');
  const recipient = await person('Eva', true);
  const result = await startThread(sender.person, sender.workspace.officeId, {
    requestId: randomUUID(), recipient: { kind: 'exact_email', email: recipient.person.email },
  });
  assert.equal(result.thread.channel, 'in_app');
  assert.equal(result.thread.peer.kind === 'user' && result.thread.peer.userId, recipient.person.userId);
  assert.equal(await db.prepare('SELECT 1 FROM personal_thread_invitation WHERE thread_id=?').get(result.thread.id), undefined);
});

test('expired external invitation renews the same thread and preserves its history', async () => {
  const sender = await person('Fabi');
  const email = `${randomUUID()}@outside.test`;
  const first = await startThread(sender.person, sender.workspace.officeId, {
    requestId: randomUUID(), recipient: { kind: 'exact_email', email },
  });
  await sendMessage(sender.person, first.thread.id, {
    clientMessageId: randomUUID(), body: { kind: 'text', text: 'histórico preservado' },
  });
  const old = await db.prepare('SELECT token_hash FROM personal_thread_invitation WHERE thread_id=?')
    .get<{ token_hash: string }>(first.thread.id);
  await db.prepare("UPDATE personal_thread_invitation SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE thread_id=?")
    .run(first.thread.id);

  const renewed = await startThread(sender.person, sender.workspace.officeId, {
    requestId: randomUUID(), recipient: { kind: 'exact_email', email },
  });
  assert.equal(renewed.thread.id, first.thread.id);
  const current = await db.prepare('SELECT token_hash,state FROM personal_thread_invitation WHERE thread_id=?')
    .get<{ token_hash: string; state: string }>(first.thread.id);
  assert.equal(current?.state, 'pending');
  assert.notEqual(current?.token_hash, old?.token_hash);
  assert.equal((await listMessages(sender.person, first.thread.id, { limit: 50 })).messages.length, 1);
  assert.ok((await listThreads(sender.person, { limit: 50 })).threads.some(item => item.id === first.thread.id));
  assert.equal((await db.prepare('SELECT state FROM personal_email_outbox WHERE thread_id=?')
    .get<{ state: string }>(first.thread.id))?.state, 'cancelled');
});

test('an address proof stops resolving after the account changes its current email', async () => {
  const verifier = await person('Gabi');
  const recipient = await person('Hugo');
  const originalEmail = recipient.person.email;
  const external = await startThread(verifier.person, verifier.workspace.officeId, {
    requestId: randomUUID(), recipient: { kind: 'exact_email', email: originalEmail },
  });
  await claimAddress(recipient.person, await invitationToken(external.thread.id));
  await db.prepare('UPDATE "user" SET email=? WHERE id=?').run(`${randomUUID()}@changed.test`, recipient.person.userId);

  const otherSender = await person('Iara');
  const result = await startThread(otherSender.person, otherSender.workspace.officeId, {
    requestId: randomUUID(), recipient: { kind: 'exact_email', email: originalEmail },
  });
  assert.equal(result.thread.channel, 'email_outbound');
});

test('document grant returns exact bytes and enforces session, identity, revocation and source case', async () => {
  const sender = await person('Joana');
  let recipient = await person('Kai', true);
  const stranger = await person('Lia');
  const thread = (await startThread(sender.person, sender.workspace.officeId, {
    requestId: randomUUID(), recipient: { kind: 'exact_email', email: recipient.person.email },
  })).thread;
  const firstDocument = await documentFixture(sender);
  const firstShare = await createShare(sender.person, sender.workspace, thread.id, {
    kind: 'document', documentId: firstDocument.documentId, version: 1,
    clientMessageId: randomUUID(), idempotencyKey: randomUUID(),
  });
  assert.equal(firstShare.kind, 'document');
  if (firstShare.kind !== 'document') return;
  assert.deepEqual((await readDocumentShare(recipient.person, firstShare.share.id)).buffer, firstDocument.bytes);
  await assert.rejects(readDocumentShare(stranger.person, firstShare.share.id), { code: 'NOT_FOUND' });

  await db.prepare('DELETE FROM session WHERE id=?').run(recipient.person.sessionId);
  await assert.rejects(readDocumentShare(recipient.person, firstShare.share.id), { code: 'UNAUTHENTICATED' });
  recipient = await replaceSession(recipient);
  assert.deepEqual((await readDocumentShare(recipient.person, firstShare.share.id)).buffer, firstDocument.bytes);
  await revokeDocumentShare(sender.workspace, firstShare.share.id);
  await assert.rejects(readDocumentShare(recipient.person, firstShare.share.id), { code: 'NOT_FOUND' });

  const caseId = randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)')
    .run(caseId, sender.workspace.officeId, 'Caso fonte', sender.person.userId);
  const caseDocument = await documentFixture(sender, caseId, 'Petição.pdf');
  const caseShare = await createShare(sender.person, sender.workspace, thread.id, {
    kind: 'document', documentId: caseDocument.documentId, version: 1,
    clientMessageId: randomUUID(), idempotencyKey: randomUUID(),
  });
  assert.equal(caseShare.kind, 'document');
  if (caseShare.kind !== 'document') return;
  assert.deepEqual((await readDocumentShare(recipient.person, caseShare.share.id)).buffer, caseDocument.bytes);
  await db.prepare('UPDATE vault_case SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(caseId);
  await assert.rejects(readDocumentShare(recipient.person, caseShare.share.id), { code: 'NOT_FOUND' });
  await assert.rejects(createShare(sender.person, sender.workspace, thread.id, {
    kind: 'document', documentId: caseDocument.documentId, version: 1,
    clientMessageId: randomUUID(), idempotencyKey: randomUUID(),
  }), { code: 'NOT_FOUND' });

  await db.prepare('DELETE FROM session WHERE id=?').run(sender.person.sessionId);
  await assert.rejects(revokeDocumentShare(sender.workspace, caseShare.share.id), { code: 'UNAUTHENTICATED' });
});

test('document claim is specific and does not cancel an already dispatched lease', async () => {
  const sender = await person('Mara');
  const externalEmail = `${randomUUID()}@outside.test`;
  const thread = (await startThread(sender.person, sender.workspace.officeId, {
    requestId: randomUUID(), recipient: { kind: 'exact_email', email: externalEmail },
  })).thread;
  const document = await documentFixture(sender);
  const clientMessageId = randomUUID();
  const idempotencyKey = randomUUID();
  const [output, repeated] = await Promise.all([
    createShare(sender.person, sender.workspace, thread.id, {
      kind: 'document', documentId: document.documentId, version: 1, clientMessageId, idempotencyKey,
    }),
    createShare(sender.person, sender.workspace, thread.id, {
      kind: 'document', documentId: document.documentId, version: 1, clientMessageId, idempotencyKey,
    }),
  ]);
  assert.equal(output.kind, 'document');
  assert.equal(repeated.kind, 'document');
  if (output.kind !== 'document' || repeated.kind !== 'document') return;
  assert.deepEqual(repeated.share, output.share);
  assert.deepEqual((await readDocumentShare(sender.person, output.share.id)).buffer, document.bytes);

  const other = await createShare(sender.person, sender.workspace, thread.id, {
    kind: 'document', documentId: document.documentId, version: 1,
    clientMessageId: randomUUID(), idempotencyKey: randomUUID(),
  });
  assert.equal(other.kind, 'document');
  if (other.kind !== 'document') return;
  const share = await db.prepare('SELECT encrypted_token FROM vault_document_share WHERE id=?')
    .get<{ encrypted_token: string }>(output.share.id);
  assert.ok(share);
  await db.prepare(`UPDATE personal_email_outbox SET state='leased',lease_token=?,lease_until=CURRENT_TIMESTAMP+INTERVAL '1 minute',
    dispatched_at=CURRENT_TIMESTAMP WHERE message_id=?`).run(randomUUID(), output.message.id);

  const recipient = await person('Nina', false, externalEmail);
  const token = decryptCredential(share.encrypted_token, parseCredentialKeyring());
  const receipt = await claimAddress(recipient.person, token);
  assert.equal(receipt.grantId, output.share.id);
  assert.deepEqual((await readDocumentShare(recipient.person, output.share.id)).buffer, document.bytes);
  assert.equal((await db.prepare('SELECT state FROM personal_email_outbox WHERE message_id=?')
    .get<{ state: string }>(output.message.id))?.state, 'leased');
  assert.equal((await db.prepare('SELECT state FROM vault_document_share WHERE id=?')
    .get<{ state: string }>(other.share.id))?.state, 'pending');
});

test('Mensagens only accepts document shares; case participation belongs to Associates', () => {
  assert.equal(createShareInput.safeParse({
    kind: 'case', caseId: randomUUID(), permission: 'viewer', canInvite: false,
    clientMessageId: randomUUID(), idempotencyKey: randomUUID(),
  }).success, false);
});
