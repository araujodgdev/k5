import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { analyzeAnnexes, generateAnnexes, orderAnnexPlan } from '../src/lib/annexes';
import { objectStorage, storageKey } from '../src/lib/storage';
import { createVaultDocument, readVaultOriginal, findVaultDocument } from '../src/lib/vault';
import { runCapability } from '../src/lib/agent-tools';
import { CapabilityError } from '../src/lib/capabilities/errors';
import { approvalIdFromMessage } from '../src/lib/application/approvals-service';
import { decideAgentApproval, describeAgentApproval } from '../src/lib/application/agent-approvals';

async function office() {
  const officeId = randomUUID(); const userId = randomUUID(); const caseId = randomUUID();
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@example.test`, 'Advogado');
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), officeId, userId, 'lawyer');
  await testDb.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, officeId, 'Divórcio', userId);
  return { officeId, userId, caseId };
}
async function scannedPdf(owner: { officeId: string; userId: string; caseId: string }, pages: number, status = 'ready') {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) pdf.addPage([200 + i, 300]);
  const bytes = Buffer.from(await pdf.save());
  const id = randomUUID();
  const key = storageKey(owner.officeId, id, 'pdf');
  await (await objectStorage()).put(key, bytes);
  const document = await createVaultDocument(owner.officeId, owner.userId, { id, storageKey: key, originalName: 'digitalizado.pdf', mimeType: 'application/pdf',
    byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, { scope: 'case', caseId: owner.caseId });
  await testDb.prepare('UPDATE vault_document SET status=? WHERE id=?').run(status, document.id);
  return document.id;
}

test('annexes: order follows the first citation in the petition, not the scan order', () => {
  const petition = `Os autores, por seu advogado (procuração anexa), requerem o divórcio. Juntam documentos de identificação.
    O casamento consta da certidão de casamento anexa. O filho menor nasceu em 2015, conforme certidão de nascimento.`;
  const { items, uncoveredPages } = orderAnnexPlan({ documents: [
    { label: 'Certidão de nascimento', startPage: 6, endPage: 6, mention: 'conforme certidão de nascimento' },
    { label: 'Procuração', startPage: 1, endPage: 1, mention: 'procuração anexa' },
    { label: 'Comprovante de residência', startPage: 5, endPage: 5, mention: null },
    { label: 'Certidão de casamento', startPage: 4, endPage: 4, mention: 'certidão de casamento anexa' },
    { label: 'RG', startPage: 3, endPage: 2, mention: 'Juntam documentos de identificação' },
    { label: 'Inventado', startPage: 9, endPage: 99, mention: 'trecho que não existe na petição' },
  ] }, 8, petition);
  assert.deepEqual(items.filter(item => item.include).map(item => item.fileName),
    ['01_procuracao.pdf', '02_rg.pdf', '03_certidao_de_casamento.pdf', '04_certidao_de_nascimento.pdf']);
  const rg = items.find(item => item.label === 'RG')!;
  assert.deepEqual([rg.startPage, rg.endPage], [2, 3], 'reversed ranges are normalized');
  const invented = items.find(item => item.label === 'Inventado')!;
  assert.equal(invented.include, false); assert.deepEqual([invented.startPage, invented.endPage], [8, 8], 'pages are clamped to the PDF');
  assert.equal(items.find(item => item.label === 'Comprovante de residência')!.include, false);
  assert.deepEqual(uncoveredPages, [7]);
});

test('annexes: generation cuts the reviewed ranges into a new folder, scoped to the office and case', async () => {
  const owner = await office();
  const scan = await scannedPdf(owner, 6);
  const result = await generateAnnexes(owner, { caseId: owner.caseId, scanDocumentId: scan, folderName: 'Anexos do divórcio', items: [
    { label: 'Procuração', startPage: 1, endPage: 1 },
    { label: '  RG / CPF — cônjuge  ', startPage: 2, endPage: 3 },
    { label: 'Certidão de nascimento do filho (menor)', startPage: 6, endPage: 6 },
    { label: '***', startPage: 4, endPage: 4 },
  ] });
  assert.deepEqual(result.documents.map(document => document.name), ['01_procuracao.pdf', '02_rg_cpf_conjuge.pdf', '03_certidao_de_nascimento_do_filho_menor.pdf', '04_documento.pdf']);
  const folder = await testDb.prepare('SELECT name,case_id FROM vault_folder WHERE id=?').get<{ name: string; case_id: string }>(result.folderId);
  assert.deepEqual(folder, { name: 'Anexos do divórcio', case_id: owner.caseId });
  const second = await findVaultDocument(owner.officeId, result.documents[1].id);
  assert.equal(second?.folderId, result.folderId); assert.equal(second?.status, 'queued');
  const parts = await PDFDocument.load(await readVaultOriginal(second!));
  assert.equal(parts.getPageCount(), 2);
  assert.deepEqual(parts.getPages().map(page => page.getWidth()), [201, 202], 'the original pages are copied in order');

  await assert.rejects(generateAnnexes(owner, { caseId: owner.caseId, scanDocumentId: scan, folderName: '', items: [{ label: 'Fora', startPage: 5, endPage: 7 }] }), { code: 'INVALID' });
  const stranger = await office();
  await assert.rejects(generateAnnexes(stranger, { caseId: stranger.caseId, scanDocumentId: scan, folderName: '', items: [{ label: 'Alheio', startPage: 1, endPage: 1 }] }), { code: 'NOT_FOUND' });
  const otherCase = randomUUID();
  await testDb.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(otherCase, owner.officeId, 'Outro', owner.userId);
  await assert.rejects(generateAnnexes(owner, { caseId: otherCase, scanDocumentId: scan, folderName: '', items: [{ label: 'Outro caso', startPage: 1, endPage: 1 }] }), { code: 'NOT_FOUND' });
});

test('annexes: planning waits for OCR and a petition, and reviewers cannot run it', async () => {
  const owner = await office();
  const processing = await scannedPdf(owner, 3, 'processing');
  await assert.rejects(analyzeAnnexes(owner, { caseId: owner.caseId, scanDocumentId: processing, petitionText: 'x'.repeat(80) }), { code: 'NOT_READY' });
  const ready = await scannedPdf(owner, 3);
  await assert.rejects(analyzeAnnexes(owner, { caseId: owner.caseId, scanDocumentId: ready }), { code: 'INVALID' });
  await assert.rejects(analyzeAnnexes(owner, { caseId: owner.caseId, scanDocumentId: ready, petitionText: 'curta' }), { code: 'INVALID' });
  const reviewer = randomUUID();
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(reviewer, `${reviewer}@example.test`, 'Revisor');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), owner.officeId, reviewer, 'reviewer');
  await assert.rejects(runCapability({ officeId: owner.officeId, userId: reviewer, role: 'reviewer' }, 'k5_vault_generate_annexes',
    { caseId: owner.caseId, scanDocumentId: ready, items: [{ label: 'Procuração', startPage: 1, endPage: 1 }] }));
});

test('annexes: the agent waits for Confirmar before cutting pages; the Anexos tab does not', async () => {
  const owner = await office();
  const scan = await scannedPdf(owner, 4);
  const context = { officeId: owner.officeId, userId: owner.userId, role: 'lawyer' as const };
  const items = [{ label: 'Procuração', startPage: 1, endPage: 1 }, { label: 'Certidão', startPage: 2, endPage: 4 }];
  const folders = async () => Number((await testDb.prepare('SELECT count(*) AS n FROM vault_folder WHERE case_id=?').get<{ n: number }>(owner.caseId))?.n);
  const before = await folders();
  let approvalId: string | null = null;
  try { await runCapability({ ...context, invocation: 'agent' }, 'k5_vault_generate_annexes', { caseId: owner.caseId, scanDocumentId: scan, items }); }
  catch (error) { assert.ok(error instanceof CapabilityError); assert.equal(error.code, 'APPROVAL_REQUIRED'); approvalId = approvalIdFromMessage(error.message); }
  assert.ok(approvalId, 'the agent call becomes a proposal');
  assert.equal(await folders(), before, 'no file is cut before the person confirms');
  assert.equal(await describeAgentApproval(context, 'k5_vault_generate_annexes', { scanDocumentId: scan, items }), 'Gerar 2 anexos do PDF “digitalizado.pdf”: Procuração (p. 1); Certidão (p. 2–4)');
  const decided = await decideAgentApproval(context, approvalId, 'confirm');
  assert.equal(decided.state, 'confirmed');
  assert.equal(await folders(), before + 1);
  // A second Confirmar, or a replayed call with the used approval, does not cut the pages again.
  await assert.rejects(decideAgentApproval(context, approvalId, 'confirm'), (error: unknown) => error instanceof CapabilityError && error.code === 'CONFLICT');
  await assert.rejects(runCapability({ ...context, invocation: 'agent' }, 'k5_vault_generate_annexes', { caseId: owner.caseId, scanDocumentId: scan, items, approvalId }),
    (error: unknown) => error instanceof CapabilityError && error.code === 'CONFLICT');
  assert.equal(await folders(), before + 1);
  // The interface already asked the person, so its call runs at once.
  const direct = await runCapability(context, 'k5_vault_generate_annexes', { caseId: owner.caseId, scanDocumentId: scan, folderName: 'Anexos revisados', items: items.slice(0, 1) }) as { documents: unknown[] };
  assert.equal(direct.documents.length, 1);
});
