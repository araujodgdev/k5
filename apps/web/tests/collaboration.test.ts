import { fixtureSession } from './session-fixture';
import { testDb as db, testDatabase } from './test-setup';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { invite, respond, changeAccess, collaborationOverview, invitationForToken } from '../src/lib/collaboration/service';
import { caseAccess, contextForCase, documentAccess } from '../src/lib/collaboration/access';
import { runCapability } from '../src/lib/agent-tools';
import { assertCapabilityAllowed, type WorkspaceContext } from '../src/lib/application/context';
import { createApprovalProposal, approveProposal } from '../src/lib/application/approvals-service';
import { ensureOfficeForUser, findOfficeForUser } from '../src/lib/offices';
import { getKnowledgeSource } from '../src/lib/application/knowledge-service';
import { enqueueVerification, processNextVerification, getVerification } from '../src/lib/typesafe/verification';
import { saveConnection, connectionView } from '../src/lib/typesafe/config';
import { connectionSettings } from '../src/lib/typesafe/contracts';
import { ownedArtifact } from '../src/lib/ai-store';
import { authorizedCanvasResource } from '../src/lib/canvas-resources';
import { openResource } from '../src/lib/application/ui-service';
import { resourceHref } from '../src/lib/application/agent-approvals';

type Folder = { id: string; visibility: string; owned: boolean; memberIds: string[] };

async function fixture() {
  async function user(name: string) {
    const id = randomUUID(); const email = `${id}@collaboration.test`;
    await db.prepare('INSERT INTO "user"(id,name,email) VALUES(?,?,?)').run(id, name, email);
    const office = await ensureOfficeForUser(db, { id, officeName: `${name} Advocacia` });
    return { id, email, context: { userId: id, officeId: office.officeId, sessionId: await fixtureSession(id) } satisfies WorkspaceContext };
  }
  const owner = await user('Ana'); const guest = await user('Bia'); const stranger = await user('Clara');
  async function createCase(name: string) {
    const id = randomUUID();
    await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(id, owner.context.officeId, name, owner.id);
    return id;
  }
  const shared = await createCase('Caso compartilhado'); const privateCase = await createCase('Caso sigiloso');
  async function document(caseId: string | null, name: string, folderId: string | null = null, createdBy = owner.id) {
    const id = randomUUID();
    await db.prepare(`INSERT INTO vault_document(id,office_id,case_id,folder_id,scope,original_name,stored_name,mime_type,byte_size,sha256,status,created_by)
      VALUES(?,?,?,?,?,?,?,'text/plain',12,?,'ready',?)`).run(id, owner.context.officeId, caseId, folderId, caseId ? 'case' : 'library', name, `${id}.txt`, 'a'.repeat(64), createdBy);
    await db.prepare('INSERT INTO vault_document_chunk(id,document_id,office_id,ordinal,stable_reference,content) VALUES(?,?,?,0,?,?)')
      .run(randomUUID(), id, owner.context.officeId, 'página:1', `Contrato de colaboração ${name}`);
    await db.prepare('INSERT INTO vault_document_version(id,office_id,document_id,version,original_name,stored_name,mime_type,byte_size,sha256,created_by,is_active) SELECT ?,office_id,id,1,original_name,stored_name,mime_type,byte_size,sha256,created_by,1 FROM vault_document WHERE id=?').run(randomUUID(),id);
    await db.prepare('UPDATE vault_document SET extracted_version=1,extracted_sha256=sha256 WHERE id=?').run(id);
    return id;
  }
  const sharedDoc = await document(shared, 'Documento autorizado'); const privateDoc = await document(privateCase, 'Segredo de outro caso'); const library = await document(null, 'Biblioteca privada');
  async function associate(a: typeof owner, b: typeof owner) {
    const invitation = await invite(a.context, { email: b.email });
    await respond(b.context, invitation.id, true);
  }
  async function grant(person = guest) {
    await associate(owner, person);
    await changeAccess(owner.context, { action: 'participant', caseId: shared, userId: person.id, add: true });
  }
  return { owner, guest, stranger, shared, privateCase, sharedDoc, privateDoc, library, document, associate, grant };
}

