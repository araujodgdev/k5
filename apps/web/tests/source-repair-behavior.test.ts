import { testDb as db } from './test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Document, Packer, Paragraph, ImageRun } from 'docx';
import { googleFixture } from './google-fixture';
import { recordingWriter } from './shared-writing-fixture';
import { createConversation } from '../src/lib/ai-store';
import { createPrivateDocument, updatePrivateDocument } from '../src/lib/documents/service';
import { createPage, proposePageWrite, approvalPreview } from '../src/lib/case-pages/service';
import { authStore } from '../src/lib/database';
import { migratePostgres } from '../src/lib/db/migrate';
import { observePage, artifactPolicy, assertPolicyAccess } from '../src/lib/content-policy';
import { recordPersonRequest } from '../src/lib/documents/shared-writing';
import { authorizeMessageScope } from '../src/lib/chat-scope-server';
import { createChatAttachment, resolveChatAttachments, claimChatAttachments } from '../src/lib/chat-attachments';
import { runCapability } from '../src/lib/agent-tools';
import { decideAgentApproval } from '../src/lib/application/agent-approvals';
import { getApprovalProposal, approveProposal } from '../src/lib/application/approvals-service';
import { createUploadRef } from '../src/lib/application/uploads-service';
import { createVaultDocument, processDocument } from '../src/lib/vault';
import { personPolicy } from '../src/lib/content-policy';
import { connectionSettings } from '../src/lib/typesafe/contracts';
import { connectionView, saveConnection } from '../src/lib/typesafe/config';
import type { DecisionTransport } from '../src/lib/typesafe/client';
import { conversationSources, recordSources, sourcesFromTool } from '../src/lib/citations/sources';
import { reviewCitations } from '../src/lib/citations/review';
import { reviewArtifactCitations } from '../src/lib/citations/artifact-review';

async function fixture() {
  const f = await googleFixture();
  const caseId = randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, f.officeId, 'Fontes selecionadas', f.userId);
  const { id: conversationId } = await createConversation(db, f.context);
  return { ...f, caseId, conversationId };
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF8cAAAAASUVORK5CYII=', 'base64');

test('capture migration preserves legacy pending, approved and consumed proposals; actual approval requires fresh inputs', async t => {
  const f = await fixture();
  await recordingWriter(t, f.userId, [
    { title: 'Pending capture', content: 'Pending text' }, { title: 'Approved capture', content: 'Approved text' },
    { title: 'Consumed capture', content: 'Consumed text' }, { title: 'Fresh capture', content: 'Fresh text' },
  ]);
  const scope = await authorizeMessageScope(f.context, { caseId: f.caseId, documentIds: [], researchReferenceIds: [] });
  const propose = async (text: string) => {
    const submissionId = await recordPersonRequest(f.context, f.conversationId, randomUUID(), text, scope, []);
    return proposePageWrite({ ...f.context, invocation: 'agent', conversationId: f.conversationId, submissionId, generationId: randomUUID() },
      'k5_case_pages_create', { caseId: f.caseId, folderId: null });
  };
  const pending = await propose('Pending person request');
  const approved = await propose('Approved person request');
  await approveProposal(f.context, approved.approvalId);
  const consumed = await propose('Consumed person request');
  const original = await decideAgentApproval(f.context, consumed.approvalId, 'confirm');
  assert.equal(original.state, 'confirmed');
  await db.exec('ALTER TABLE content_submission DROP COLUMN input_format');
  await db.prepare('DELETE FROM postgres_migration WHERE name=?').run('0081_source_capture_upgrade.sql');
  await assert.rejects(migratePostgres(await authStore(), new URL('../db/postgres/', import.meta.url)), { code: '23514' });
  console.log(JSON.stringify({ originalCaptureUpgradeRejectedByPostgres: '23514', legacyApprovalsRetained: true }));
  await db.prepare('DELETE FROM postgres_migration WHERE name IN (?,?,?)').run(
    '0080a_capture_upgrade_compat.sql', '0081_source_capture_upgrade.sql', '0082_capture_upgrade_compat_cleanup.sql');
  await migratePostgres(await authStore(), new URL('../db/postgres/', import.meta.url));
  for (const [id, status] of [[pending.approvalId, 'pending'], [approved.approvalId, 'approved'], [consumed.approvalId, 'consumed']]) {
    assert.equal((await getApprovalProposal(f.context, id)).status, status);
  }
  assert.equal(await db.prepare("SELECT 1 FROM pg_trigger WHERE tgname='capture_upgrade_preserve_approval'").get(), undefined);
  await assert.rejects(approvalPreview(f.context, pending.approvalId), { code: 'NOT_READY' });
  const denied = await decideAgentApproval(f.context, pending.approvalId, 'confirm');
  assert.equal(denied.state, 'failed');
  assert.match(denied.result, /Envie o pedido novamente/);
  assert.equal((await getApprovalProposal(f.context, pending.approvalId)).status, 'approved');
  assert.equal(await db.prepare("SELECT 1 FROM case_page WHERE case_id=? AND title='Pending capture'").get(f.caseId), undefined);
  assert.deepEqual(await decideAgentApproval(f.context, consumed.approvalId, 'confirm'), original);
  const fresh = await propose('New authenticated independent request');
  assert.equal((await decideAgentApproval(f.context, fresh.approvalId, 'confirm')).state, 'confirmed');
});

