import { testDb as db } from './test-setup';
import {fixtureSession} from './session-fixture';
import { recordingWriter } from './shared-writing-fixture';
import { recordPersonRequest } from '../src/lib/documents/shared-writing';
import { observePage } from '../src/lib/content-policy';
import { createPrivateDocument } from '../src/lib/documents/service';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { ensureOfficeForUser } from '../src/lib/offices';
import { invite, respond, changeAccess } from '../src/lib/collaboration/service';
import { contextForCase } from '../src/lib/collaboration/access';
import { runCapability } from '../src/lib/agent-tools';
import { approveProposal, getApprovalProposal } from '../src/lib/application/approvals-service';
import { createPage, updatePage, getPage, listPages, listVersions, restorePage, proposePageWrite, publishPage, exportPage } from '../src/lib/case-pages/service';
import { artifactProvenance, recordProvenance, readProvenance } from '../src/lib/case-pages/provenance';
import { authorizedCanvasResource } from '../src/lib/canvas-resources';
import { createArtifact } from '../src/lib/application/artifacts-service';
import { ownedArtifact, createConversation } from '../src/lib/ai-store';
import { authorizeMessageScope } from '../src/lib/chat-scope-server';
import { saveArtifactToVault, deleteCase } from '../src/lib/application/vault-service';
import { deleteVaultFolder } from '../src/lib/vault';
import { restoreApprovalDecisions } from '../src/lib/chat-approval-store';
import { describeAgentApproval, decideAgentApproval, resourceHref } from '../src/lib/application/agent-approvals';
import type { WorkspaceContext } from '../src/lib/application/context';
import type { CasePage } from '../src/lib/case-pages/contracts';

async function fixture() {
  async function person(name: string) {
    const id = randomUUID(), email = `${id}@pages.test`;
    await db.prepare('INSERT INTO "user"(id,name,email) VALUES(?,?,?)').run(id, name, email);
    const { officeId } = await ensureOfficeForUser(db, { id, officeName: name });
    return { id, email, context: { userId: id, officeId,sessionId:await fixtureSession(id) } satisfies WorkspaceContext };
  }
  const owner = await person('Ana'), guest = await person('Bia'), outsider = await person('Clara');
  const caseId = randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, owner.context.officeId, 'Caso das páginas', owner.id);
  await respond(guest.context, (await invite(owner.context, { email: guest.email })).id, true);
  await changeAccess(owner.context, { action: 'participant', caseId, userId: guest.id, add: true });
  const revoke = () => changeAccess(owner.context, { action: 'participant', caseId, userId: guest.id, add: false });
  const page = async (actor = owner.context, folderId: string | null = null) => (await createPage(actor, { caseId, folderId, title: 'Página original', content: 'Texto original' })).page;
  const folder = async (visibility: 'public' | 'private' | 'restricted', parentId?: string, actor = owner.context) =>
    ((await runCapability(actor, 'k5_vault_create_folder', { caseId, parentId, name: 'Pasta', visibility, memberIds: visibility === 'restricted' ? [guest.id] : [] })) as { folder: { id: string } }).folder.id;
  return { owner, guest, outsider, caseId, revoke, page, folder };
}