test('whole-office knowledge search includes a matching document older than the newest 400', async () => {
  const f = await fixture();
  const oldest = await f.document(null, 'Sentinelacofre');
  await db.prepare("UPDATE vault_document SET updated_at='2020-01-01T00:00:00Z' WHERE id=?").run(oldest);
  for (let i = 0; i < 400; i++) await f.document(null, `Recente ${i}`);
  const result = await runCapability(f.owner.context, 'k5_knowledge_search', { query: 'Sentinelacofre' }) as { sources: { documentId: string }[] };
  assert.ok(result.sources.some(source => source.documentId === oldest));

  const crowded = await f.document(null, 'Outro');
  await db.prepare("UPDATE vault_document SET updated_at='2020-01-01T00:00:00Z' WHERE id=?").run(crowded);
  for (let i = 1; i <= 100; i++) await db.prepare('INSERT INTO vault_document_chunk(id,document_id,office_id,ordinal,stable_reference,content) VALUES(?,?,?,?,?,?)')
    .run(randomUUID(), crowded, f.owner.context.officeId, i, `página:${i + 1}`, 'Sentinelacofre '.repeat(20));
  await db.prepare('DELETE FROM knowledge_retrieval_audit WHERE user_id=?').run(f.owner.id);
  await runCapability(f.owner.context, 'k5_knowledge_search', { query: 'Sentinelacofre' });
  const audit = await db.prepare('SELECT document_count FROM knowledge_retrieval_audit WHERE user_id=?').get<{ document_count: number }>(f.owner.id);
  assert.equal(Number(audit?.document_count), 402, 'a document with 100 better chunks does not push another older match out of the searched scope');
});

test('each lawyer owns exactly one office and an office has exactly one lawyer', async () => {
  const f = await fixture();
  assert.equal((await findOfficeForUser(db, f.owner.id))?.officeId, f.owner.context.officeId);
  await assert.rejects(db.prepare('INSERT INTO office_member(id,office_id,user_id) VALUES(?,?,?)').run(randomUUID(), f.owner.context.officeId, f.stranger.id));
  const id = randomUUID(); await db.prepare('INSERT INTO "user"(id,name,email) VALUES(?,?,?)').run(id, 'Pessoa', `${id}@test.test`);
  const offices = await Promise.all(Array.from({ length: 4 }, () => ensureOfficeForUser(db, { id, officeName: 'Único escritório' })));
  assert.equal(new Set(offices.map(o => o.officeId)).size, 1);
});

test('canvas resource titles and tool links reauthorize cases and private folders after access changes', async () => {
  const f = await fixture(); await f.grant();
  const opened = await openResource(f.guest.context, { resourceType: 'case', resourceId: f.shared });
  assert.deepEqual(opened, { path: `/app/vault/cases/${f.shared}`, title: 'Caso compartilhado' });
  assert.equal(resourceHref('k5_ui_open_resource', opened), opened.path);
  assert.equal(resourceHref('k5_ui_open_resource', { path: 'https://example.com/app/vault' }), undefined);
  assert.deepEqual(await openResource(f.guest.context, { resourceType: 'document', resourceId: f.sharedDoc }), { path: `/app/vault/files/${f.sharedDoc}`, title: 'Documento autorizado' });
  assert.equal((await authorizedCanvasResource(f.guest.context, `/app/vault/files/${f.sharedDoc}`)).title, 'Documento autorizado');
  const { folder } = await runCapability(f.guest.context, 'k5_vault_create_folder', { caseId: f.shared, name: 'Só minha', visibility: 'private' }) as { folder: Folder };
  const privateFile = await f.document(f.shared, 'Nome sigiloso', folder.id, f.guest.id);
  await assert.rejects(authorizedCanvasResource(f.owner.context, `/app/vault/cases/${f.shared}?folder=${folder.id}`));
  await assert.rejects(openResource(f.owner.context, { resourceType: 'document', resourceId: privateFile }));
  await changeAccess(f.owner.context, { action: 'participant', caseId: f.shared, userId: f.guest.id, add: false });
  await assert.rejects(authorizedCanvasResource(f.guest.context, `/app/vault/cases/${f.shared}`));
  await assert.rejects(openResource(f.guest.context, { resourceType: 'document', resourceId: f.sharedDoc }));
});

