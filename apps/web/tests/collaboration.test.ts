import { testDb as db } from './test-setup';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { invite, respond, changeAccess, collaborationOverview, invitationForToken } from '../src/lib/collaboration/service';
import { caseAccess, contextForCase } from '../src/lib/collaboration/access';
import { runCapability } from '../src/lib/agent-tools';
import { assertCapabilityAllowed, type WorkspaceContext } from '../src/lib/application/context';
import { createApprovalProposal, approveProposal } from '../src/lib/application/approvals-service';
import { selectedOfficeForUser, ensureOfficeForUser, listOfficesForUser } from '../src/lib/offices';
import { getKnowledgeSource } from '../src/lib/application/knowledge-service';

async function fixture() {
  async function user(name: string) {
    const id = randomUUID(); const email = `${id}@collaboration.test`;
    await db.prepare('INSERT INTO "user"(id,name,email) VALUES(?,?,?)').run(id, name, email);
    const office = await ensureOfficeForUser(db, { id, officeName: `${name} Advocacia` });
    return { id, email, context: { userId: id, officeId: office.officeId, role: 'administrator' } satisfies WorkspaceContext };
  }
  const owner = await user('Ana'); const guest = await user('Bia'); const stranger = await user('Clara');
  async function createCase(name: string) {
    const id = randomUUID();
    await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(id, owner.context.officeId, name, owner.id);
    return id;
  }
  const shared = await createCase('Caso compartilhado'); const privateCase = await createCase('Caso sigiloso');
  async function document(caseId: string | null, name: string) {
    const id = randomUUID();
    await db.prepare(`INSERT INTO vault_document(id,office_id,case_id,scope,original_name,stored_name,mime_type,byte_size,sha256,status,created_by)
      VALUES(?,?,?,?,?,?,'text/plain',12,?,'ready',?)`).run(id, owner.context.officeId, caseId, caseId ? 'case' : 'library', name, `${id}.txt`, 'a'.repeat(64), owner.id);
    await db.prepare('INSERT INTO vault_document_chunk(id,document_id,office_id,ordinal,stable_reference,content) VALUES(?,?,?,0,?,?)')
      .run(randomUUID(), id, owner.context.officeId, 'página:1', `Contrato de colaboração ${name}`);
    return id;
  }
  const sharedDoc = await document(shared, 'Documento autorizado'); const privateDoc = await document(privateCase, 'Segredo de outro caso'); const library = await document(null, 'Biblioteca privada');
  async function grant(role: 'viewer' | 'editor' = 'viewer', canInvite = false) {
    const invitation = await invite(owner.context, { kind: 'case', caseId: shared, email: guest.email, role, canInvite });
    await respond(guest.context, invitation.id, true);
    return invitation;
  }
  return { owner, guest, stranger, shared, privateCase, sharedDoc, privateDoc, library, grant };
}

test('case invitation isolates cases, files, sources, library and writes; revocation takes effect on the next operation', async () => {
  const f = await fixture();
  await assert.rejects(caseAccess(f.guest.id, f.shared));
  const invitation = await f.grant();
  await assert.rejects(respond(f.guest.context, invitation.id, true));
  const cases = await runCapability(f.guest.context, 'k5_vault_list_cases', {}) as { cases: { id: string }[] };
  assert.deepEqual(cases.cases.map(c => c.id), [f.shared]);
  const docs = await runCapability(f.guest.context, 'k5_vault_list_documents', { caseId: f.shared }) as { documents: { id: string }[] };
  assert.deepEqual(docs.documents.map(d => d.id), [f.sharedDoc]);
  const source = await runCapability(f.guest.context, 'k5_knowledge_get_source', { documentId: f.sharedDoc, stableReference: 'página:1' }) as { source: { text: string } };
  assert.match(source.source.text, /Documento autorizado/);
  const search = await runCapability(f.guest.context, 'k5_knowledge_search', { query: 'Contrato', caseId: f.shared }) as { sources: { documentId: string }[] };
  assert.ok(search.sources.length); assert.ok(search.sources.every(s => s.documentId === f.sharedDoc));
  for (const id of [f.privateDoc, f.library]) await assert.rejects(runCapability(f.guest.context, 'k5_vault_get_document', { documentId: id }));
  await assert.rejects(runCapability(f.guest.context, 'k5_knowledge_search', { query: 'Contrato', documentIds: [f.sharedDoc, f.privateDoc] }));
  await assert.rejects(runCapability(f.guest.context, 'k5_vault_create_folder', { caseId: f.shared, name: 'Pasta recusada' }));
  await assert.rejects(runCapability(f.guest.context, 'k5_vault_update_document', { documentId: f.sharedDoc, name: 'Recusado' }));
  await assert.rejects(invite(f.guest.context, { kind: 'case', caseId: f.shared, email: f.stranger.email, role: 'viewer' }));
  const stale = await contextForCase(f.guest.context, f.shared);
  await changeAccess(f.owner.context, { action: 'participant', caseId: f.shared, userId: f.guest.id, role: null, canInvite: false });
  await assert.rejects(assertCapabilityAllowed(stale, 'k5_knowledge_search'));
  await assert.rejects(runCapability(f.guest.context, 'k5_vault_download_document', { documentId: f.sharedDoc }));
  await assert.rejects(runCapability(f.guest.context, 'k5_knowledge_search', { query: 'Contrato', caseId: f.shared }));
});

