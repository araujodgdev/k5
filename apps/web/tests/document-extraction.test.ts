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
