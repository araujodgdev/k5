import { testDb } from './test-setup';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { documentTemplates, resolveDocumentTemplateId, setDocumentTemplate, templateCandidates } from '../src/lib/agent-profile';
import type { WorkspaceContext } from '../src/lib/application/context';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function office() {
  const officeId = randomUUID();
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório');
  const member = async (role: WorkspaceContext['role']): Promise<WorkspaceContext> => {
    const userId = randomUUID();
    await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@test.local`, role);
    await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), officeId, userId, role);
    return { officeId, userId, role };
  };
  const admin = await member('administrator');
  const document = async (name: string, mimeType = DOCX) => {
    const id = randomUUID();
    await testDb.prepare(`INSERT INTO vault_document (id, office_id, scope, original_name, stored_name, mime_type, byte_size, sha256, status, created_by)
      VALUES (?, ?, 'library', ?, ?, ?, 10, 'sha', 'ready', ?)`).run(id, officeId, name, `stored-${id}`, mimeType, admin.userId);
    return id;
  };
  return { officeId, admin, member, document };
}

test('agent profile: the personal template wins over the office one, and removing it falls back', async () => {
  const { admin, member, document } = await office();
  const lawyer = await member('lawyer');
  const letterhead = await document('timbrado.docx');
  const own = await document('meu-modelo.docx');

  assert.equal(await resolveDocumentTemplateId(lawyer), undefined);
  await setDocumentTemplate(admin, 'office', letterhead);
  assert.equal(await resolveDocumentTemplateId(lawyer), letterhead);

  const after = await setDocumentTemplate(lawyer, 'personal', own);
  assert.equal(after.office?.documentId, letterhead);
  assert.equal(after.personal?.documentId, own);
  assert.equal(await resolveDocumentTemplateId(lawyer), own);
  // A colleague's personal template is not the office's and never reaches the administrator.
  assert.equal(await resolveDocumentTemplateId(admin), letterhead);

  await setDocumentTemplate(lawyer, 'personal', null);
  assert.equal(await resolveDocumentTemplateId(lawyer), letterhead);
});

test('agent profile: only administrators change the office template; reviewers change nothing', async () => {
  const { member, document } = await office();
  const lawyer = await member('lawyer');
  const reviewer = await member('reviewer');
  const letterhead = await document('timbrado.docx');

  await assert.rejects(setDocumentTemplate(lawyer, 'office', letterhead), { code: 'FORBIDDEN' });
  await assert.rejects(setDocumentTemplate(reviewer, 'personal', letterhead), { code: 'FORBIDDEN' });
  assert.equal((await documentTemplates(lawyer)).office, null);
});

test('agent profile: templates stay inside the office and must be Word files', async () => {
  const a = await office();
  const b = await office();
  const foreign = await b.document('timbrado-b.docx');
  const pdf = await a.document('timbrado.pdf', 'application/pdf');

  await assert.rejects(setDocumentTemplate(a.admin, 'office', foreign), { code: 'NOT_FOUND' });
  await assert.rejects(setDocumentTemplate(a.admin, 'office', pdf), { code: 'INVALID' });
  assert.deepEqual((await templateCandidates(a.officeId)).map(item => item.id), []);
  assert.deepEqual((await templateCandidates(b.officeId)).map(item => item.id), [foreign]);
});

test('agent profile: a template deleted in the Cofre stops applying', async () => {
  const { admin, document } = await office();
  const letterhead = await document('timbrado.docx');
  await setDocumentTemplate(admin, 'office', letterhead);
  await testDb.prepare('UPDATE vault_document SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(letterhead);
  assert.equal(await resolveDocumentTemplateId(admin), undefined);
  assert.equal((await documentTemplates(admin)).office, null);
});