test('collaborator can organize and remove case files with confirmation, but cannot move files out or acquire office privileges', async () => {
  const f = await fixture(); await f.grant('editor');
  await runCapability(f.guest.context, 'k5_vault_create_folder', { caseId: f.shared, name: 'Petições' });
  await runCapability(f.guest.context, 'k5_vault_update_document', { documentId: f.sharedDoc, name: 'Contrato revisado' });
  await assert.rejects(runCapability(f.guest.context, 'k5_vault_update_document', { documentId: f.sharedDoc, caseId: null }));
  await assert.rejects(runCapability(f.guest.context, 'k5_vault_update_document', { documentId: f.sharedDoc, caseId: f.privateCase }));
  await assert.rejects(runCapability(f.guest.context, 'k5_vault_delete_case', { caseId: f.shared }));
  const scoped = await contextForCase(f.guest.context, f.shared);
  await assert.rejects(assertCapabilityAllowed(scoped, 'k5_crm_list_clients'));
  const approval = await createApprovalProposal(f.guest.context, 'k5_vault_delete_document', { documentId: f.sharedDoc });
  await approveProposal(f.guest.context, approval.id);
  await runCapability(f.guest.context, 'k5_vault_delete_document', { documentId: f.sharedDoc, approvalId: approval.id });
  assert.ok((await db.prepare('SELECT deleted_at FROM vault_document WHERE id=?').get(f.sharedDoc))?.deleted_at);
});

test('association requires acceptance, grants no content and removal preserves independent case participation', async () => {
  const f = await fixture();
  const invitation = await invite(f.owner.context, { kind: 'associate', email: f.guest.email });
  assert.equal((await collaborationOverview(f.owner.context)).associates.length, 0);
  await assert.rejects(respond(f.stranger.context, invitation.id, true));
  await respond(f.guest.context, invitation.id, true);
  assert.equal((await collaborationOverview(f.owner.context)).associates.length, 1);
  await assert.rejects(caseAccess(f.guest.id, f.shared));
  await f.grant();
  await changeAccess(f.owner.context, { action: 'associate', userId: f.guest.id });
  assert.ok(await caseAccess(f.guest.id, f.shared));
});

test('team invitations preserve both offices, cannot be accepted twice concurrently, and protect the last administrator', async () => {
  const f = await fixture();
  const invitation = await invite(f.owner.context, { kind: 'team', email: f.guest.email, role: 'lawyer' });
  const results = await Promise.allSettled([respond(f.guest.context, invitation.id, true), respond(f.guest.context, invitation.id, true)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await listOfficesForUser(db, f.guest.id)).length, 2);
  assert.equal((await selectedOfficeForUser(db, { id: f.guest.id, officeName: 'Ignorado' }, f.owner.context.officeId)).officeId, f.owner.context.officeId);
  assert.equal((await selectedOfficeForUser(db, { id: f.stranger.id, officeName: 'Ignorado' }, f.owner.context.officeId)).officeId, f.stranger.context.officeId);
  assert.equal((await caseAccess(f.guest.id, f.privateCase)).external, false);
  await assert.rejects(changeAccess(f.owner.context, { action: 'member', userId: f.owner.id, role: null }));
  await changeAccess(f.owner.context, { action: 'member', userId: f.guest.id, role: null });
  await assert.rejects(caseAccess(f.guest.id, f.privateCase));
  assert.equal((await listOfficesForUser(db, f.guest.id)).length, 1);
});