test('actual knowledge exposure and both citation review entry points exclude revoked cached Vault text', async () => {
  const f = await fixture();
  await db.prepare('INSERT INTO platform_admin(user_id) VALUES(?)').run(f.userId);
  await saveConnection(f.userId, connectionSettings.parse({ apiKey: 'synthetic-typesafe-key', enabled: true, documents: 'enabled', version: (await connectionView()).version }));
  const uploaded = await createUploadRef(f.context, new File(['Art. 300 do CPC. REVOKED_CITATION_SENTINEL tutela provisoria.'], 'CPC.txt', { type: 'text/plain' }));
  const doc = await createVaultDocument(f.context, uploaded, { scope: 'library', policy: personPolicy('', '') });
  await processDocument(doc.id, f.officeId);
  const chunk = await db.prepare('SELECT stable_reference FROM vault_document_chunk WHERE document_id=? LIMIT 1').get<{ stable_reference: string }>(doc.id);
  const result = await runCapability({ ...f.context, conversationId: f.conversationId }, 'k5_knowledge_get_source', { documentId: doc.id, stableReference: chunk!.stable_reference });
  await recordSources(f.context, f.conversationId, sourcesFromTool('k5_knowledge_get_source', result));
  await recordSources(f.context, f.conversationId, [{ kind: 'web', ref: 'public-cpc', title: 'CPC', text: 'Art. 300 do CPC. PUBLIC_CITATION_SENTINEL.' }]);
  const requests: string[] = [];
  const send: DecisionTransport = async (_key, request) => {
    requests.push(JSON.stringify(request));
    return { model: request.model, usage: { input_tokens: 1, output_tokens: 0 }, answers: Object.fromEntries(Object.entries(request.questions).map(([name, question]) =>
      [name, question.type === 'choice' ? { type: 'choice', choice: name.startsWith('kind') ? 'statute' : 'supports', confidence: 1,
        probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === (name.startsWith('kind') ? 'statute' : 'supports') ? 1 : 0])) } : { type: 'noul', noul: 1 }])) };
  };
  const text = 'Conforme o art. 300 do CPC, requer a tutela provisória.';
  await reviewCitations(f.context, text, await conversationSources(f.context, f.conversationId), { send });
  assert.match(requests[0], /REVOKED_CITATION_SENTINEL/);
  await db.prepare('DELETE FROM vault_document_chunk WHERE document_id=?').run(doc.id);
  assert.ok((await conversationSources(f.context, f.conversationId)).some(source => source.text.includes('REVOKED_CITATION_SENTINEL')));
  await db.prepare('UPDATE vault_document SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(doc.id);
  await reviewCitations(f.context, text, await conversationSources(f.context, f.conversationId), { send });
  const artifact = await createPrivateDocument({ ...f.context, conversationId: f.conversationId }, { title: 'Pedido independente', content: text });
  await reviewArtifactCitations(f.context, artifact, { send });
  for (const wire of requests.slice(1)) { assert.doesNotMatch(wire, /REVOKED_CITATION_SENTINEL/); assert.match(wire, /PUBLIC_CITATION_SENTINEL/); }
  assert.equal(requests.length, 3);
});

