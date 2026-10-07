import 'server-only';
import { outboundText } from '@/lib/documents/shared-writing';
import { assertExternalDelivery } from '@/lib/content-policy';
import { documentTransaction } from '@/lib/documents/service';
import { createHash, randomUUID } from 'node:crypto';
import { database, withTransaction } from '@/lib/database';
import type { WorkspaceContext } from '@/lib/application/context';
import { requireAgentApproval } from '@/lib/application/approvals-service';
import { CapabilityError } from '@/lib/capabilities/errors';
import { isReplyWindowOpen, sendInput, type ConnectionRow, type SendInput, type SendReceipt } from './domain';
import { authorizeWhatsApp, connectedCredential, requireWhatsApp } from './connection';
import { sendProviderAttachment, sendProviderText } from './provider';
import { attachmentForSend, projectAttachments, readSendAttachment } from './media';
import { ZernioError } from './transport';
import { reserveWhatsAppApiCall } from './limits';
import { enqueueWhatsAppJob } from './jobs';
import { wakeWhatsAppWorker } from './wake';

type SendRow = { id: string; thread_id: string; user_id: string; input_hash: string; status: SendReceipt['status']; error: string | null; created_at: string };
type Recipient = { id: string; provider_id: string; participant_id: string; participant_name: string; last_customer_message_at: string | null };
const receipt = (row: SendRow): SendReceipt => ({ id: row.id, threadId: row.thread_id, status: row.status, error: row.error });