test('canvas keeps artifacts private and rejects stale office membership and non-canvas URLs', async () => {
  const f = await fixture(); await f.grant();
  const artifactId = randomUUID();
  await db.prepare("INSERT INTO ai_artifact(id,office_id,user_id,title,content,kind) VALUES(?,?,?,'Minuta privada','Rascunho','document')").run(artifactId, f.owner.context.officeId, f.owner.id);
  assert.deepEqual(await openResource(f.owner.context, { resourceType: 'artifact', resourceId: artifactId }), { path: `/app/documents/${artifactId}`, title: 'Minuta privada' });
  await assert.rejects(openResource(f.guest.context, { resourceType: 'artifact', resourceId: artifactId }));
  await assert.rejects(authorizedCanvasResource(f.owner.context, 'https://example.com/app/vault'), { code: 'INVALID' });
  await db.prepare('DELETE FROM office_member WHERE user_id=?').run(f.owner.id);
  await assert.rejects(openResource(f.owner.context, { resourceType: 'artifact', resourceId: artifactId }), { code: 'FORBIDDEN' });
});

test('association is mutual, needs acceptance and grants no content by itself', async () => {
  const f = await fixture();
  const invitation = await invite(f.owner.context, { email: f.guest.email });
  assert.equal((await collaborationOverview(f.owner.context)).associates.length, 0);
  await assert.rejects(invite(f.guest.context, { email: f.owner.email }), { code: 'CONFLICT' });
  await assert.rejects(respond(f.stranger.context, invitation.id, true));
  await respond(f.guest.context, invitation.id, true);
  assert.deepEqual((await collaborationOverview(f.owner.context)).associates.map(p => p.id), [f.guest.id]);
  assert.deepEqual((await collaborationOverview(f.guest.context)).associates.map(p => p.id), [f.owner.id]);
  await assert.rejects(invite(f.owner.context, { email: f.guest.email }), { code: 'CONFLICT' });
  await assert.rejects(caseAccess(f.guest.id, f.shared));
  await assert.rejects(invite(f.owner.context, { email: f.owner.email }), { code: 'INVALID' });
});

test('only the case owner includes participants, and only among their associates', async () => {
  const f = await fixture();
  await assert.rejects(changeAccess(f.owner.context, { action: 'participant', caseId: f.shared, userId: f.guest.id, add: true }), { code: 'FORBIDDEN' });
  await f.grant();
  await f.associate(f.guest, f.stranger);

  await assert.rejects(changeAccess(f.guest.context, { action: 'participant', caseId: f.shared, userId: f.stranger.id, add: true }), { code: 'FORBIDDEN' });
  await assert.rejects(changeAccess(f.owner.context, { action: 'participant', caseId: f.shared, userId: f.guest.id, add: true }), { code: 'CONFLICT' });
  const overview = await collaborationOverview(f.guest.context, f.shared);
  assert.equal(overview.isOwner, false); assert.equal(overview.owner?.id, f.owner.id);
  assert.deepEqual(overview.participants.map(p => p.id), [f.guest.id]);
  assert.equal(overview.history.length, 0);
});