test('unknown address needs the secret link, and expired/cancelled invitations cannot grant access', async () => {
  const f = await fixture(); const email = `${randomUUID()}@new-user.test`;
  const invitation = await invite(f.owner.context, { kind: 'team', email, role: 'reviewer' });
  assert.equal(invitation.deliveredInApp, false);
  const id = randomUUID(); await db.prepare('INSERT INTO "user"(id,email,name) VALUES(?,?,?)').run(id, email, 'Nova pessoa');
  const office = await ensureOfficeForUser(db, { id, officeName: 'Escritório pessoal' });
  const context: WorkspaceContext = { userId: id, officeId: office.officeId, role: 'administrator' };
  await assert.rejects(respond(context, invitation.id, true));
  const token = invitation.path.split('/').at(-1)!;
  assert.ok(await invitationForToken(id, token));
  await assert.rejects(invitationForToken(f.stranger.id, token));
  await respond(context, invitation.id, true, token);
  const expiring = await invite(f.owner.context, { kind: 'case', caseId: f.shared, email: f.guest.email, role: 'viewer' });
  await db.prepare("UPDATE collaboration_invitation SET expires_at=CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id=?").run(expiring.id);
  await assert.rejects(respond(f.guest.context, expiring.id, true));
  const cancelled = await invite(f.owner.context, { kind: 'case', caseId: f.shared, email: f.guest.email, role: 'viewer' });
  await changeAccess(f.owner.context, { action: 'cancel', id: cancelled.id });
  await assert.rejects(respond(f.guest.context, cancelled.id, true));
});

test('delegated invite permission is separate from writing, cannot be escalated and is rechecked at acceptance', async () => {
  const f = await fixture(); await f.grant('viewer', true);
  await assert.rejects(invite(f.guest.context, { kind: 'case', caseId: f.shared, email: f.stranger.email, role: 'editor' }));
  await assert.rejects(invite(f.guest.context, { kind: 'case', caseId: f.shared, email: f.stranger.email, role: 'viewer', canInvite: true }));
  const invitation = await invite(f.guest.context, { kind: 'case', caseId: f.shared, email: f.stranger.email, role: 'viewer' });
  await changeAccess(f.owner.context, { action: 'participant', caseId: f.shared, userId: f.guest.id, role: 'viewer', canInvite: false });
  await assert.rejects(respond(f.stranger.context, invitation.id, true));
});

test('parallel provisioning still creates one office after multi-office memberships are enabled', async () => {
  const id = randomUUID(); await db.prepare('INSERT INTO "user"(id,name,email) VALUES(?,?,?)').run(id, 'Pessoa', `${id}@test.test`);
  const offices = await Promise.all(Array.from({ length: 4 }, () => ensureOfficeForUser(db, { id, officeName: 'Único escritório' })));
  assert.equal(new Set(offices.map(o => o.officeId)).size, 1);
});

test('a shared case name does not prevent creating a separate case in the personal office', async () => {
  const f = await fixture(); await f.grant();
  const result = await runCapability(f.guest.context, 'k5_vault_create_case', { name: 'Caso compartilhado' }) as { created: boolean; case: { id: string } };
  assert.equal(result.created, true);
  assert.notEqual(result.case.id, f.shared);
  assert.equal((await db.prepare('SELECT office_id FROM vault_case WHERE id=?').get(result.case.id))?.office_id, f.guest.context.officeId);
});

test('a reviewer in their active office can edit an explicitly shared case, and moving a source revokes its case access', async () => {
  const f = await fixture(); await f.grant('editor');
  await db.prepare("UPDATE office_member SET role='reviewer' WHERE user_id=?").run(f.guest.id);
  const reviewer = { ...f.guest.context, role: 'reviewer' as const };
  await runCapability(reviewer, 'k5_vault_update_document', { documentId: f.sharedDoc, name: 'Edição autorizada no caso externo' });
  await assert.rejects(runCapability(reviewer, 'k5_vault_create_case', { name: 'Escritório somente leitura' }), { code: 'FORBIDDEN' });
  const staleScope = await contextForCase(reviewer, f.shared);
  await runCapability(f.owner.context, 'k5_vault_update_document', { documentId: f.sharedDoc, caseId: f.privateCase });
  await assert.rejects(getKnowledgeSource(staleScope, { documentId: f.sharedDoc, stableReference: 'página:1' }), { code: 'NOT_FOUND' });
  await assert.rejects(runCapability(reviewer, 'k5_vault_download_document', { documentId: f.sharedDoc }));
});
