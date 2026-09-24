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

// A 1×1 PNG, the smallest picture a Word document can carry.
const PIXEL=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
async function wordFile(name:string,children:Array<import('docx').Paragraph>) {
  const {Document,Packer}=await import('docx');
  return new File([new Uint8Array(await Packer.toBuffer(new Document({sections:[{children}]})))],name,{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}

test('chat files: a Word document made of pictures reaches the model as those pictures',async()=>{
  const {Paragraph,ImageRun}=await import('docx');
  const officeId=randomUUID(),userId=randomUUID();
  await db.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId,'Teste de imagens no Word');
  await db.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId,`${userId}@example.test`,'Teste');
  const owner={officeId,userId};
  const chat=await createConversation(db,owner);
  // Word stores identical pictures once, so each one differs by a trailing byte past IEND.
  const picture=(n:number)=>new Paragraph({children:[new ImageRun({type:'png',data:Buffer.concat([PIXEL,Buffer.from([n])]),transformation:{width:10,height:10}})]});
  const attachment=await createChatAttachment(owner,chat.id,await wordFile('guia.docx',[picture(1),picture(2)]));
  const history:UIMessage[]=[{id:'message-w',role:'user',parts:[{type:'text',text:'Leia o guia'},attachmentPart(attachment)]}];
  const withVision=JSON.stringify(await chatPromptMessages(owner,chat.id,history,true));
  assert.equal(withVision.match(/data:image\/png;base64/g)?.length,2,'both pictures, in reading order');
  assert.match(withVision,/2 imagens/);
  // Without vision the model is told what it cannot see, instead of receiving nothing.
  const withoutVision=JSON.stringify(await chatPromptMessages(owner,chat.id,history,false));
  assert.doesNotMatch(withoutVision,/data:image/);
  assert.match(withoutVision,/não permite ler imagens/);
  // A Word file with neither text nor pictures is still refused.
  await assert.rejects(createChatAttachment(owner,chat.id,await wordFile('vazio.docx',[new Paragraph({})])),/não contém texto legível/);
});

test('chat files: long documents fit, and an overfull history drops its oldest file instead of failing',async()=>{
  const {Paragraph}=await import('docx');
  const officeId=randomUUID(),userId=randomUUID();
  await db.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId,'Teste de documentos longos');
  await db.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId,`${userId}@example.test`,'Teste');
  const owner={officeId,userId};
  const chat=await createConversation(db,owner);
  // About 130 thousand characters: a real manual, past the old 120 thousand ceiling.
  const long=(label:string)=>wordFile(`${label}.docx`,Array.from({length:1300},(_,i)=>new Paragraph(`${label} parágrafo ${i} `+'texto do procedimento '.repeat(4))));
  const first=await createChatAttachment(owner,chat.id,await long('primeiro'));
  const second=await createChatAttachment(owner,chat.id,await long('segundo'));
  const third=await createChatAttachment(owner,chat.id,await long('terceiro'));
  const history:UIMessage[]=[first,second,third].map((file,i)=>({id:`message-${i}`,role:'user',parts:[{type:'text',text:`Anexo ${i}`},attachmentPart(file)]}));
  const prompt=JSON.stringify(await chatPromptMessages(owner,chat.id,history,false));
  assert.match(prompt,/terceiro parágrafo 1299/,'the newest file is read in full');
  assert.match(prompt,/segundo parágrafo 1299/);
  assert.doesNotMatch(prompt,/primeiro parágrafo 1299/,'the oldest file gives way');
  assert.match(prompt,/primeiro\.docx.*fora desta resposta/);
  await assert.rejects(createChatAttachment(owner,chat.id,new File(['a'.repeat(300_001)],'enorme.txt',{type:'text/plain'})),/longo demais/);
});
