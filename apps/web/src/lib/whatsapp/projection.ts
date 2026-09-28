import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '@/lib/database';
import type { ConnectionRow, InboxMessage, Thread } from './domain';
import type { ProviderAttachment } from './provider';
import { projectAttachments } from './media';

export type ThreadRow = {
  id: string; office_id: string; connection_id: string; account_id: string; provider_id: string;
  participant_id: string; participant_name: string; last_text: string; last_message_at: string;
  last_customer_message_at: string | null; unread_count: number; history_complete: boolean;
  history_cursor: string | null; updated_at: string;
};
export type MessageRow = {
  id: string; office_id: string; thread_id: string; provider_id: string;
  direction: InboxMessage['direction']; source: InboxMessage['source']; text: string;
  status: InboxMessage['status']; deleted: boolean; edited: boolean;
  attachments: ProviderAttachment[]; created_at: string; content_updated_at: string;
};
export type MessageProjection = {
  kind: 'received' | 'sent' | 'edit' | 'delete' | 'status' | 'history';
  thread: { providerId: string; participantId: string; participantName: string };
  providerId: string; createdAt: string; contentUpdatedAt: string; unread: boolean;
  attachments: ProviderAttachment[];
} & Pick<InboxMessage, 'direction' | 'source' | 'text' | 'status' | 'deleted' | 'edited'>;

const statusOrder: Record<InboxMessage['status'], number> = {
  received: 0, pending: 0, dispatching: 1, unknown: 2, accepted: 3, sent: 4, failed: 5, delivered: 6, read: 7,
};
export function advanceMessageStatus(current: InboxMessage['status'], incoming: InboxMessage['status']) {
  return statusOrder[incoming] > statusOrder[current] ? incoming : current;
}

export async function projectConversation(tx: Transaction, connection: ConnectionRow, input: {
  id: string; participantId: string; participantName: string; lastText: string;
  updatedAt: string; unreadCount: number;
}) {
  if (!connection.account_id) return;
  await tx.prepare(`INSERT INTO whatsapp_thread(id,office_id,connection_id,account_id,provider_id,
    participant_id,participant_name,last_text,last_message_at,unread_count)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(connection_id,account_id,provider_id) DO UPDATE SET
      participant_name=CASE WHEN whatsapp_thread.participant_name='' THEN EXCLUDED.participant_name ELSE whatsapp_thread.participant_name END,
      last_text=CASE WHEN EXCLUDED.last_message_at>whatsapp_thread.last_message_at AND NOT EXISTS(
        SELECT 1 FROM whatsapp_message WHERE thread_id=whatsapp_thread.id)
        THEN EXCLUDED.last_text ELSE whatsapp_thread.last_text END,
      last_message_at=CASE WHEN NOT EXISTS(SELECT 1 FROM whatsapp_message WHERE thread_id=whatsapp_thread.id)
        THEN GREATEST(whatsapp_thread.last_message_at,EXCLUDED.last_message_at) ELSE whatsapp_thread.last_message_at END,
      updated_at=CURRENT_TIMESTAMP`)
    .run(randomUUID(), connection.office_id, connection.id, connection.account_id, input.id,
      input.participantId, input.participantName, input.lastText, input.updatedAt, input.unreadCount);
}

