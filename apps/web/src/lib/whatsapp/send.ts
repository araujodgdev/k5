import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { database, withTransaction } from '@/lib/database';
import type { WorkspaceContext } from '@/lib/application/context';
import { requireAgentApproval } from '@/lib/application/approvals-service';
import { CapabilityError } from '@/lib/capabilities/errors';
import { isReplyWindowOpen, sendInput, type ConnectionRow, type SendInput, type SendReceipt } from './domain';
import { authorizeWhatsApp, connectedCredential, requireWhatsApp } from './connection';
import { sendProviderText } from './provider';
import { ZernioError } from './transport';
import { reserveWhatsAppApiCall } from './limits';
import { enqueueWhatsAppJob } from './jobs';
import { wakeWhatsAppWorker } from './wake';

type SendRow = { id: string; thread_id: string; user_id: string; input_hash: string; status: SendReceipt['status']; error: string | null; created_at: string };
type Recipient = { id: string; provider_id: string; participant_id: string; participant_name: string; last_customer_message_at: string | null };
const receipt = (row: SendRow): SendReceipt => ({ id: row.id, threadId: row.thread_id, status: row.status, error: row.error });

export async function sendWhatsAppText(context: WorkspaceContext, rawInput: SendInput): Promise<SendReceipt> {
  const input = sendInput.parse(rawInput);
  const connection = await requireWhatsApp(context, { write: true });
  const thread = await database.prepare(`SELECT id,provider_id,participant_id,participant_name,last_customer_message_at
    FROM whatsapp_thread WHERE id=? AND office_id=? AND connection_id=? AND account_id=?`)
    .get<Recipient>(input.threadId, context.officeId, connection.id, connection.account_id);
  if (!thread) throw new CapabilityError('NOT_FOUND', 'Conversa não encontrada neste escritório.');
  const normalized = {
    threadId: input.threadId, text: input.text, idempotencyKey: input.idempotencyKey,
    connectionId: connection.id, generation: connection.generation, recipientId: thread.participant_id,
  };
  const inputHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  function checkExisting(row: SendRow) {
    if (row.input_hash !== inputHash || row.user_id !== context.userId) throw new CapabilityError('CONFLICT', 'Esta solicitação já foi usada para outro envio.');
    return receipt(row);
  }
  const existing = await database.prepare('SELECT * FROM whatsapp_send WHERE office_id=? AND idempotency_key=?').get<SendRow>(context.officeId, input.idempotencyKey);
  if (existing) return checkExisting(existing);
  if (!isReplyWindowOpen(thread.last_customer_message_at)) throw new CapabilityError('SCOPE_REQUIRED', 'A janela de atendimento terminou ou ainda não foi confirmada. Continue pelo WhatsApp Business.');
  await requireAgentApproval(context, 'k5_whatsapp_send', input.approvalId, normalized, thread.id,
    `Enviar pelo WhatsApp para ${thread.participant_name || thread.participant_id} (${thread.participant_id}): ${input.text}`);
  const claimed = await withTransaction(async tx => {
    const active = await tx.prepare("SELECT generation FROM whatsapp_connection WHERE id=? AND office_id=? AND status='connected' FOR UPDATE")
      .get<{ generation: number }>(connection.id, context.officeId);
    if (!active || active.generation !== connection.generation) throw new CapabilityError('CONFLICT', 'A conexão mudou. Prepare a resposta novamente.');
    const row = await tx.prepare(`INSERT INTO whatsapp_send(id,office_id,connection_id,generation,thread_id,user_id,idempotency_key,input_hash,text,status)
      VALUES(?,?,?,?,?,?,?,?,?,'dispatching') ON CONFLICT(office_id,idempotency_key) DO NOTHING RETURNING *`)
      .get<SendRow>(randomUUID(), context.officeId, connection.id, connection.generation, thread.id, context.userId, input.idempotencyKey, inputHash, input.text);
    if (row) return { kind: 'new' as const, row };
    const previous = await tx.prepare('SELECT * FROM whatsapp_send WHERE office_id=? AND idempotency_key=?').get<SendRow>(context.officeId, input.idempotencyKey);
    if (!previous) throw new CapabilityError('CONFLICT', 'Atualize a conversa para conferir o envio.');
    return { kind: 'existing' as const, result: checkExisting(previous) };
  });
  if (claimed.kind === 'existing') return claimed.result;
  let dispatched = false;
  try {
    await reserveWhatsAppApiCall(context.officeId);
    await authorizeWhatsApp(context, { write: true });
    const current = await database.prepare("SELECT * FROM whatsapp_connection WHERE id=? AND office_id=? AND status='connected' AND generation=?")
      .get<ConnectionRow>(connection.id, context.officeId, connection.generation);
    const latest = await database.prepare('SELECT last_customer_message_at FROM whatsapp_thread WHERE id=? AND office_id=? AND account_id=?')
      .get<{ last_customer_message_at: string | null }>(thread.id, context.officeId, connection.account_id);
    if (!current || !current.account_id) throw new CapabilityError('CONFLICT', 'A conexão mudou. Prepare a resposta novamente.');
    if (!latest || !isReplyWindowOpen(latest.last_customer_message_at)) throw new CapabilityError('SCOPE_REQUIRED', 'A janela de atendimento terminou. Continue pelo WhatsApp Business.');
    const credential = connectedCredential(current);
    dispatched = true;
    const result = await sendProviderText(credential, current.account_id, thread.provider_id, input.text, claimed.row.id);
    await withTransaction(async tx => {
      await tx.prepare("UPDATE whatsapp_send SET provider_id=?,status='accepted',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('dispatching','unknown')")
        .run(result.messageId, claimed.row.id);
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
    await database.prepare("UPDATE whatsapp_send SET status=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='dispatching'")
      .run(status, message, claimed.row.id);
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