export async function sendWhatsAppText(context: WorkspaceContext, rawInput: SendInput): Promise<SendReceipt> {
  const input = sendInput.parse(rawInput);
  const writing = await outboundText(context, 'k5_whatsapp_send', { threadId: input.threadId }, '', input.text);
  input.text = writing.content;
  const connection = await requireWhatsApp(context, { write: true });
  const thread = await database.prepare(`SELECT id,provider_id,participant_id,participant_name,last_customer_message_at
    FROM whatsapp_thread WHERE id=? AND office_id=? AND connection_id=? AND account_id=?`)
    .get<Recipient>(input.threadId, context.officeId, connection.id, connection.account_id);
  if (!thread) throw new CapabilityError('NOT_FOUND', 'Conversa não encontrada neste escritório.');
  const attachment = input.attachmentId ? await attachmentForSend(context, connection, thread.id, input.attachmentId) : null;
  if (attachment?.kind === 'audio' && input.text) throw new CapabilityError('INVALID', 'Envie o áudio sem legenda.');
  const normalized = {
    threadId: input.threadId, text: input.text, idempotencyKey: input.idempotencyKey,
    connectionId: connection.id, generation: connection.generation, recipientId: thread.participant_id,
    ...(attachment ? { attachment: { id: attachment.id, sha256: attachment.sha256, filename: attachment.filename,
      mimeType: attachment.mime_type, byteLength: attachment.byte_length, kind: attachment.kind } } : {}),
  };
  const inputHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  function checkExisting(row: SendRow) {
    if (row.input_hash !== inputHash || row.user_id !== context.userId) throw new CapabilityError('CONFLICT', 'Esta solicitação já foi usada para outro envio.');
    return receipt(row);
  }
  const existing = await database.prepare('SELECT * FROM whatsapp_send WHERE office_id=? AND idempotency_key=?').get<SendRow>(context.officeId, input.idempotencyKey);
  if (existing) return checkExisting(existing);
  if (attachment?.send_id) throw new CapabilityError('CONFLICT', 'Este arquivo já pertence a um envio. Escolha o arquivo novamente.');
  if (!isReplyWindowOpen(thread.last_customer_message_at)) throw new CapabilityError('SCOPE_REQUIRED', 'A janela de atendimento terminou ou ainda não foi confirmada. Continue pelo WhatsApp Business.');
  await requireAgentApproval(context, 'k5_whatsapp_send', input.approvalId, normalized, thread.id,
    `Enviar pelo WhatsApp para ${thread.participant_name || thread.participant_id} (${thread.participant_id}): ${input.text}${attachment
      ? `\nArquivo: ${attachment.filename} (${attachment.mime_type}, ${attachment.byte_length} bytes). SHA-256: ${attachment.sha256}` : ''}`);
  const claimed = await documentTransaction(context, async tx => {
    await assertExternalDelivery(context.userId, writing.policy, tx);
    const active = await tx.prepare("SELECT generation FROM whatsapp_connection WHERE id=? AND office_id=? AND status='connected' FOR UPDATE")
      .get<{ generation: number }>(connection.id, context.officeId);
    if (!active || active.generation !== connection.generation) throw new CapabilityError('CONFLICT', 'A conexão mudou. Prepare a resposta novamente.');
    const row = await tx.prepare(`INSERT INTO whatsapp_send(id,office_id,connection_id,generation,thread_id,user_id,idempotency_key,input_hash,text,status,attachment_id,content_policy)
      VALUES(?,?,?,?,?,?,?,?,?,'dispatching',?,?::jsonb) ON CONFLICT(office_id,idempotency_key) DO NOTHING RETURNING *`)
      .get<SendRow>(randomUUID(), context.officeId, connection.id, connection.generation, thread.id, context.userId, input.idempotencyKey, inputHash, input.text, attachment?.id ?? null, JSON.stringify(writing.policy));
    if (row) {
      if (attachment) {
        const reserved = await tx.prepare(`UPDATE whatsapp_attachment SET send_id=?,expires_at=NULL,updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND office_id=? AND user_id=? AND connection_id=? AND generation=? AND thread_id=? AND state='ready'
            AND send_id IS NULL AND message_id IS NULL AND expires_at>CURRENT_TIMESTAMP AND sha256=? RETURNING id`)
          .get(row.id, attachment.id, context.officeId, context.userId, connection.id, connection.generation, thread.id, attachment.sha256);
        if (!reserved) throw new CapabilityError('CONFLICT', 'Este arquivo expirou ou já pertence a outro envio.');
      }
      return { kind: 'new' as const, row };
    }
    const previous = await tx.prepare('SELECT * FROM whatsapp_send WHERE office_id=? AND idempotency_key=?').get<SendRow>(context.officeId, input.idempotencyKey);
    if (!previous) throw new CapabilityError('CONFLICT', 'Atualize a conversa para conferir o envio.');
    return { kind: 'existing' as const, result: checkExisting(previous) };
  });
  if (claimed.kind === 'existing') return claimed.result;
  let dispatched = false;
  try {
    const file = attachment ? await readSendAttachment(attachment) : null;
    await reserveWhatsAppApiCall(context.officeId);
    await authorizeWhatsApp(context, { write: true });
    const current = await database.prepare("SELECT * FROM whatsapp_connection WHERE id=? AND office_id=? AND status='connected' AND generation=?")
      .get<ConnectionRow>(connection.id, context.officeId, connection.generation);
    const latest = await database.prepare('SELECT last_customer_message_at FROM whatsapp_thread WHERE id=? AND office_id=? AND account_id=?')
      .get<{ last_customer_message_at: string | null }>(thread.id, context.officeId, connection.account_id);
    if (!current || !current.account_id) throw new CapabilityError('CONFLICT', 'A conexão mudou. Prepare a resposta novamente.');
    if (!latest || !isReplyWindowOpen(latest.last_customer_message_at)) throw new CapabilityError('SCOPE_REQUIRED', 'A janela de atendimento terminou. Continue pelo WhatsApp Business.');
    const credential = connectedCredential(current);
    await assertExternalDelivery(context.userId, writing.policy);
    dispatched = true;
    const result = file
      ? await sendProviderAttachment(credential, current.account_id, thread.provider_id, file, input.text, claimed.row.id)
      : await sendProviderText(credential, current.account_id, thread.provider_id, input.text, claimed.row.id);
    await withTransaction(async tx => {
      await tx.prepare('SELECT id FROM whatsapp_connection WHERE id=? AND office_id=? FOR UPDATE').get(current.id, context.officeId);
      await tx.prepare('SELECT id FROM whatsapp_thread WHERE id=? AND office_id=? FOR UPDATE').get(thread.id, context.officeId);
      await tx.prepare("UPDATE whatsapp_send SET provider_id=?,status='accepted',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('dispatching','unknown')")
        .run(result.messageId, claimed.row.id);
      if (attachment) {
        const echoed = await tx.prepare('SELECT id,deleted FROM whatsapp_message WHERE thread_id=? AND office_id=? AND provider_id=?')
          .get<{ id: string; deleted: boolean }>(thread.id, context.officeId, result.messageId);
        if (echoed) await projectAttachments(tx, current, echoed.id, thread.id, [], { deleted: echoed.deleted, replace: false, sendId: claimed.row.id });
      }
      await tx.prepare('UPDATE whatsapp_thread SET last_text=?,last_message_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND last_message_at<=?')
        .run(input.text, claimed.row.created_at, thread.id, context.officeId, claimed.row.created_at);
      await enqueueWhatsAppJob(tx, { officeId: context.officeId, connectionId: current.id, generation: current.generation, kind: 'history_refresh', subjectId: thread.id, dedupeKey: `history_refresh:${thread.id}` });
    });
  } catch (error) {
    const uncertain = dispatched && (!(error instanceof ZernioError) || error.isAmbiguous);
    const status = uncertain ? 'unknown' : 'failed';
    const message = uncertain
      ? 'Não foi possível confirmar o envio. Confira a conversa antes de tentar novamente.'
      : error instanceof CapabilityError ? error.message : 'A mensagem não foi enviada. Confira a conexão e a janela de atendimento.';
    await withTransaction(async tx => {
      const failed = await tx.prepare("UPDATE whatsapp_send SET status=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='dispatching' RETURNING id")
        .get(status, message, claimed.row.id);
      if (failed && status === 'failed' && attachment) await tx.prepare(`UPDATE whatsapp_attachment SET send_id=NULL,
        expires_at=CURRENT_TIMESTAMP+INTERVAL '30 minutes',updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND office_id=? AND send_id=? AND message_id IS NULL`)
        .run(attachment.id, context.officeId, claimed.row.id);
    });
    if (error instanceof ZernioError && error.status === 401) {
      await database.prepare("UPDATE whatsapp_connection SET status='reconnect_required',generation=generation+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND generation=? AND status='connected'").run(connection.id, connection.generation);
    }
    if (error instanceof CapabilityError) throw error;
  }
  await wakeWhatsAppWorker();
  const final = await database.prepare('SELECT * FROM whatsapp_send WHERE id=? AND office_id=?').get<SendRow>(claimed.row.id, context.officeId);
  if (!final) throw new CapabilityError('CONFLICT', 'Atualize a conversa para conferir o envio.');
  return receipt(final);
}
