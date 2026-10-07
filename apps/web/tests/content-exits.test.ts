import { testDb as db } from './test-setup';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { googleFixture, installFakeGoogle, respond, setRule } from './google-fixture';
import { setGoogleTransport } from '../src/lib/google/transport';
import { sendMail } from '../src/lib/google/gmail/service';
import { recordingWriter, personRequestContext } from './shared-writing-fixture';
import { createPrivateDocument } from '../src/lib/documents/service';
import { saveArtifactToVault } from '../src/lib/application/vault-service';
import { publishPortalArtifact } from '../src/lib/client-portal/service';
import { createPage } from '../src/lib/case-pages/service';
import { observePage, vaultPolicy } from '../src/lib/content-policy';
import { createUploadRef } from '../src/lib/application/uploads-service';
import { createVaultDocument, processDocument } from '../src/lib/vault';
import { exportDocument } from '../src/lib/document-export';
import { setDocumentTemplate } from '../src/lib/agent-profile';
import { artifactVaultFile } from '../src/lib/artifact-file';

afterEach(() => setGoogleTransport(undefined));
const compose = { to: ['destino@example.test'], cc: [], bcc: [], subject: 'Texto pessoal', body: 'Texto pessoal', replyToMessageId: null, attachments: [] };

test('actual Gmail dispatch recomposes private planner text, while private archive attachments and portal publication are refused before a send', async t => {
  const f = await googleFixture();
  await setRule(f.officeId, 'gmail.send', { mode: 'automatic' });
  const fake = installFakeGoogle();
  fake.on('POST', /\/users\/me\/messages\/send$/, request => {
    const mime = Buffer.from((request.json() as { raw: string }).raw, 'base64url').toString();
    assert.doesNotMatch(mime, /PRIVATE_PLAN/);
    assert.match(mime, new RegExp(Buffer.from('ADMITTED_EXTERNAL_BODY').toString('base64')));
    return respond(200, { id: 'sent', threadId: 'thread' });
  });
  const wire = await recordingWriter(t, f.userId, [{ title: 'Assunto autorizado', content: 'ADMITTED_EXTERNAL_BODY' }]);
  const context = await personRequestContext({ ...f.context, invocation: 'agent' }, 'Escreva uma mensagem curta confirmando o recebimento.');
  const sent = await sendMail(context, { ...compose, subject: 'PRIVATE_PLAN_SUBJECT', body: 'PRIVATE_PLAN_BODY', idempotencyKey: randomUUID() });
  assert.equal(sent.operation.status, 'succeeded');
  assert.equal(wire.length, 1);
  assert.doesNotMatch(JSON.stringify(wire), /PRIVATE_PLAN/);
  const privateDraft = await createPrivateDocument({ ...f.context, invocation: 'agent' }, { title: 'Particular', content: 'PRIVATE_FILE_CONTENT' });
  const copy = await saveArtifactToVault(f.context, { artifactId: privateDraft.id, version: 1, format: 'docx', scope: 'library' });
  await assert.rejects(sendMail(f.context, { ...compose, attachments: [{ kind: 'vault', documentId: copy.document.id }], idempotencyKey: randomUUID() }), { code: 'FORBIDDEN' });
  assert.equal(fake.count('POST', /\/messages\/send$/), 1);
  const clientId = randomUUID();
  await db.prepare("INSERT INTO crm_client(id,office_id,name,stage,created_at,updated_at) VALUES(?,?,'Cliente','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run(clientId, f.officeId);
  await assert.rejects(publishPortalArtifact(f.context, { clientId, artifactId: privateDraft.id, version: 1, idempotencyKey: randomUUID() }), { code: 'FORBIDDEN' });
  assert.equal(await db.prepare('SELECT 1 FROM client_portal_file WHERE office_id=?').get(f.officeId), undefined);
});

test('the actual default template contributes its pinned version to DOCX copies; PDFcn remains source independent and inaccessible selection never falls back', async () => {
  const f = await googleFixture();
  const caseId = randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, f.officeId, 'Template protegido', f.userId);
  const source = (await createPage(f.context, { caseId, folderId: null, title: 'Fonte do timbre', content: 'TIMBRE_PROTEGIDO' })).page;
  const observed = await observePage(f.userId, source.id, caseId);
  const templateBytes = await exportDocument('TIMBRE_PROTEGIDO\n\n{{conteudo}}');
  const template = await createVaultDocument(f.context, await createUploadRef(f.context, new File([new Uint8Array(templateBytes)], 'modelo.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })),
    { scope: 'library', policy: observed.policy });
  await processDocument(template.id, f.officeId);
  await setDocumentTemplate(f.context, 'personal', template.id);
  const draft = await createPrivateDocument(f.context, { title: 'Texto pessoal', content: 'TEXTO_PESSOAL' });
  const docx = await saveArtifactToVault(f.context, { artifactId: draft.id, version: 1, format: 'docx', scope: 'library' });
  const policy = await vaultPolicy(docx.document.id);
  assert.ok(policy.observed.some(pin => pin.kind === 'document' && pin.id === template.id && pin.version === '1'));
  assert.ok(policy.guards.some(guard => guard.kind === 'page' && guard.id === source.id));
  const pdf = await artifactVaultFile(f.context, draft, 'pdf');
  assert.deepEqual(pdf.policy.guards, []);
  await db.prepare('UPDATE vault_case SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(caseId);
  await assert.rejects(artifactVaultFile(f.context, draft, 'docx'), { code: 'NOT_FOUND' });
  assert.ok((await artifactVaultFile(f.context, draft, 'pdf')).bytes.length > 100);
});
