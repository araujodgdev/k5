import { testDb } from './test-setup';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { documentTemplates, resolveDocumentTemplateId, setDocumentTemplate, templateCandidates } from '../src/lib/agent-profile';
import { createVaultFolder, updateVaultFolderAccess } from '../src/lib/vault';
import type { WorkspaceContext } from '../src/lib/application/context';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function office() {
  const officeId = randomUUID();
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório');
  const userId = randomUUID();
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@test.local`, 'Advogada');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id) VALUES(?,?,?)').run(randomUUID(), officeId, userId);
  const admin: WorkspaceContext = { officeId, userId };
  const document = async (name: string, mimeType = DOCX) => {
    const id = randomUUID();
    await testDb.prepare(`INSERT INTO vault_document (id, office_id, scope, original_name, stored_name, mime_type, byte_size, sha256, status, created_by)
      VALUES (?, ?, 'library', ?, ?, ?, 10, 'sha', 'ready', ?)`).run(id, officeId, name, `stored-${id}`, mimeType, admin.userId);
    return id;
  };
  return { officeId, admin, document };
}

test('agent profile: choosing or removing the single template clears legacy settings', async () => {
  const { admin, document } = await office();
  const lawyer = admin;
  const letterhead = await document('timbrado.docx');
  const own = await document('meu-modelo.docx');

  assert.equal(await resolveDocumentTemplateId(lawyer), undefined);
  await setDocumentTemplate(admin, 'office', letterhead);
  assert.equal(await resolveDocumentTemplateId(lawyer), letterhead);

  const after = await setDocumentTemplate(lawyer, 'personal', own);
  assert.equal(after.office, null);
  assert.equal(after.personal?.documentId, own);
  assert.equal(await resolveDocumentTemplateId(lawyer), own);

  await setDocumentTemplate(lawyer, 'personal', null);
  assert.equal(await resolveDocumentTemplateId(lawyer), undefined);

  await testDb.prepare('INSERT INTO agent_document_template(office_id,user_id,document_id,updated_by) VALUES(?,?,?,?),(?,?,?,?)')
    .run(admin.officeId, '', letterhead, admin.userId, admin.officeId, admin.userId, own, admin.userId);
  assert.equal(await resolveDocumentTemplateId(lawyer), own);
  await setDocumentTemplate(lawyer, 'personal', null);
  assert.deepEqual(await documentTemplates(lawyer), { office: null, personal: null });
});


test('agent profile: templates stay inside the office and must be Word files', async () => {
  const a = await office();
  const b = await office();
  const foreign = await b.document('timbrado-b.docx');
  const pdf = await a.document('timbrado.pdf', 'application/pdf');

  await assert.rejects(setDocumentTemplate(a.admin, 'office', foreign), { code: 'NOT_FOUND' });
  await assert.rejects(setDocumentTemplate(a.admin, 'office', pdf), { code: 'INVALID' });
  assert.deepEqual((await templateCandidates(a.admin)).map(item => item.id), []);
  assert.deepEqual((await templateCandidates(b.admin)).map(item => item.id), [foreign]);
});

test('agent profile: a template deleted in the Cofre stops applying', async () => {
  const { admin, document } = await office();
  const letterhead = await document('timbrado.docx');
  await setDocumentTemplate(admin, 'office', letterhead);
  await testDb.prepare('UPDATE vault_document SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(letterhead);
  assert.equal(await resolveDocumentTemplateId(admin), undefined);
  assert.equal((await documentTemplates(admin)).office, null);
});

test('agent profile: private ancestor folders hide Word candidates and revoke saved templates', async () => {
  const owner = await office();
  const associate = await office();
  const caseId = randomUUID();
  await testDb.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)')
    .run(caseId, owner.officeId, 'Caso compartilhado', owner.admin.userId);
  await testDb.prepare('INSERT INTO case_participant(office_id,case_id,user_id,invited_by) VALUES(?,?,?,?)')
    .run(owner.officeId, caseId, associate.admin.userId, owner.admin.userId);
  const parent = await createVaultFolder(owner.officeId, associate.admin.userId, caseId, 'Reservado', null, { visibility: 'private' });
  const child = await createVaultFolder(owner.officeId, associate.admin.userId, caseId, 'Pública', parent.id);
  const documentId = await owner.document('modelo-confidencial.docx');
  await testDb.prepare("UPDATE vault_document SET scope='case',case_id=?,folder_id=?,created_by=? WHERE id=?")
    .run(caseId, child.id, associate.admin.userId, documentId);

  assert.deepEqual(await templateCandidates(owner.admin), []);
  for (const scope of ['office', 'personal'] as const)
    await assert.rejects(setDocumentTemplate(owner.admin, scope, documentId), { code: 'NOT_FOUND' });
  assert.deepEqual((await templateCandidates({ officeId: owner.officeId, userId: associate.admin.userId })).map(item => item.id), [documentId]);

  await updateVaultFolderAccess(owner.officeId, parent.id, associate.admin.userId, { visibility: 'restricted', memberIds: [owner.admin.userId] });
  await setDocumentTemplate(owner.admin, 'office', documentId);
  await setDocumentTemplate(owner.admin, 'personal', documentId);
  assert.equal(await resolveDocumentTemplateId(owner.admin), documentId);

  await updateVaultFolderAccess(owner.officeId, parent.id, associate.admin.userId, { visibility: 'private' });
  assert.deepEqual(await templateCandidates(owner.admin), []);
  assert.deepEqual(await documentTemplates(owner.admin), { office: null, personal: null });
  assert.equal(await resolveDocumentTemplateId(owner.admin), undefined);

  await updateVaultFolderAccess(owner.officeId, parent.id, associate.admin.userId, { visibility: 'public' });
  assert.equal(await resolveDocumentTemplateId(owner.admin), documentId);
});
