import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase as db} from './test-setup';
import {createConversation} from '../src/lib/ai-store';
import {createChatAttachment} from '../src/lib/chat-attachments';
import {getCurrentScope} from '@sentry/core';
import {PDFDocument} from 'pdf-lib';
import {CapabilityError} from '../src/lib/capabilities/errors';

// Alone in its file: the Workers path loads unpdf, whose bundled PDF.js breaks pdfjs-dist for the
// rest of the process, so no PDF can be read on the Node path after it.
test('chat files (LUME-N): a scanned PDF on Workers explains the OCR route and is not reported as a failure',async t=>{
  const officeId=randomUUID(),userId=randomUUID();
  await db.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId,'Teste de OCR');
  await db.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId,`${userId}@example.test`,'Teste');
  const owner={officeId,userId};
  const chat=await createConversation(db,owner);
  const captured:unknown[]=[];
  t.mock.method(getCurrentScope(),'captureException',(error:unknown)=>{captured.push(error);return 'test-event';});
  // A page with no text layer: what a scanner produces.
  const pdf=await PDFDocument.create();pdf.addPage();
  const scanned=new File([Buffer.from(await pdf.save())],'digitalizado.pdf',{type:'application/pdf'});
  const previous={runtime:process.env.K5_RUNTIME,ocr:process.env.VAULT_OCR_URL};
  process.env.K5_RUNTIME='cloudflare';delete process.env.VAULT_OCR_URL;
  try {
    await assert.rejects(createChatAttachment(owner,chat.id,scanned),(error:unknown)=>
      error instanceof CapabilityError&&error.code==='INVALID'&&/precisa de OCR/.test(error.message)&&/Cofre/.test(error.message));
  } finally {
    if (previous.runtime===undefined) delete process.env.K5_RUNTIME; else process.env.K5_RUNTIME=previous.runtime;
    if (previous.ocr!==undefined) process.env.VAULT_OCR_URL=previous.ocr;
  }
  assert.equal(captured.length,0,'an expected limitation is not an incident');
  // A file that genuinely cannot be read is still reported.
  await assert.rejects(createChatAttachment(owner,chat.id,new File([Buffer.from('%PDF-1.7 corrompido')],'quebrado.pdf',{type:'application/pdf'})),CapabilityError);
  assert.equal(captured.length,1);
});