test('explicit continuation retains the original contract and image bytes; a cleared request works after revocation', async t => {
  const f = await fixture();
  const source = (await createPage(f.context, { caseId: f.caseId, title: 'Contrato', content: 'ORIGINAL_CONTRACT_DEADLINE: quinze dias.' })).page;
  const upload = await createUploadRef(f.context, new File(['ORIGINAL_CONTRACT_DEADLINE: quinze dias.'], 'contrato.txt', { type: 'text/plain' }));
  const document = await createVaultDocument(f.context, upload, { scope: 'library', policy: (await observePage(f.userId, source.id, f.caseId)).policy });
  await processDocument(document.id, f.officeId);
  const picture = await createChatAttachment(f.context, f.conversationId, new File([png], 'prazo.png', { type: 'image/png' }));
  const messageId = randomUUID();
  const rows = await resolveChatAttachments(f.context, f.conversationId, messageId, [picture.id]);
  await claimChatAttachments(f.context, f.conversationId, messageId, rows);
  const scope = await authorizeMessageScope(f.context, { caseId: f.caseId, documentIds: [document.id], researchReferenceIds: [] });
  const submissionId = await recordPersonRequest(f.context, f.conversationId, messageId, 'ORIGINAL_PERSON_INSTRUCTION: prepare o resumo.', scope, rows);
  const writer = await recordingWriter(t, f.userId, [{ title: 'Resumo', content: 'Primeiro texto.' }, { title: 'Resumo revisto', content: 'Quinze dias.' }, { title: 'Novo pedido', content: 'Texto independente.' }]);
  const context = { ...f.context, invocation: 'agent' as const, conversationId: f.conversationId, submissionId, generationId: randomUUID() };
  const first = await proposePageWrite(context, 'k5_case_pages_create', { caseId: f.caseId, folderId: null });
  const freshScope = await authorizeMessageScope(f.context, { caseId: f.caseId, documentIds: [], researchReferenceIds: [] });
  const follow = await recordPersonRequest(f.context, f.conversationId, randomUUID(), 'Inclua o prazo do contrato anexado.', freshScope, [], { continuationId: first.approvalId });
  await proposePageWrite({ ...context, submissionId: follow, generationId: randomUUID() }, 'k5_case_pages_create', { caseId: f.caseId, folderId: null });
  const sent = JSON.stringify(writer[1].body);
  assert.match(sent, /ORIGINAL_CONTRACT_DEADLINE|ORIGINAL_PERSON_INSTRUCTION/);
  assert.ok(sent.includes(png.toString('base64')));
  await db.prepare('UPDATE vault_document SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(document.id);
  await assert.rejects(recordPersonRequest(f.context, f.conversationId, randomUUID(), 'Continue.', freshScope, [], { continuationId: first.approvalId }), { code: 'NOT_FOUND' });
  const independent = await recordPersonRequest(f.context, f.conversationId, randomUUID(), 'Escreva um pedido independente.', freshScope, []);
  await proposePageWrite({ ...context, submissionId: independent, generationId: randomUUID() }, 'k5_case_pages_create', { caseId: f.caseId, folderId: null });
  assert.doesNotMatch(JSON.stringify(writer[2].body), /ORIGINAL_CONTRACT|ORIGINAL_PERSON|Primeiro texto/);
});

test('image-only DOCX is admitted with its embedded bytes; unsupported native audio refuses a shared writer', async t => {
  const f = await fixture();
  const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [new ImageRun({ type: 'png', data: png, transformation: { width: 20, height: 20 } })] })] }] }));
  const attached = await createChatAttachment(f.context, f.conversationId, new File([new Uint8Array(bytes)], 'imagem.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  const messageId = randomUUID(), rows = await resolveChatAttachments(f.context, f.conversationId, messageId, [attached.id]);
  await claimChatAttachments(f.context, f.conversationId, messageId, rows);
  const scope = await authorizeMessageScope(f.context, { caseId: f.caseId, documentIds: [], researchReferenceIds: [] });
  const submissionId = await recordPersonRequest(f.context, f.conversationId, messageId, 'Descreva a imagem do Word.', scope, rows);
  const wire = await recordingWriter(t, f.userId, [{ title: 'Imagem', content: 'Imagem do Word.' }]);
  const context = { ...f.context, invocation: 'agent' as const, conversationId: f.conversationId, submissionId, generationId: randomUUID() };
  await proposePageWrite(context, 'k5_case_pages_create', { caseId: f.caseId, folderId: null });
  assert.ok(JSON.stringify(wire[0].body).includes(png.toString('base64')));
  const audio = await recordPersonRequest(f.context, f.conversationId, randomUUID(), 'Use o áudio.', scope, [], { unsupportedAudio: true });
  await assert.rejects(proposePageWrite({ ...context, submissionId: audio, generationId: randomUUID() }, 'k5_case_pages_create', { caseId: f.caseId, folderId: null }), { code: 'INVALID' });
  assert.equal(wire.length, 1);
});