export async function projectMessage(tx: Transaction, connection: ConnectionRow, fact: MessageProjection) {
  if (!connection.account_id) return;
  await tx.prepare(`INSERT INTO whatsapp_thread(id,office_id,connection_id,account_id,provider_id,
    participant_id,participant_name,last_text,last_message_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(connection_id,account_id,provider_id) DO NOTHING`)
    .run(randomUUID(), connection.office_id, connection.id, connection.account_id, fact.thread.providerId,
      fact.thread.participantId, fact.thread.participantName, fact.deleted ? '' : fact.text, fact.createdAt);
  const thread = await tx.prepare(`SELECT * FROM whatsapp_thread
    WHERE office_id=? AND connection_id=? AND account_id=? AND provider_id=? FOR UPDATE`)
    .get<ThreadRow>(connection.office_id, connection.id, connection.account_id, fact.thread.providerId);
  if (!thread) throw new Error('Conversa do WhatsApp não encontrada para projeção.');
  const previous = await tx.prepare(`SELECT * FROM whatsapp_message WHERE office_id=? AND thread_id=? AND provider_id=?`)
    .get<MessageRow>(connection.office_id, thread.id, fact.providerId);
  const sent = await tx.prepare(`SELECT id,status,created_at FROM whatsapp_send
    WHERE office_id=? AND connection_id=? AND thread_id=? AND provider_id=?`)
    .get<{ id: string; status: Exclude<InboxMessage['status'], 'received'>; created_at: string }>(connection.office_id, connection.id, thread.id, fact.providerId);
  const status = advanceMessageStatus(advanceMessageStatus(previous?.status ?? fact.status, sent?.status ?? fact.status), fact.status);
  const deleted = Boolean(previous?.deleted || fact.deleted);
  const newer = !previous || Date.parse(fact.contentUpdatedAt) > Date.parse(previous.content_updated_at)
    || (fact.edited && !previous.edited && fact.kind !== 'history' && fact.contentUpdatedAt === previous.content_updated_at);
  const editFromHistory = fact.kind === 'history' && fact.edited && previous && !previous.edited
    && previous.content_updated_at === previous.created_at;
  const useContent = !previous || fact.kind !== 'status' && (newer || editFromHistory);
  const text = deleted ? '' : useContent ? fact.text : previous.text;
  const attachments = deleted ? [] : useContent ? fact.attachments : previous.attachments;
  const edited = Boolean(previous?.edited || fact.edited);
  const source = sent || previous?.source === 'tises' ? 'tises'
    : previous?.source === 'whatsapp_business_app' ? previous.source : fact.source;
  const contentUpdatedAt = previous && Date.parse(previous.content_updated_at) >= Date.parse(fact.contentUpdatedAt)
    ? previous.content_updated_at : fact.contentUpdatedAt;

  const messageId = previous?.id ?? randomUUID();
  await tx.prepare(`INSERT INTO whatsapp_message(id,office_id,thread_id,provider_id,direction,source,text,status,
    deleted,edited,attachments,created_at,content_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?::jsonb,?,?)
    ON CONFLICT(thread_id,provider_id) DO UPDATE SET source=EXCLUDED.source,text=EXCLUDED.text,status=EXCLUDED.status,
      deleted=EXCLUDED.deleted,edited=EXCLUDED.edited,attachments=EXCLUDED.attachments,
      content_updated_at=EXCLUDED.content_updated_at`)
    .run(messageId, connection.office_id, thread.id, fact.providerId,
      previous?.direction ?? fact.direction, source, text, status, deleted, edited, JSON.stringify(attachments),
      previous?.created_at ?? fact.createdAt, contentUpdatedAt);
  const enrichAttachments = fact.kind !== 'status' && (!previous || Date.parse(fact.contentUpdatedAt) >= Date.parse(previous.content_updated_at));
  await projectAttachments(tx, connection, messageId, thread.id, enrichAttachments ? fact.attachments : attachments,
    { deleted, replace: Boolean(useContent), enrich: enrichAttachments, sendId: sent?.id });
  if (sent) {
    const sendStatus = advanceMessageStatus(sent.status, status);
    if (sendStatus !== 'received') await tx.prepare(`UPDATE whatsapp_send SET status=?,error=CASE WHEN ?='failed'
      THEN 'A mensagem não foi entregue.' ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=?`)
      .run(sendStatus, sendStatus, sent.id, connection.office_id);
  }

  const customerAt = fact.direction === 'inbound' && Date.parse(fact.createdAt) <= Date.now()
    ? fact.createdAt : null;
  const unread = !previous && fact.kind === 'received' && fact.direction === 'inbound' && fact.unread && !deleted ? 1 : 0;
  await tx.prepare(`UPDATE whatsapp_thread SET
    participant_name=CASE WHEN ?<>'' AND (participant_name='' OR ?<>'history') THEN ? ELSE participant_name END,
    last_customer_message_at=GREATEST(last_customer_message_at,?::timestamptz),
    unread_count=unread_count+?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=?`)
    .run(fact.thread.participantName, fact.kind, fact.thread.participantName, customerAt, unread, thread.id, connection.office_id);
  const last = await tx.prepare(`SELECT text,created_at,provider_id FROM whatsapp_message WHERE thread_id=? AND office_id=?
    ORDER BY created_at DESC,id DESC LIMIT 1`).get<{ text: string; created_at: string; provider_id: string }>(thread.id, connection.office_id);
  if (last) await tx.prepare(`UPDATE whatsapp_thread SET last_text=?,last_message_at=GREATEST(last_message_at,?::timestamptz)
    WHERE id=? AND office_id=? AND (last_message_at<=?::timestamptz OR (?=? AND last_message_at<=?::timestamptz))`)
    .run(last.text, last.created_at, thread.id, connection.office_id, last.created_at, last.provider_id, fact.providerId, sent?.created_at ?? null);
  return thread.id;
}

export function threadView(row: ThreadRow, windowClosesAt: Thread['windowClosesAt']): Thread {
  return { id: row.id, participantId: row.participant_id, participantName: row.participant_name,
    lastText: row.last_text, lastMessageAt: row.last_message_at, lastCustomerMessageAt: row.last_customer_message_at,
    unreadCount: row.unread_count, historyComplete: row.history_complete, windowClosesAt };
}

export function messageView(row: MessageRow): InboxMessage {
  return { id: row.id, direction: row.direction, source: row.source, text: row.deleted ? '' : row.text,
    createdAt: row.created_at, status: row.status, deleted: row.deleted, edited: row.edited,
    attachments: row.deleted ? [] : row.attachments.map(attachment => ({ id: null, kind: attachment.kind,
      filename: attachment.filename, mimeType: attachment.mimeType, byteLength: null, state: 'unavailable', contentUrl: null })) };
}
