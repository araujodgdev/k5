import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extractDocumentSections } from '../src/lib/document-extraction';

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
  assert.equal((await testDb.prepare("SELECT count(*) AS total FROM vault_document_checkpoint WHERE document_id=? AND stable_reference='imagem:1'").get(document))!.total, 1);
});