test('participants from different offices edit, conflict without lost work, restore with CAS and never gain private artifacts', async () => {
  const f = await fixture();
  const page = await f.page(f.guest.context);
  assert.notEqual(f.owner.context.officeId, f.guest.context.officeId);
  assert.equal((await db.prepare('SELECT office_id FROM case_page WHERE id=?').get<{ office_id: string }>(page.id))?.office_id, f.owner.context.officeId);
  const input = { caseId: f.caseId, pageId: page.id, title: 'Versão conjunta', content: 'Texto novo', version: 1 };
  const saves = await Promise.allSettled([updatePage(f.owner.context, input), updatePage(f.guest.context, { ...input, content: 'Texto da participante' })]);
  assert.equal(saves.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(saves.filter(result => result.status === 'rejected' && result.reason.code === 'CONFLICT').length, 1);
  assert.deepEqual((await listVersions(f.guest.context, input)).versions.map(version => version.version), [2, 1]);
  await assert.rejects(restorePage(f.guest.context, { ...input, restoreVersion: 1 }), { code: 'CONFLICT' });
  const restored = await restorePage(f.guest.context, { ...input, version: 2, restoreVersion: 1 });
  assert.equal(restored.page.version, 3); assert.equal(restored.page.content, 'Texto original');
  await assert.rejects(getPage(f.outsider.context, input), { code: 'NOT_FOUND' });
  await assert.rejects(listPages(f.outsider.context, { caseId: f.caseId }), { code: 'NOT_FOUND' });
  await assert.rejects(runCapability(await contextForCase(f.guest.context, f.caseId), 'k5_crm_list_clients', {}), { code: 'FORBIDDEN' });
});

test('nested folders and current participation protect every read and mutation, including the page creator', async () => {
  const f = await fixture();
  const parent = await f.folder('private', undefined, f.guest.context);
  const child = await f.folder('public', parent, f.guest.context);
  const page = await f.page(f.guest.context, child);
  const input = { caseId: f.caseId, pageId: page.id };
  await assert.rejects(getPage(f.owner.context, input), { code: 'NOT_FOUND' });
  await assert.rejects(createPage(f.owner.context, { caseId: f.caseId, folderId: child, title: 'Inválida', content: '' }), { code: 'NOT_FOUND' });
  await f.revoke();
  for (const read of [() => getPage(f.guest.context, input), () => listVersions(f.guest.context, input),
    () => exportPage(f.guest.context, { ...input, version: 1, format: 'docx' }),
    () => authorizedCanvasResource(f.guest.context, `/app/vault/cases/${f.caseId}/pages/${page.id}`),
    () => updatePage(f.guest.context, { ...input, version: 1, title: 'Depois', content: 'Negado' })]) await assert.rejects(read, { code: 'NOT_FOUND' });
});

test('publication reviews exact own private version and destination, preserves original isolation, and replays once', async () => {
  const f = await fixture();
  const { artifact } = await createArtifact(f.guest.context, { title: 'Rascunho particular', content: 'Conteúdo revisado.' });
  const input = { caseId: f.caseId, folderId: null, artifactId: artifact.id, artifactVersion: 1 };
  const proposal = await proposePageWrite(f.guest.context, 'k5_case_pages_publish', input);
  assert.equal(proposal.content, 'Conteúdo revisado.'); assert.equal(proposal.destination, 'Caso das páginas');
  await assert.rejects(publishPage(f.guest.context, { ...input, approvalId: proposal.approvalId }), { code: 'APPROVAL_REQUIRED' });
  await approveProposal(f.guest.context, proposal.approvalId);
  await assert.rejects(publishPage(f.owner.context, { ...input, approvalId: proposal.approvalId }), { code: 'FORBIDDEN' });
  const folderId = await f.folder('public');
  await assert.rejects(publishPage(f.guest.context, { ...input, folderId, approvalId: proposal.approvalId }), { code: 'FORBIDDEN' });
  const copies = await Promise.all([publishPage(f.guest.context, { ...input, approvalId: proposal.approvalId }), publishPage(f.guest.context, { ...input, approvalId: proposal.approvalId })]);
  assert.equal(copies[0].page.id, copies[1].page.id);
  assert.equal((await listPages(f.owner.context, { caseId: f.caseId })).pages.length, 1);
  assert.equal((await getPage(f.owner.context, { caseId: f.caseId, pageId: copies[0].page.id })).page.content, 'Conteúdo revisado.');
  assert.equal(await ownedArtifact(db, f.owner.context, artifact.id), undefined);
  assert.equal((await ownedArtifact(db, f.guest.context, artifact.id))?.version, 1);
  assert.equal((await getApprovalProposal(f.guest.context, proposal.approvalId)).status, 'consumed');
});

test('durable source restrictions survive publication, human edits, restores and source revocation', async () => {
  const f = await fixture();
  const folder = await f.folder('restricted');
  const source = await f.page(f.owner.context, folder);
  const artifact = await createPrivateDocument(f.guest.context, { title: 'Derivado', content: 'Texto protegido da fonte', sources: [(await observePage(f.guest.id, source.id, f.caseId)).policy] });
  const input = { caseId: f.caseId, folderId: null, artifactId: artifact.id, artifactVersion: 1 };
  const before = await proposePageWrite(f.guest.context, 'k5_case_pages_publish', input);
  await approveProposal(f.guest.context, before.approvalId);
  await runCapability(f.owner.context, 'k5_vault_update_folder_access', { folderId: folder, visibility: 'private', memberIds: [] });
  await assert.rejects(publishPage(f.guest.context, { ...input, approvalId: before.approvalId }), { code: 'NOT_FOUND' });
  assert.equal((await getApprovalProposal(f.guest.context, before.approvalId)).status, 'approved');
  await runCapability(f.owner.context, 'k5_vault_update_folder_access', { folderId: folder, visibility: 'restricted', memberIds: [f.guest.id] });
  const { page } = await publishPage(f.guest.context, { ...input, approvalId: before.approvalId });
  const identity = { caseId: f.caseId, pageId: page.id };
  await updatePage(f.guest.context, { ...identity, version: 1, title: 'Editado', content: 'Texto reescrito' });
  await restorePage(f.owner.context, { ...identity, version: 2, restoreVersion: 1 });
  await runCapability(f.owner.context, 'k5_vault_update_folder_access', { folderId: folder, visibility: 'private', memberIds: [] });
  for (const read of [() => getPage(f.guest.context, identity),
    () => exportPage(f.guest.context, { ...identity, version: 3, format: 'pdf' }),
    () => publishPage(f.guest.context, { ...input, approvalId: before.approvalId })]) await assert.rejects(read, { code: 'NOT_FOUND' });
  assert.deepEqual((await listVersions(f.guest.context, identity)).versions, []);
  assert.deepEqual((await listPages(f.guest.context, { caseId: f.caseId, query: 'Derivado' })).pages, []);
  assert.equal((await getPage(f.owner.context, identity)).page.version, 3);
});

test('agent writes use recorded requests, exact durable approvals and current participation', async t => {
  const f = await fixture(); const page = await f.page();
  const { id: conversationId } = await createConversation(db, f.guest.context);
  const scope = await authorizeMessageScope(f.guest.context, { document: { kind: 'case-page', id: page.id, caseId: f.caseId }, documentIds: [], researchReferenceIds: [] });
  const submissionId = await recordPersonRequest(f.guest.context, conversationId, randomUUID(), 'Revise a página.', scope, []);
  const context = { ...f.guest.context, conversationId, submissionId, generationId: randomUUID(), invocation: 'agent' as const };
  const wire = await recordingWriter(t, f.guest.id, [{ title: 'Edição proposta', content: 'O conteúdo exato aprovado' }, { title: 'Outra proposta', content: 'Depois da revogação' }]);
  await recordProvenance(context, 'conversation', conversationId, { complete: false, dependencies: [] });
  const target = { caseId: f.caseId, pageId: page.id, version: 1 };
  await assert.rejects(runCapability(context, 'k5_case_pages_update', { ...target, title: 'PRIVATE_PLANNER_TITLE', content: 'PRIVATE_PLANNER_BODY' }), { code: 'APPROVAL_REQUIRED' });
  const proposal = await db.prepare('SELECT id,normalized_input FROM capability_approval WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get<{ id: string; normalized_input: string }>(f.guest.id);
  const input = JSON.parse(proposal!.normalized_input);
  assert.doesNotMatch(JSON.stringify(wire), /PRIVATE_PLANNER/);
  const description = await describeAgentApproval(context, 'k5_case_pages_update', input);
  assert.doesNotMatch(description, /O conteúdo exato aprovado/);
  await approveProposal(context, proposal!.id);
  await assert.rejects(runCapability(context, 'k5_case_pages_update', { ...input, content: 'Adulterado', approvalId: proposal!.id }), { code: 'FORBIDDEN' });
  const result = await runCapability(context, 'k5_case_pages_update', { ...input, approvalId: proposal!.id }) as { page: CasePage };
  assert.equal(result.page.content, 'O conteúdo exato aprovado');
  assert.equal(resourceHref('k5_case_pages_update', result), `/app/vault/cases/${f.caseId}/pages/${page.id}`);
  await assert.rejects(updatePage(f.owner.context, input), { code: 'CONFLICT' });
  const nextSubmission = await recordPersonRequest(f.guest.context, conversationId, randomUUID(), 'Deixe mais breve.', scope, []);
  const next = { ...context, submissionId: nextSubmission, generationId: randomUUID() };
  await assert.rejects(runCapability(next, 'k5_case_pages_update', { ...target, version: 2 }), { code: 'APPROVAL_REQUIRED' });
  const pending = await db.prepare("SELECT id FROM capability_approval WHERE user_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1").get<{ id: string }>(f.guest.id);
  await f.revoke();
  assert.equal((await decideAgentApproval(f.guest.context, pending!.id, 'confirm')).state, 'failed');
  assert.equal((await getPage(f.owner.context, { caseId: f.caseId, pageId: page.id })).page.content, 'O conteúdo exato aprovado');
});

test('incomplete model provenance cannot be laundered by a later human save or approval', async () => {
  const f = await fixture();
  const { id: conversationId } = await createConversation(db, f.owner.context);
  const context = { ...f.owner.context, conversationId, invocation: 'agent' as const };
  await recordProvenance(context, 'conversation', conversationId, { complete: false, dependencies: [] });
  await recordProvenance(context, 'conversation', conversationId, { complete: true, dependencies: [] });
  assert.equal((await readProvenance(context, 'conversation', conversationId))?.complete, false);
  await assert.rejects(runCapability(context, 'k5_case_pages_create', { caseId: f.caseId, title: 'Não publicar', content: 'Insumos desconhecidos' }), { code: 'FORBIDDEN' });
  const { artifact } = await createArtifact(context, { title: 'Particular', content: 'Insumos desconhecidos' });
  assert.equal((await artifactProvenance(f.owner.context, artifact.id)).complete, false);
  await assert.rejects(proposePageWrite(f.owner.context, 'k5_case_pages_publish', { caseId: f.caseId, folderId: null, artifactId: artifact.id, artifactVersion: artifact.version }), { code: 'FORBIDDEN' });
});

test('shared document scopes authorize the page separately from a private artifact id', async () => {
  const f = await fixture(); const page = await f.page();
  const input = { document: { kind: 'case-page' as const, caseId: f.caseId, id: page.id }, documentIds: [], researchReferenceIds: [] };
  const scope = await authorizeMessageScope(f.guest.context, input);
  assert.equal(scope.version, 2); assert.equal(scope.caseId, f.caseId); assert.deepEqual(scope.document, input.document);
  await assert.rejects(authorizeMessageScope(f.guest.context, { ...input, document: { kind: 'artifact', id: page.id } }));
  await f.revoke(); await assert.rejects(authorizeMessageScope(f.guest.context, input));
});

test('a failed version insert rolls back the page and approval, then a retry commits one recoverable result', async () => {
  const f = await fixture();
  const { artifact } = await createArtifact(f.owner.context, { title: 'Force rollback', content: 'Exact payload' });
  const input = { caseId: f.caseId, folderId: null, artifactId: artifact.id, artifactVersion: 1 };
  const proposal = await proposePageWrite(f.owner.context, 'k5_case_pages_publish', input);
  await approveProposal(f.owner.context, proposal.approvalId);
  await db.exec("ALTER TABLE case_page_version ADD CONSTRAINT pages_test_fail CHECK(title <> 'Force rollback') NOT VALID");
  try {
    await assert.rejects(publishPage(f.owner.context, { ...input, approvalId: proposal.approvalId }));
    assert.equal((await getApprovalProposal(f.owner.context, proposal.approvalId)).status, 'approved');
    assert.deepEqual((await listPages(f.owner.context, { caseId: f.caseId })).pages, []);
  } finally { await db.exec('ALTER TABLE case_page_version DROP CONSTRAINT pages_test_fail'); }
  const { page } = await publishPage(f.owner.context, { ...input, approvalId: proposal.approvalId });
  assert.equal((await publishPage(f.owner.context, { ...input, approvalId: proposal.approvalId })).page.id, page.id);
  const restored = await restoreApprovalDecisions(db, f.owner.context, [{ id: 'answer', role: 'assistant', parts: [{ type: 'data-approval', data: { approvalId: proposal.approvalId, capability: 'k5_case_pages_publish', summary: 'Copy', state: 'pending' } }] }]);
  assert.match(JSON.stringify(restored), /confirmed/);
  assert.match(JSON.stringify(restored), new RegExp(page.id));
});

test('tool reads retain private source restrictions without certifying a shared request', async () => {
  const f = await fixture(); const source = await f.page();
  const { id: conversationId } = await createConversation(db, f.guest.context);
  const context = { ...f.guest.context, conversationId, invocation: 'agent' as const };
  await runCapability(context, 'k5_case_pages_get', { caseId: f.caseId, pageId: source.id });
  const { artifact } = await createArtifact(context, { title: 'Derivado privado', content: source.content });
  assert.ok((await artifactProvenance(f.guest.context, artifact.id)).dependencies.some(dependency => dependency.kind === 'page' && dependency.id === source.id));
  await assert.rejects(saveArtifactToVault(await contextForCase(f.guest.context, f.caseId), { artifactId: artifact.id, version: artifact.version, format: 'docx', caseId: f.caseId, scope: 'case' }), { code: 'FORBIDDEN' });
  await assert.rejects(proposePageWrite(context, 'k5_case_pages_create', { caseId: f.caseId, folderId: null, title: 'Privado', content: 'Derivado' }), { code: 'FORBIDDEN' });
  await f.revoke();
  await assert.rejects(ownedArtifact(db, f.guest.context, artifact.id), { code: 'NOT_FOUND' });
});

test('folder removal preserves public pages and refuses to broaden protected pages or silently transfer a case', async () => {
  const f = await fixture();
  const folder = await f.folder('public'); const page = await f.page(f.owner.context, folder);
  await deleteVaultFolder(f.owner.context.officeId, folder, f.owner.id);
  assert.equal((await getPage(f.guest.context, { caseId: f.caseId, pageId: page.id })).page.folderId, null);
  const protectedFolder = await f.folder('private'); await f.page(f.owner.context, protectedFolder);
  await assert.rejects(deleteVaultFolder(f.owner.context.officeId, protectedFolder, f.owner.id), { status: 409 });
  await assert.rejects(deleteCase(f.owner.context, { caseId: f.caseId, targetCaseId: randomUUID() }), { code: 'CONFLICT' });
  const otherCase = await fixture();
  await assert.rejects(createPage(f.owner.context, { caseId: f.caseId, folderId: await otherCase.folder('public'), title: 'Wrong folder', content: '' }), { code: 'NOT_FOUND' });
});