test('actual artifact list and historical version exposures persist restrictions in private derivatives', async () => {
  const f = await fixture();
  const source = (await createPage(f.context, { caseId: f.caseId, title: 'Fonte', content: 'SOURCE_TITLE_SENTINEL' })).page;
  const policy = (await observePage(f.userId, source.id, f.caseId)).policy;
  const original = await createPrivateDocument(f.context, { title: 'RESTRICTED_TITLE_SENTINEL', content: 'Texto', sources: [policy] });
  const context = { ...f.context, invocation: 'agent' as const, conversationId: f.conversationId, contentSources: [] as Awaited<ReturnType<typeof artifactPolicy>>[] };
  const listed = await runCapability(context, 'k5_artifacts_list', { limit: 20 });
  assert.match(JSON.stringify(listed), /RESTRICTED_TITLE_SENTINEL/);
  const derivative = await createPrivateDocument(context, { title: 'Derivada', content: 'RESTRICTED_TITLE_SENTINEL' });
  const secondCase = randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(secondCase, f.officeId, 'Somente V2', f.userId);
  const secondSource = (await createPage(f.context, { caseId: secondCase, title: 'Fonte V2', content: 'ONLY_CURRENT_VERSION_SOURCE' })).page;
  await updatePrivateDocument({ ...f.context, invocation: 'agent', contentSources: [(await observePage(f.userId, secondSource.id, secondCase)).policy] },
    { id: original.id, title: 'V2', content: 'V2', version: 1 });
  await db.prepare('UPDATE vault_case SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(secondCase);
  const historyContext = { ...context, contentSources: [] as typeof context.contentSources };
  const history = await runCapability(historyContext, 'k5_artifacts_list_versions', { artifactId: original.id });
  assert.match(JSON.stringify(history), /RESTRICTED_TITLE_SENTINEL/);
  assert.doesNotMatch(JSON.stringify(history), /"title":"V2"/);
  const historyDerivative = await createPrivateDocument(historyContext, { title: 'Histórica', content: 'Versões consultadas' });
  assert.ok(!(await artifactPolicy(f.context, historyDerivative.id)).guards.some(guard => guard.id === secondSource.id));
  await db.prepare('UPDATE vault_case SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(f.caseId);
  for (const id of [derivative.id, historyDerivative.id]) await assert.rejects(assertPolicyAccess(f.userId, await artifactPolicy(f.context, id)), { code: 'NOT_FOUND' });
});

test('consumed private edit replays exact A2 through actual approval execution after unrelated A3 revocation', async () => {
  const f = await fixture();
  const original = await createPrivateDocument(f.context, { title: 'Documento', content: 'A1 original' });
  const input = { artifactId: original.id, version: 1, edits: [{ find: 'A1', replace: 'A2' }] };
  const context = { ...f.context, invocation: 'agent' as const, conversationId: f.conversationId, contentSources: [] };
  await assert.rejects(runCapability(context, 'k5_artifacts_edit', input), { code: 'APPROVAL_REQUIRED' });
  const approval = await db.prepare("SELECT id FROM capability_approval WHERE user_id=? AND capability_name='k5_artifacts_edit'").get<{ id: string }>(f.userId);
  assert.equal((await decideAgentApproval(f.context, approval!.id, 'confirm')).state, 'confirmed');
  const before = (await getApprovalProposal(f.context, approval!.id)).content_result;
  const source = (await createPage(f.context, { caseId: f.caseId, title: 'S', content: 'Restricted S' })).page;
  const policy = (await observePage(f.userId, source.id, f.caseId)).policy;
  await updatePrivateDocument({ ...f.context, invocation: 'agent', conversationId: f.conversationId, contentSources: [policy] }, { id: original.id, version: 2, title: 'A3', content: 'A3 uses S' });
  await db.prepare('UPDATE vault_case SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(f.caseId);
  assert.equal((await decideAgentApproval(f.context, approval!.id, 'confirm')).state, 'confirmed');
  assert.deepEqual((await getApprovalProposal(f.context, approval!.id)).content_result, before);
  assert.deepEqual(await db.prepare('SELECT version,content FROM ai_artifact WHERE id=?').get(original.id), { version: 3, content: 'A3 uses S' });
  assert.equal((await runCapability(f.context, 'k5_artifacts_edit', { ...input, approvalId: approval!.id }) as { artifact: { version: number } }).artifact.version, 2);
});