test('a participant shares the case files and sources, but not other cases, the library or office operations', async () => {
  const f = await fixture(); await f.grant();
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

test('removing a participant or ending the association takes effect on the next operation', async () => {
  const f = await fixture(); await f.grant();
  const stale = await contextForCase(f.guest.context, f.shared);
  await changeAccess(f.owner.context, { action: 'participant', caseId: f.shared, userId: f.guest.id, add: false });
  await assert.rejects(assertCapabilityAllowed(stale, 'k5_knowledge_search'));
  await assert.rejects(runCapability(f.guest.context, 'k5_vault_download_document', { documentId: f.sharedDoc }));

  await changeAccess(f.owner.context, { action: 'participant', caseId: f.shared, userId: f.guest.id, add: true });

  await changeAccess(f.guest.context, { action: 'participant', caseId: f.shared, userId: f.guest.id, add: false });
  await assert.rejects(caseAccess(f.guest.id, f.shared));
  await changeAccess(f.owner.context, { action: 'participant', caseId: f.shared, userId: f.guest.id, add: true });
  const theirCase = randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(theirCase, f.guest.context.officeId, 'Caso da Bia', f.guest.id);
  await changeAccess(f.guest.context, { action: 'participant', caseId: theirCase, userId: f.owner.id, add: true });
  await changeAccess(f.guest.context, { action: 'associate', userId: f.owner.id });
  await assert.rejects(caseAccess(f.guest.id, f.shared));
  await assert.rejects(caseAccess(f.owner.id, theirCase));
  assert.equal((await collaborationOverview(f.owner.context)).associates.length, 0);
});

test('a private folder is visible only to its creator, not even to the case owner', async () => {
  const f = await fixture(); await f.grant();
  const { folder } = await runCapability(f.guest.context, 'k5_vault_create_folder', { caseId: f.shared, name: 'Rascunhos', visibility: 'private' }) as { folder: Folder };
  assert.equal(folder.visibility, 'private'); assert.equal(folder.owned, true);
  const hidden = await f.document(f.shared, 'Estratégia reservada', folder.id, f.guest.id);
  const { folder: inner } = await runCapability(f.guest.context, 'k5_vault_create_folder', { caseId: f.shared, name: 'Aberta por dentro', parentId: folder.id }) as { folder: Folder };
  const nested = await f.document(f.shared, 'Anexo reservado', inner.id, f.guest.id);

  const guestDocs = await runCapability(f.guest.context, 'k5_vault_list_documents', { caseId: f.shared }) as { documents: { id: string }[] };
  assert.deepEqual(new Set(guestDocs.documents.map(d => d.id)), new Set([f.sharedDoc, hidden, nested]));

  const ownerFolders = await runCapability(f.owner.context, 'k5_vault_list_folders', { caseId: f.shared }) as { folders: Folder[] };
  assert.equal(ownerFolders.folders.length, 0);
  const ownerDocs = await runCapability(f.owner.context, 'k5_vault_list_documents', { caseId: f.shared }) as { documents: { id: string }[]; total: number };
  assert.deepEqual(ownerDocs.documents.map(d => d.id), [f.sharedDoc]); assert.equal(ownerDocs.total, 1);
  for (const id of [hidden, nested]) {
    await assert.rejects(runCapability(f.owner.context, 'k5_vault_get_document', { documentId: id }), { code: 'NOT_FOUND' });
    await assert.rejects(documentAccess(f.owner.context, id), { code: 'NOT_FOUND' });
  }

  await assert.rejects(runCapability(f.owner.context, 'k5_vault_list_folders', { caseId: f.shared, parentId: inner.id }), { code: 'NOT_FOUND' });
  const search = await runCapability(f.owner.context, 'k5_knowledge_search', { query: 'Contrato' }) as { sources: { documentId: string }[] };
  assert.ok(search.sources.every(s => s.documentId !== hidden && s.documentId !== nested));
  await assert.rejects(runCapability(f.owner.context, 'k5_knowledge_search', { query: 'Contrato', documentIds: [hidden] }));

  await assert.rejects(runCapability(f.owner.context, 'k5_vault_update_folder_access', { folderId: folder.id, visibility: 'public' }));
  await assert.rejects(runCapability(f.owner.context, 'k5_vault_create_folder', { caseId: f.shared, name: 'Intrusa', parentId: folder.id }));
  await assert.rejects(runCapability(f.owner.context, 'k5_vault_update_document', { documentId: f.sharedDoc, folderId: folder.id }));

  await runCapability(f.guest.context, 'k5_vault_update_folder_access', { folderId: folder.id, visibility: 'public' });
  const now = await runCapability(f.owner.context, 'k5_vault_list_documents', { caseId: f.shared }) as { documents: { id: string }[] };
  assert.deepEqual(new Set(now.documents.map(d => d.id)), new Set([f.sharedDoc, hidden, nested]));
});

test('a restricted folder admits only the people its creator chose among the case participants', async () => {
  const f = await fixture(); await f.grant(); await f.grant(f.stranger);
  await assert.rejects(runCapability(f.guest.context, 'k5_vault_create_folder', { caseId: f.shared, name: 'Sem ninguém', visibility: 'restricted', memberIds: [] }));
  const outsider = randomUUID(); await db.prepare('INSERT INTO "user"(id,name,email) VALUES(?,?,?)').run(outsider, 'Fora', `${outsider}@test.test`);
  await assert.rejects(runCapability(f.guest.context, 'k5_vault_create_folder', { caseId: f.shared, name: 'Com estranho', visibility: 'restricted', memberIds: [outsider] }));
  const { folder } = await runCapability(f.guest.context, 'k5_vault_create_folder', { caseId: f.shared, name: 'Só com a Ana', visibility: 'restricted', memberIds: [f.owner.id] }) as { folder: Folder };
  assert.deepEqual(folder.memberIds, [f.owner.id]);
  const inside = await f.document(f.shared, 'Parecer restrito', folder.id, f.guest.id);
  const ownerView = await runCapability(f.owner.context, 'k5_vault_list_folders', { caseId: f.shared }) as { folders: Folder[] };
  assert.deepEqual(ownerView.folders.map(item => [item.id, item.owned, item.memberIds]), [[folder.id, false, []]]);
  assert.ok(await runCapability(f.owner.context, 'k5_vault_get_document', { documentId: inside }));
  await assert.rejects(runCapability(f.stranger.context, 'k5_vault_get_document', { documentId: inside }), { code: 'NOT_FOUND' });
  const strangerView = await runCapability(f.stranger.context, 'k5_vault_list_folders', { caseId: f.shared }) as { folders: Folder[] };
  assert.equal(strangerView.folders.length, 0);

  await assert.rejects(runCapability(f.owner.context, 'k5_vault_update_folder_access', { folderId: folder.id, visibility: 'public' }), { code: 'FORBIDDEN' });
  await runCapability(f.guest.context, 'k5_vault_update_folder_access', { folderId: folder.id, visibility: 'restricted', memberIds: [f.stranger.id] });
  await assert.rejects(runCapability(f.owner.context, 'k5_vault_get_document', { documentId: inside }), { code: 'NOT_FOUND' });
  assert.ok(await runCapability(f.stranger.context, 'k5_vault_get_document', { documentId: inside }));
});

test('two participants may give their private folders the same name without learning about each other', async () => {
  const f = await fixture(); await f.grant(); await f.grant(f.stranger);
  await runCapability(f.guest.context, 'k5_vault_create_folder', { caseId: f.shared, name: 'Notas', visibility: 'private' });
  await runCapability(f.stranger.context, 'k5_vault_create_folder', { caseId: f.shared, name: 'Notas', visibility: 'private' });
  await assert.rejects(runCapability(f.stranger.context, 'k5_vault_create_folder', { caseId: f.shared, name: 'Notas', visibility: 'private' }), { code: 'CONFLICT' });
});

test('unknown address needs the secret link, and expired/cancelled invitations cannot grant access', async () => {
  const f = await fixture(); const email = `${randomUUID()}@new-user.test`;
  const invitation = await invite(f.owner.context, { email });
  assert.equal(invitation.deliveredInApp, false);
  const id = randomUUID(); await db.prepare('INSERT INTO "user"(id,email,name) VALUES(?,?,?)').run(id, email, 'Nova pessoa');
  const office = await ensureOfficeForUser(db, { id, officeName: 'Escritório pessoal' });
  const context: WorkspaceContext = { userId: id, officeId: office.officeId };
  await assert.rejects(respond(context, invitation.id, true));
  const token = invitation.path.split('/').at(-1)!;
  assert.ok(await invitationForToken(id, token));
  await assert.rejects(invitationForToken(f.stranger.id, token));
  await respond(context, invitation.id, true, token);
  assert.deepEqual((await collaborationOverview(context)).associates.map(p => p.id), [f.owner.id]);
  const expiring = await invite(f.owner.context, { email: f.guest.email });
  await db.prepare("UPDATE collaboration_invitation SET expires_at=CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id=?").run(expiring.id);
  await assert.rejects(respond(f.guest.context, expiring.id, true));
  const cancelled = await invite(f.owner.context, { email: f.guest.email });
  await assert.rejects(changeAccess(f.guest.context, { action: 'cancel', id: cancelled.id }));
  await changeAccess(f.owner.context, { action: 'cancel', id: cancelled.id });
  await assert.rejects(respond(f.guest.context, cancelled.id, true));
});

test('an invitation cannot be accepted twice concurrently', async () => {
  const f = await fixture();
  const invitation = await invite(f.owner.context, { email: f.guest.email });
  const results = await Promise.allSettled([respond(f.guest.context, invitation.id, true), respond(f.guest.context, invitation.id, true)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await collaborationOverview(f.owner.context)).associates.length, 1);
});

test('a shared case name does not prevent creating a separate case in the personal office', async () => {
  const f = await fixture(); await f.grant();
  const result = await runCapability(f.guest.context, 'k5_vault_create_case', { name: 'Caso compartilhado' }) as { created: boolean; case: { id: string } };
  assert.equal(result.created, true);
  assert.notEqual(result.case.id, f.shared);
  assert.equal((await db.prepare('SELECT office_id FROM vault_case WHERE id=?').get(result.case.id))?.office_id, f.guest.context.officeId);
});

test('moving a source to another case revokes the participant access to it', async () => {
  const f = await fixture(); await f.grant();
  const staleScope = await contextForCase(f.guest.context, f.shared);
  await runCapability(f.owner.context, 'k5_vault_update_document', { documentId: f.sharedDoc, caseId: f.privateCase });
  await assert.rejects(getKnowledgeSource(staleScope, { documentId: f.sharedDoc, stableReference: 'página:1' }), { code: 'NOT_FOUND' });
  await assert.rejects(runCapability(f.guest.context, 'k5_vault_download_document', { documentId: f.sharedDoc }));
});

test('removing reserved folders or flattening a case cannot publish their files', async () => {
  const f = await fixture(); await f.grant(); await f.grant(f.stranger);
  const { folder } = await runCapability(f.guest.context, 'k5_vault_create_folder', {
    caseId: f.shared, name: 'Reservada', visibility: 'restricted', memberIds: [f.owner.id],
  }) as { folder: Folder };
  const privateDocument = await f.document(f.shared, 'Contrato reservado', folder.id, f.guest.id);
  const approval = await createApprovalProposal(f.owner.context, 'k5_vault_delete_folder', { folderId: folder.id });
  await approveProposal(f.owner.context, approval.id);
  await assert.rejects(runCapability(f.owner.context, 'k5_vault_delete_folder', { folderId: folder.id, approvalId: approval.id }), { code: 'CONFLICT' });
  await assert.rejects(runCapability(f.owner.context, 'k5_vault_update_document', { documentId: privateDocument, folderId: null, name: 'Não deve mudar' }), { code: 'FORBIDDEN' });
  assert.equal((await db.prepare('SELECT original_name,folder_id FROM vault_document WHERE id=?').get(privateDocument))?.original_name, 'Contrato reservado');
  await assert.rejects(runCapability(f.stranger.context, 'k5_vault_get_document', { documentId: privateDocument }), { code: 'NOT_FOUND' });
  const caseApproval = await createApprovalProposal(f.owner.context, 'k5_vault_delete_case', { caseId: f.shared, targetCaseId: f.privateCase });
  await approveProposal(f.owner.context, caseApproval.id);
  await assert.rejects(runCapability(f.owner.context, 'k5_vault_delete_case', { caseId: f.shared, targetCaseId: f.privateCase, approvalId: caseApproval.id }), { code: 'CONFLICT' });
  assert.deepEqual(await db.prepare('SELECT case_id,folder_id FROM vault_document WHERE id=?').get(privateDocument), { case_id: f.shared, folder_id: folder.id });

  await runCapability(f.guest.context, 'k5_vault_update_document', { documentId: privateDocument, folderId: null });
  const ownApproval = await createApprovalProposal(f.guest.context, 'k5_vault_delete_folder', { folderId: folder.id });
  await approveProposal(f.guest.context, ownApproval.id);
  await runCapability(f.guest.context, 'k5_vault_delete_folder', { folderId: folder.id, approvalId: ownApproval.id });
  assert.ok((await db.prepare('SELECT deleted_at FROM vault_folder WHERE id=?').get(folder.id))?.deleted_at);
});

test('moving within a reserved ancestor preserves access without requiring its creator', async () => {
  const f = await fixture(); await f.grant(); await f.grant(f.stranger);
  const { folder } = await runCapability(f.guest.context, 'k5_vault_create_folder', { caseId: f.shared, name: 'Com Ana', visibility: 'restricted', memberIds: [f.owner.id] }) as { folder: Folder };
  const doc = await f.document(f.shared, 'Parecer', folder.id, f.guest.id);
  const { folder: inner } = await runCapability(f.owner.context, 'k5_vault_create_folder', { caseId: f.shared, parentId: folder.id, name: 'Peças' }) as { folder: Folder };
  await runCapability(f.owner.context, 'k5_vault_update_document', { documentId: doc, folderId: inner.id });
  await runCapability(f.owner.context, 'k5_vault_update_document', { documentId: doc, folderId: folder.id });
  await assert.rejects(runCapability(f.stranger.context, 'k5_vault_get_document', { documentId: doc }), { code: 'NOT_FOUND' });
});

test('a participant cannot hide the owner\'s document, neither by moving it into a reserved folder nor by closing the folder it sits in', async () => {
  const f = await fixture(); await f.grant(); await f.grant(f.stranger);
  const { folder: reserved } = await runCapability(f.guest.context, 'k5_vault_create_folder', { caseId: f.shared, name: 'Minha', visibility: 'private' }) as { folder: Folder };
  await assert.rejects(runCapability(f.guest.context, 'k5_vault_update_document', { documentId: f.sharedDoc, folderId: reserved.id }), { code: 'FORBIDDEN' });
  const { folder: open } = await runCapability(f.guest.context, 'k5_vault_create_folder', { caseId: f.shared, name: 'Aberta' }) as { folder: Folder };
  await runCapability(f.owner.context, 'k5_vault_update_document', { documentId: f.sharedDoc, folderId: open.id });
  await assert.rejects(runCapability(f.guest.context, 'k5_vault_update_folder_access', { folderId: open.id, visibility: 'private' }), { code: 'FORBIDDEN' });
  await runCapability(f.guest.context, 'k5_vault_update_folder_access', { folderId: open.id, visibility: 'restricted', memberIds: [f.owner.id] });
  await assert.rejects(runCapability(f.guest.context, 'k5_vault_update_folder_access', { folderId: open.id, visibility: 'restricted', memberIds: [f.stranger.id] }), { code: 'FORBIDDEN' });
  const seen = await runCapability(f.owner.context, 'k5_vault_get_document', { documentId: f.sharedDoc }) as { document: { folderId: string | null } };
  assert.equal(seen.document.folderId, open.id);
  assert.deepEqual(await db.prepare('SELECT user_id FROM vault_folder_member WHERE folder_id=?').all(open.id), [{ user_id: f.owner.id }]);

  const theirs = await f.document(f.shared, 'Nota da Bia', null, f.guest.id);
  await runCapability(f.guest.context, 'k5_vault_update_document', { documentId: theirs, folderId: reserved.id });
  await assert.rejects(runCapability(f.owner.context, 'k5_vault_get_document', { documentId: theirs }), { code: 'NOT_FOUND' });
});

test('folder visibility fails closed for missing, deleted, cyclic, cross-case or overlong ancestors', async () => {
  const f = await fixture();
  const visible = async (id: string | null) => (await db.prepare('SELECT vault_folder_visible(?, ?) AS visible').get<{ visible: boolean }>(id, f.owner.id))?.visible;
  assert.equal(await visible(null), true);
  assert.equal(await visible(randomUUID()), false);
  const { folder: outer } = await runCapability(f.owner.context, 'k5_vault_create_folder', { caseId: f.shared, name: 'Externa' }) as { folder: Folder };
  const { folder: inner } = await runCapability(f.owner.context, 'k5_vault_create_folder', { caseId: f.shared, name: 'Interna', parentId: outer.id }) as { folder: Folder };
  assert.equal(await visible(inner.id), true);
  await db.prepare('UPDATE vault_folder SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(outer.id);
  assert.equal(await visible(inner.id), false);
  await db.prepare('UPDATE vault_folder SET deleted_at=NULL,parent_id=? WHERE id=?').run(inner.id, outer.id);
  assert.equal(await visible(inner.id), false);
  await db.prepare('UPDATE vault_folder SET parent_id=NULL,case_id=? WHERE id=?').run(f.privateCase, outer.id);
  assert.equal(await visible(inner.id), false);
  await db.prepare('UPDATE vault_folder SET case_id=? WHERE id=?').run(f.shared, outer.id);
  assert.equal(await visible(inner.id), true);
  assert.equal((await db.prepare('SELECT vault_folder_visible(?, NULL) AS visible').get<{ visible: boolean }>(inner.id))?.visible, false);
  let parentId = inner.id;
  for (let depth = 0; depth < 64; depth++) {
    const id = randomUUID();
    await db.prepare('INSERT INTO vault_folder(id,office_id,case_id,parent_id,name,created_by) VALUES(?,?,?,?,?,?)')
      .run(id, f.owner.context.officeId, f.shared, parentId, `Nível ${depth}`, f.owner.id);
    parentId = id;
  }
  assert.equal(await visible(parentId), false);
});

test('document verification drops cached private evidence and never sends it for another evaluation', async () => {
  const f = await fixture(); await f.grant();
  await db.prepare('INSERT INTO platform_admin(user_id) VALUES(?)').run(f.owner.id);
  await saveConnection(f.owner.id, connectionSettings.parse({ apiKey: 'synthetic-test-key', enabled: true, documents: 'enabled', version: (await connectionView()).version }));
  const theirs = await f.document(f.shared, 'Fonte da participante', null, f.guest.id);
  const source = await db.prepare('SELECT id,content FROM vault_document_chunk WHERE document_id=?').get<{ id: string; content: string }>(theirs);
  assert.ok(source);
  const runId = randomUUID(), artifactId = randomUUID();
  await db.prepare("INSERT INTO ai_run(id,office_id,user_id,kind,input,status) VALUES(?,?,?,'draft','{}','completed')").run(runId, f.owner.context.officeId, f.owner.id);
  await db.prepare("INSERT INTO ai_artifact(id,office_id,user_id,run_id,title,content) VALUES(?,?,?,?,'Minuta',?)").run(artifactId, f.owner.context.officeId, f.owner.id, runId, source.content);
  const artifact = await ownedArtifact(testDatabase, f.owner.context, artifactId);
  assert.ok(artifact);
  const units = [{ id: 'paragraph-1', text: source.content, evidence: [{ sourceId: source.id, quote: source.content }] }];
  await enqueueVerification(f.owner.context, artifact, units);
  await processNextVerification({ send: async (_key, request) => ({ model: request.model, usage: { input_tokens: 10, output_tokens: 10 },
    answers: Object.fromEntries(Object.keys(request.questions).map(name => [name, { type: 'choice', choice: 'supported', confidence: 1,
      probabilities: { supported: 1, unsupported: 0, contradicted: 0, insufficient_context: 0 } }])) }) });
  assert.equal((await getVerification(f.owner.context, { artifactId })).verification?.items.length, 1);
  const { folder } = await runCapability(f.guest.context, 'k5_vault_create_folder', { caseId: f.shared, name: 'Pessoal', visibility: 'private' }) as { folder: Folder };
  await runCapability(f.guest.context, 'k5_vault_update_document', { documentId: theirs, folderId: folder.id });
  const hidden = (await getVerification(f.owner.context, { artifactId })).verification;
  assert.equal(hidden?.status, 'stale'); assert.deepEqual(hidden?.items, []);
  await db.prepare('UPDATE ai_artifact SET version=version+1 WHERE id=?').run(artifactId);
  const next = await ownedArtifact(testDatabase, f.owner.context, artifactId);
  assert.ok(next);
  await enqueueVerification(f.owner.context, next, units);
  let sent = false;
  await processNextVerification({ send: async () => { sent = true; throw new Error('A fonte privada não pode ser enviada.'); } });
  assert.equal(sent, false);
  assert.ok(!(await getVerification(f.owner.context, { artifactId })).verification?.items.some(item => item.sources.length));
});
