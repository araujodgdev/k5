import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from './database';
import { objectStorage, storageKey } from './storage';
import { validatedFileName } from './application/uploads-service';
import { extractDocumentSections } from './document-extraction';
import { CapabilityError } from './capabilities/errors';
import { captureOperationalError } from './observability/report';
import { imageMatchesType } from './image-signature';
import { type Owner, conversation } from './ai-store';
import { MAX_CHAT_ATTACHMENTS, MAX_CHAT_FILE_BYTES, MAX_CHAT_IMAGE_BYTES, type ChatAttachment } from './chat-attachment-contract';

export type ChatAttachmentRow = {
  id:string; conversation_id:string; office_id:string; user_id:string; message_id:string|null;
  storage_key:string; name:string; media_type:string; byte_size:number; extracted_text:string;
};
export function publicChatAttachment(row: ChatAttachmentRow): ChatAttachment {
  return {id:row.id,name:row.name,mediaType:row.media_type,byteSize:row.byte_size,url:`/api/chat/attachments/${row.id}`};
}
export async function ownedChatAttachment(owner: Owner, id: string) {
  return database.prepare('SELECT * FROM ai_chat_attachment WHERE id=? AND office_id=? AND user_id=?').get<ChatAttachmentRow>(id,owner.officeId,owner.userId);
}
export async function createChatAttachment(owner: Owner, conversationId: string, file: File) {
  if (!await conversation(database,owner,conversationId)) throw new CapabilityError('NOT_FOUND','Conversa não encontrada.');
  const {file:name,extension,mimeType}=validatedFileName(file.name);
  const limit=mimeType.startsWith('image/')?MAX_CHAT_IMAGE_BYTES:MAX_CHAT_FILE_BYTES;
  const tooLarge=mimeType.startsWith('image/')?'A imagem excede 10 MB.':'O arquivo excede 25 MB.';
  if (!file.size) throw new CapabilityError('INVALID','O arquivo está vazio.');
  if (file.size>limit) throw new CapabilityError('INVALID',tooLarge);
  const bytes=Buffer.from(await file.arrayBuffer());
  if (bytes.length>limit) throw new CapabilityError('INVALID',tooLarge);
  if (mimeType.startsWith('image/') && !imageMatchesType(bytes,mimeType)) throw new CapabilityError('INVALID','A imagem não corresponde ao formato informado.');
  const id=randomUUID();
  let extracted='';
  if (!mimeType.startsWith('image/')) {
    try { extracted=(await extractDocumentSections(bytes,mimeType,name,id)).map(part=>`${part.reference}: ${part.content}`).join('\n\n'); }
    catch(error) { captureOperationalError(error,'chat.attachment.extract'); throw new CapabilityError('INVALID','Não foi possível ler este arquivo. Para uma página escaneada, envie uma foto ou imagem.'); }
    if (!extracted.trim()) throw new CapabilityError('INVALID','O arquivo não contém texto legível. Envie uma foto ou outro arquivo.');
    if (extracted.length>120_000) throw new CapabilityError('INVALID','Este arquivo é longo demais para um anexo de chat. Adicione-o ao Cofre e selecione-o em Fontes.');
  }
  const key=storageKey(owner.officeId,id,extension);
  const storage=await objectStorage();
  await storage.put(key,bytes);
  try {
    const row=await database.prepare(`INSERT INTO ai_chat_attachment(id,conversation_id,office_id,user_id,storage_key,name,media_type,byte_size,extracted_text)
      VALUES(?,?,?,?,?,?,?,?,?) RETURNING *`).get<ChatAttachmentRow>(id,conversationId,owner.officeId,owner.userId,key,name,mimeType,bytes.length,extracted);
    return publicChatAttachment(row!);
  } catch(error) {await storage.delete(key).catch(()=>undefined);throw error;}
}

/** References are scoped to both the conversation and its owner; the browser supplies no paths or text. */
export async function resolveChatAttachments(owner: Owner, conversationId:string, messageId:string, ids:string[]) {
  if (ids.length>MAX_CHAT_ATTACHMENTS || new Set(ids).size!==ids.length) throw new CapabilityError('INVALID','Anexe até seis arquivos diferentes por mensagem.');
  const rows:ChatAttachmentRow[]=[];
  for (const id of ids) {
    const row=await ownedChatAttachment(owner,id);
    if (!row || row.conversation_id!==conversationId || (row.message_id && row.message_id!==messageId)) throw new CapabilityError('NOT_FOUND','Anexo indisponível nesta mensagem.');
    rows.push(row);
  }
  return rows;
}
export async function claimChatAttachments(owner: Owner, conversationId:string, messageId:string, rows:ChatAttachmentRow[]) {
  for (const row of rows) {
    const result=await database.prepare(`UPDATE ai_chat_attachment SET message_id=? WHERE id=? AND conversation_id=? AND office_id=? AND user_id=? AND (message_id IS NULL OR message_id=?)`)
      .run(messageId,row.id,conversationId,owner.officeId,owner.userId,messageId);
    if (!result.changes) throw new CapabilityError('CONFLICT','O anexo mudou durante o envio. Tente novamente.');
  }
}
export async function removeChatAttachment(owner:Owner,id:string) {
  const row=await database.prepare('DELETE FROM ai_chat_attachment WHERE id=? AND office_id=? AND user_id=? AND message_id IS NULL RETURNING *').get<ChatAttachmentRow>(id,owner.officeId,owner.userId);
  if (!row) throw new CapabilityError('NOT_FOUND','Anexo indisponível para remoção.');
  await (await objectStorage()).delete(row.storage_key).catch(error=>captureOperationalError(error,'chat.attachment.delete'));
}
