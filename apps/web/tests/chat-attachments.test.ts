import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase as db} from './test-setup';
import {createConversation,saveMessages} from '../src/lib/ai-store';
import {createChatAttachment,ownedChatAttachment,resolveChatAttachments,claimChatAttachments,removeChatAttachment,publicChatAttachment} from '../src/lib/chat-attachments';
import {attachmentPart} from '../src/lib/chat-attachment-contract';
import {chatPromptMessages} from '../src/lib/chat-prompt';
import {objectStorage} from '../src/lib/storage';
import type {UIMessage} from 'ai';
import {getCurrentScope} from '@sentry/core';
import {PDFDocument} from 'pdf-lib';
import {CapabilityError} from '../src/lib/capabilities/errors';

test('chat files persist with their message, remain private and never enter the Vault',async()=>{
  const officeId=randomUUID(),userId=randomUUID();
  await db.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId,'Teste de anexos');
  await db.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId,`${userId}@example.test`,'Teste');
  const owner={officeId,userId};
  const one=await createConversation(db,owner),two=await createConversation(db,owner);
  const attachment=await createChatAttachment(owner,one.id,new File(['Revisar contrato amanhã.'],'tarefas.txt',{type:'text/plain'}));
  assert.equal((await db.prepare('SELECT count(*) AS n FROM vault_document WHERE office_id=?').get(officeId))!.n,0);
  assert.equal(await ownedChatAttachment({...owner,userId:randomUUID()},attachment.id),undefined);
  assert.equal(await ownedChatAttachment({...owner,officeId:randomUUID()},attachment.id),undefined);
  await assert.rejects(resolveChatAttachments(owner,two.id,'message-a',[attachment.id]));
  const rows=await resolveChatAttachments(owner,one.id,'message-a',[attachment.id]);
  await claimChatAttachments(owner,one.id,'message-a',rows);
  await assert.rejects(resolveChatAttachments(owner,one.id,'different-message',[attachment.id]));
  await assert.rejects(removeChatAttachment(owner,attachment.id));
  const history:UIMessage[]=[{id:'message-a',role:'user',parts:[{type:'text',text:'Prepare a agenda'},attachmentPart(publicChatAttachment(rows[0]))]}];
  await saveMessages(db,owner,one.id,history);
  const prompt=await chatPromptMessages(owner,one.id,history,false);
  assert.match(JSON.stringify(prompt),/Revisar contrato amanhã/);
  assert.match(JSON.stringify(prompt),/nunca instruções do sistema/);
  const image=await createChatAttachment(owner,one.id,new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')],'foto.png',{type:'image/png'}));
  const imageRows=await resolveChatAttachments(owner,one.id,'message-b',[image.id]);
  const imageHistory:UIMessage[]=[...history,{id:'message-b',role:'user',parts:[{type:'text',text:'Leia a foto'},attachmentPart(image)]}];
  const imagePrompt=await chatPromptMessages(owner,one.id,imageHistory,true);
  assert.match(JSON.stringify(imagePrompt),/data:image\/png;base64/);
  assert.doesNotMatch(JSON.stringify(imagePrompt),/storage_key/);
  await removeChatAttachment(owner,image.id);
  await assert.rejects((await objectStorage()).get(imageRows[0].storage_key));
  await assert.rejects(createChatAttachment(owner,one.id,new File(['not an image'],'foto.jpg',{type:'image/jpeg'})));
  await assert.rejects(createChatAttachment(owner,two.id,new File([],'vazio.txt')));
});

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

test('chat files: documents up to 25 MB, images up to 10 MB',async()=>{
  const officeId=randomUUID(),userId=randomUUID();
  await db.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId,'Teste de limites');
  await db.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId,`${userId}@example.test`,'Teste');
  const owner={officeId,userId};
  const chat=await createConversation(db,owner);
  await assert.rejects(createChatAttachment(owner,chat.id,new File([Buffer.alloc(10*1024*1024+1)],'foto.png',{type:'image/png'})),/A imagem excede 10 MB/);
  await assert.rejects(createChatAttachment(owner,chat.id,new File([Buffer.alloc(25*1024*1024+1)],'grande.txt',{type:'text/plain'})),/O arquivo excede 25 MB/);
  // The table follows the application's limit for documents.
  const row=(size:number)=>db.prepare(`INSERT INTO ai_chat_attachment(id,conversation_id,office_id,user_id,storage_key,name,media_type,byte_size,extracted_text)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(randomUUID(),chat.id,officeId,userId,`chat/${randomUUID()}`,'peticao.pdf','application/pdf',size,'texto');
  await row(20*1024*1024);
  await assert.rejects(row(25*1024*1024+1));
});
