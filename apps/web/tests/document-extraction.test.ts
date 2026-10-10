import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extractDocumentSections } from '../src/lib/document-extraction';
import type { WorkspaceContext } from '../src/lib/application/context';
import { createUploadRef } from '../src/lib/application/uploads-service';
import { addDocumentVersion, ingestUpload } from '../src/lib/application/vault-service';
import { getDocumentChunks, processDocument } from '../src/lib/vault';

test('scanned PDF uses matching native PDF.js and OCR versions, then resumes from its checkpoint', async () => {
  const office = randomUUID(), user = randomUUID(), document = randomUUID();
  await testDb.prepare('INSERT INTO office(id,name) VALUES (?,?)').run(office, 'OCR QA');
  await testDb.prepare('INSERT INTO "user"(id,email,name) VALUES (?,?,?)').run(user, `${user}@example.test`, 'QA');
  await testDb.prepare(`INSERT INTO vault_document(id,office_id,scope,original_name,stored_name,mime_type,byte_size,sha256,created_by)
    VALUES (?,?,'library','ocr.pdf',?,'application/pdf',1,'qa',?)`).run(document, office, `${office}/${document}/ocr.pdf`, user);
  const pdf = await readFile(new URL('./fixtures/ocr-task-list.pdf', import.meta.url));
  const sections = await extractDocumentSections(pdf, 'application/pdf', 'ocr.pdf', document);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].reference, 'página:1');
  assert.match(sections[0].content, /Revisar documentos em 25\/09\/2026/i);
  assert.match(sections[0].content, /Organizar arquivos em 26\/09\/2026/i);
  assert.deepEqual(await extractDocumentSections(pdf, 'application/pdf', 'ocr.pdf', document), sections);
  assert.equal((await testDb.prepare('SELECT count(*) AS total FROM vault_document_checkpoint WHERE document_id=?').get(document))!.total, 1);
});

test('a new version of a scanned PDF is read by OCR again, charged once per version, and search serves its text', async () => {
  const context = { officeId: randomUUID(), userId: randomUUID() } as WorkspaceContext;
  await testDb.prepare('INSERT INTO office(id,name) VALUES (?,?)').run(context.officeId, 'OCR versões');
  await testDb.prepare('INSERT INTO "user"(id,email,name) VALUES (?,?,?)').run(context.userId, `${context.userId}@example.test`, 'QA');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id) VALUES (?,?,?)').run(randomUUID(), context.officeId, context.userId);
  const ocrCharges = async () => (await testDb.prepare("SELECT count(*)::int AS total FROM credit_entry WHERE office_id=? AND kind='ocr'").get<{ total: number }>(context.officeId))!.total;

  const first = await createUploadRef(context, new File([await readFile(new URL('./fixtures/ocr-task-list.pdf', import.meta.url))], 'tarefas.pdf', { type: 'application/pdf' }));
  const documentId = (await ingestUpload(context, { uploadRef: first.id, scope: 'library' })).document.id;
  const text = async () => (await getDocumentChunks(context.officeId, context.userId, [documentId])).map(chunk => chunk.content).join('\n');
  await processDocument(documentId, context.officeId);
  assert.match(await text(), /Revisar documentos em 25\/09\/2026/i);
  assert.equal(await ocrCharges(), 1);

  // The second version is another scan: an image-only page with different words.
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(900, 200);
  const graphics = canvas.getContext('2d');
  graphics.fillStyle = '#ffffff'; graphics.fillRect(0, 0, 900, 200);
  graphics.fillStyle = '#111111'; graphics.font = '48px sans-serif';
  graphics.fillText('Protocolar recurso em 30/10/2026', 30, 120);
  const { PDFDocument } = await import('pdf-lib');
  const scan = await PDFDocument.create();
  scan.addPage([900, 200]).drawImage(await scan.embedPng(canvas.toBuffer('image/png')), { x: 0, y: 0, width: 900, height: 200 });
  const second = await createUploadRef(context, new File([Buffer.from(await scan.save())], 'tarefas.pdf', { type: 'application/pdf' }));
  assert.equal((await addDocumentVersion(context, { documentId, uploadRef: second.id })).version, 2);
  await processDocument(documentId, context.officeId);
  const replaced = await text();
  assert.match(replaced, /Protocolar recurso em 30\/10\/2026/i);
  assert.doesNotMatch(replaced, /Revisar documentos/i);
  assert.equal(await ocrCharges(), 2);

  // Reading the same version again resumes from its checkpoint and charges nothing.
  await processDocument(documentId, context.officeId);
  assert.match(await text(), /Protocolar recurso em 30\/10\/2026/i);
  assert.equal(await ocrCharges(), 2);
});

