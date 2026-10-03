import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase as db } from './test-setup';
import { createConversation, updateArtifact, ownedArtifact } from '../src/lib/ai-store';
import { createChatAttachment, claimChatAttachments, resolveChatAttachments } from '../src/lib/chat-attachments';
import { attachmentPart } from '../src/lib/chat-attachment-contract';
import { chatPromptMessages } from '../src/lib/chat-prompt';
import { importChatAttachment } from '../src/lib/application/vault-service';
import { createArtifact, exportArtifactPdf } from '../src/lib/application/artifacts-service';
import { humanChecklist, decideHumanReview } from '../src/lib/document-human-review';
import { objectStorage } from '../src/lib/storage';
import { findVaultDocument, readVaultDocumentFile } from '../src/lib/vault';
import { renderPdfcnDocument } from '../src/lib/document-pdfcn-node';
import { PDFDocument } from 'pdf-lib';
import { extractText } from 'unpdf';
import { candidateSources, findCitationSpans } from '../src/lib/citations/detect';
import { composeCitation } from '../src/lib/citations/verdict';

async function owner() {
  const officeId=randomUUID(), userId=randomUUID();
  await db.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId,'Validação do agente');
  await db.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId,`${userId}@example.test`,'Teste');
  return {officeId,userId};
}

test('chat import copies the original, serializes retries, validates source and keeps bytes after chat deletion', async()=>{
  const context=await owner();
  const conversation=await createConversation(db,context);
  const pdf=await PDFDocument.create();
  pdf.addPage().drawText('Contrato de teste');
  const original=new Uint8Array(await pdf.save());
  const file=await createChatAttachment(context,conversation.id,new File([original],'contrato.pdf',{type:'application/pdf'}));
  await claimChatAttachments(context,conversation.id,'msg',await resolveChatAttachments(context,conversation.id,'msg',[file.id]));
  const prompt=await chatPromptMessages(context,conversation.id,[{id:'msg',role:'user',parts:[{type:'text',text:'Salve no Cofre'},attachmentPart(file)]}],false);
  assert.ok(JSON.stringify(prompt).includes(`attachmentId: ${file.id}`));
  const scoped={...context,conversationId:conversation.id};
  const input={attachmentId:file.id,scope:'library' as const};
  const [first,second]=await Promise.all([importChatAttachment(scoped,input),importChatAttachment(scoped,input)]);
  assert.equal(first.document.id,second.document.id);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM vault_document WHERE office_id=?').get(context.officeId))?.n,1);
  await assert.rejects(importChatAttachment({...scoped,conversationId:randomUUID()},input));
  await assert.rejects(importChatAttachment({...scoped,userId:randomUUID()},input));
  await assert.rejects(importChatAttachment(scoped,{...input,scope:'case',caseId:randomUUID()}));
  const row=await db.prepare('SELECT storage_key FROM ai_chat_attachment WHERE id=?').get<{storage_key:string}>(file.id);
  assert.ok(row);
  const document=await findVaultDocument(context.officeId,first.document.id,context.userId);
  assert.ok(document);
  await (await objectStorage()).delete(row.storage_key);
  await db.prepare('DELETE FROM ai_conversation WHERE id=?').run(conversation.id);
  assert.deepEqual(new Uint8Array((await readVaultDocumentFile(context.officeId,document.id,context.userId)).buffer),original);
  assert.ok(await db.prepare('SELECT 1 FROM vault_agent_origin WHERE document_id=?').get(document.id));
});

test('human decisions persist separately, reject stale concurrent writes and require new review after editing',async()=>{
  const context=await owner();
  const created=await createArtifact(context,{title:'Contrato',content:'As partes devem conferir percentuais e aportes.'});
  const artifact=await ownedArtifact(db,context,created.artifact.id);
  assert.ok(artifact);
  const checklist=await humanChecklist(context,artifact), item=checklist.items[0];
  const input={version:artifact.version,itemKey:item.key,decision:'confirmed' as const,note:'Dados conferidos.',revision:0};
  await decideHumanReview(context,artifact,input);
  assert.equal((await humanChecklist(context,artifact)).items[0].decision,'confirmed');
  await assert.rejects(decideHumanReview(context,artifact,input),/outra aba/);
  assert.equal(await ownedArtifact(db,{...context,userId:randomUUID()},artifact.id),undefined);
  const updated=await updateArtifact(db,context,artifact.id,artifact.title,'Texto com participação alterada.',artifact.version);
  assert.ok(updated);
  assert.equal((await humanChecklist(context,updated)).items[0].decision,'pending');
  await assert.rejects(decideHumanReview(context,artifact,{...input,revision:1}),/documento mudou/);
  await assert.rejects(exportArtifactPdf(context,{artifactId:artifact.id,version:artifact.version}),/documento mudou/);
});

test('PDFcn produces a multipage A4 PDF with Portuguese text, table, source link and final clause',async()=>{
  const content='# Contrato de ingresso\n\nCliente José, participação de 20%, obrigação de R$ 1.250,00.\n\n[Fonte oficial](https://www.planalto.gov.br)\n\n| Sócio | Aporte |\n| --- | --- |\n| Enéias | R$ 2.000,00 |\n\n'+Array.from({length:100},(_,i)=>`Cláusula ${i+1}. Responsabilidade e condições para conferência do advogado.`).join('\n\n');
  const bytes=await renderPdfcnDocument({title:'Contrato de ingresso',content});
  const document=await PDFDocument.load(bytes);
  assert.ok(document.getPageCount()>1);
  assert.ok(Math.abs(document.getPage(0).getWidth()-595.28)<1);
  const result=await extractText(new Uint8Array(bytes),{mergePages:true});
  assert.match(result.text,/José/); assert.match(result.text,/Enéias/); assert.match(result.text,/Cláusula 100/);
  assert.ok(document.getPages().some(page=>page.node.Annots()?.size()));
});

test('a citation link identifies a candidate but cannot by itself verify the cited claim',()=>{
  const span=findCitationSpans('Aplicável o art. 989 do Código Civil.')[0];
  const candidates=candidateSources(span.text,[{id:'law',kind:'web',title:'Código Civil',url:'https://www.planalto.gov.br/codigo#art989',text:''}]);
  assert.equal(candidates.length,1);
  const item=composeCitation(span,candidates);
  assert.equal(item?.status,'unchecked'); assert.equal(item?.source?.hasContent,false);
});