test('a Word guide made of screenshots is read by OCR in the Cofre, once, and only there', async () => {
  const office = randomUUID(), user = randomUUID(), document = randomUUID();
  await testDb.prepare('INSERT INTO office(id,name) VALUES (?,?)').run(office, 'OCR DOCX');
  await testDb.prepare('INSERT INTO "user"(id,email,name) VALUES (?,?,?)').run(user, `${user}@example.test`, 'QA');
  const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  await testDb.prepare(`INSERT INTO vault_document(id,office_id,scope,original_name,stored_name,mime_type,byte_size,sha256,created_by)
    VALUES (?,?,'library','guia.docx',?,?,1,'qa',?)`).run(document, office, `${office}/${document}/guia.docx`, mime, user);
  // A screenshot: dark text on white, the way a pasted system screen looks.
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(900, 160);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, 900, 160);
  context.fillStyle = '#111111'; context.font = '48px sans-serif';
  context.fillText('Prorrogar prazo em 30/09/2026', 30, 100);
  const { Document, Packer, Paragraph, ImageRun } = await import('docx');
  const word = Buffer.from(await Packer.toBuffer(new Document({ sections: [{ children: [
    new Paragraph({ children: [new ImageRun({ type: 'png', data: canvas.toBuffer('image/png'), transformation: { width: 450, height: 80 } })] }),
  ] }] })));

  // The chat reads the pictures themselves, so it never pays for OCR.
  assert.deepEqual(await extractDocumentSections(word, mime, 'guia.docx', document), []);
  const sections = await extractDocumentSections(word, mime, 'guia.docx', document, { ocrImages: true });
  assert.equal(sections.length, 1);
  assert.equal(sections[0].reference, 'imagem:1');
  assert.match(sections[0].content, /Prorrogar prazo em 30\/09\/2026/i);
  // A retry resumes from the checkpoint instead of recognising the picture again.
  assert.deepEqual(await extractDocumentSections(word, mime, 'guia.docx', document, { ocrImages: true }), sections);
  assert.equal((await testDb.prepare('SELECT count(*) AS total FROM vault_document_checkpoint WHERE document_id=?').get(document))!.total, 1);
});

test('a phone scan with oversized pages is read at a reduced scale instead of refused', async () => {
  const office = randomUUID(), user = randomUUID(), document = randomUUID();
  await testDb.prepare('INSERT INTO office(id,name) VALUES (?,?)').run(office, 'OCR scan');
  await testDb.prepare('INSERT INTO "user"(id,email,name) VALUES (?,?,?)').run(user, `${user}@example.test`, 'QA');
  await testDb.prepare(`INSERT INTO vault_document(id,office_id,scope,original_name,stored_name,mime_type,byte_size,sha256,created_by)
    VALUES (?,?,'library','scan.pdf',?,'application/pdf',1,'qa',?)`).run(document, office, `${office}/${document}/scan.pdf`, user);
  // Scanner apps write one point per pixel of the photo: 3024 x 4032 is 27 million pixels at 1.5x.
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(1512, 2016);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, 1512, 2016);
  context.fillStyle = '#111111'; context.font = '64px sans-serif';
  context.fillText('Laudo pericial em 12/09/2026', 80, 300);
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([3024, 4032]);
  page.drawImage(await pdf.embedPng(canvas.toBuffer('image/png')), { x: 0, y: 0, width: 3024, height: 4032 });
  const progress: number[] = [];
  const sections = await extractDocumentSections(Buffer.from(await pdf.save()), 'application/pdf', 'scan.pdf', document, { onProgress: done => { progress.push(done); } });
  assert.equal(sections.length, 1);
  assert.match(sections[0].content, /Laudo pericial em 12\/09\/2026/i);
  assert.deepEqual(progress, [1]);
});

test('the OCR scale keeps ordinary pages at 1.5x and shrinks oversized ones to the pixel budget', async () => {
  const { ocrViewport, MAX_OCR_PIXELS } = await import('../src/lib/ocr-worker');
  const page = (width: number, height: number) => ({ getViewport: ({ scale }: { scale: number }) => ({ width: width * scale, height: height * scale, scale }) });
  assert.equal(ocrViewport(page(595, 842)).scale, 1.5);
  const scan = ocrViewport(page(3024, 4032));
  assert.ok(scan.scale < 1);
  assert.ok(Math.ceil(scan.width) * Math.ceil(scan.height) <= MAX_OCR_PIXELS * 1.001);
});
