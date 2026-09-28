import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { withTransaction } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import { encryptCredential, parseCredentialKeyring } from '@/lib/platform-crypto';
import { whatsappEnvironment } from './environment';
import type { ConnectionRow } from './domain';
import { enqueueWhatsAppJob } from './jobs';
import { wakeWhatsAppWorker } from './wake';
import type { MessageProjection } from './projection';
import { providerAttachment, providerAttachmentSchema } from './provider';

export const MAX_WHATSAPP_WEBHOOK_BYTES = 1_048_576;
const identifier = z.string().min(1).max(500);
const timestamp = z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString());
const accountSchema = z.object({ id: identifier.optional(), accountId: identifier.optional(),
  profileId: identifier.optional(), platform: z.string().max(80) });
const envelopeSchema = z.object({ id: z.string().uuid(), event: z.string().min(1).max(120),
  timestamp, account: accountSchema.optional() });
const conversationSchema = z.object({ id: identifier, platformConversationId: identifier,
  participantId: identifier.optional(), participantName: z.string().max(1000).optional() });
const messageSchema = z.object({ id: identifier, conversationId: identifier, platformMessageId: identifier,
  platform: z.literal('whatsapp'), direction: z.enum(['incoming', 'outgoing']), text: z.string().max(65_536).nullable(),
  sentAt: timestamp, isRead: z.boolean(), source: z.string().max(100).optional(),
  sender: z.object({ id: identifier, name: z.string().max(1000).optional() }),
  attachments: z.array(providerAttachmentSchema).max(100),
});
const messageEnvelopeSchema = envelopeSchema.extend({ conversation: conversationSchema, message: messageSchema,
  editedAt: timestamp.optional(), deletedAt: timestamp.optional(), statusAt: timestamp.optional() });
const messageEvents = new Set(['message.received', 'message.sent', 'message.edited', 'message.deleted',
  'message.delivered', 'message.read', 'message.failed']);

type MappedEvent = { id: string; eventName: string; accountId: string; profileId: string; occurredAt: string };
export type WhatsAppEvent = ({ kind: 'message'; message: MessageProjection } & MappedEvent)
  | ({ kind: 'disconnect' | 'conversations' } & MappedEvent)
  | { kind: 'ignored'; id: string; eventName: string };

export function parseWhatsAppWebhook(raw: string): WhatsAppEvent {
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new CapabilityError('INVALID', 'Webhook inválido.'); }
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success || Date.parse(parsed.data.timestamp) > Date.now() + 60_000)
    throw new CapabilityError('INVALID', 'Webhook inválido.');
  const envelope = parsed.data;
  const account = envelope.account;
  if (account?.id && account.accountId && account.id !== account.accountId)
    throw new CapabilityError('INVALID', 'Identidade da conta inválida.');
  const accountId = account?.accountId ?? account?.id;
  if (account?.platform !== 'whatsapp' || !accountId || !account.profileId)
    return { kind: 'ignored', id: envelope.id, eventName: envelope.event };
  const common: MappedEvent = { id: envelope.id, eventName: envelope.event, accountId,
    profileId: account.profileId, occurredAt: envelope.timestamp };
  if (envelope.event === 'account.disconnected') return { ...common, kind: 'disconnect' };
  if (envelope.event === 'conversation.started') {
    const started = envelopeSchema.extend({ conversation: conversationSchema, startedAt: timestamp }).safeParse(input);
    if (!started.success) throw new CapabilityError('INVALID', 'Conversa do webhook inválida.');
    return { ...common, kind: 'conversations' };
  }
  if (!messageEvents.has(envelope.event)) return { kind: 'ignored', id: envelope.id, eventName: envelope.event };
  const result = messageEnvelopeSchema.safeParse(input);
  if (!result.success) throw new CapabilityError('INVALID', 'Mensagem do webhook inválida.');
  const { message, conversation, editedAt, deletedAt, statusAt } = result.data;
  if (message.conversationId !== conversation.id
    || [message.sentAt, editedAt, deletedAt, statusAt].some(value => value !== undefined && Date.parse(value) > Date.now() + 60_000)
    || editedAt !== undefined && Date.parse(editedAt) < Date.parse(message.sentAt)
    || deletedAt !== undefined && Date.parse(deletedAt) < Date.parse(message.sentAt)
    || envelope.event === 'message.received' && message.direction !== 'incoming'
    || envelope.event === 'message.sent' && message.direction !== 'outgoing'
    || ['message.delivered', 'message.read', 'message.failed'].includes(envelope.event) && (message.direction !== 'outgoing' || !statusAt)
    || envelope.event === 'message.edited' && !editedAt || envelope.event === 'message.deleted' && !deletedAt)
    throw new CapabilityError('INVALID', 'Mensagem do webhook inconsistente.');
  const kind: MessageProjection['kind'] = envelope.event === 'message.received' ? 'received'
    : envelope.event === 'message.sent' ? 'sent' : envelope.event === 'message.edited' ? 'edit'
      : envelope.event === 'message.deleted' ? 'delete' : 'status';
  const status: MessageProjection['status'] = envelope.event === 'message.read' ? 'read'
    : envelope.event === 'message.delivered' ? 'delivered' : envelope.event === 'message.failed' ? 'failed'
      : message.direction === 'incoming' ? 'received' : 'sent';
  return { ...common, kind: 'message', message: {
    kind, providerId: message.platformMessageId,
    thread: { providerId: conversation.platformConversationId,
      participantId: conversation.participantId ?? (message.direction === 'incoming' ? message.sender.id : conversation.platformConversationId),
      participantName: conversation.participantName ?? (message.direction === 'incoming' ? message.sender.name ?? '' : '') },
    direction: message.direction === 'incoming' ? 'inbound' : 'outbound',
    source: message.source === 'whatsapp_business_app' ? 'whatsapp_business_app' : 'provider',
    text: message.text ?? '', status, deleted: kind === 'delete', edited: kind === 'edit', unread: !message.isRead,
    createdAt: message.sentAt, contentUpdatedAt: editedAt ?? deletedAt ?? message.sentAt,
    attachments: message.attachments.map(item => providerAttachment(item, accountId)),
  } };
}

export async function acceptWebhook(rawBody: Uint8Array, headers: Headers): Promise<{ accepted: boolean; duplicate: boolean }> {
  if (rawBody.byteLength === 0 || rawBody.byteLength > MAX_WHATSAPP_WEBHOOK_BYTES)
    throw new CapabilityError('INVALID', 'Tamanho do webhook inválido.');
  const env = whatsappEnvironment();
  if (!env.ZERNIO_WEBHOOK_SECRET) throw new CapabilityError('NOT_READY', 'O webhook do WhatsApp não está configurado.');
  const signature = headers.get('x-zernio-signature') ?? headers.get('x-late-signature');
  const expected = createHmac('sha256', env.ZERNIO_WEBHOOK_SECRET).update(rawBody).digest();
  if (!signature || !/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(expected, Buffer.from(signature, 'hex')))
    throw new CapabilityError('UNAUTHENTICATED', 'Assinatura do webhook inválida.');
  let raw: string;
  try { raw = new TextDecoder('utf-8', { fatal: true }).decode(rawBody); }
  catch { throw new CapabilityError('INVALID', 'Codificação do webhook inválida.'); }
  const event = parseWhatsAppWebhook(raw);
  for (const name of ['x-zernio-event-id', 'x-late-event-id']) {
    const value = headers.get(name);
    if (value !== null && value !== event.id) throw new CapabilityError('INVALID', 'Identificador do webhook inválido.');
  }
  for (const name of ['x-zernio-event', 'x-late-event']) {
    const value = headers.get(name);
    if (value !== null && value !== event.eventName) throw new CapabilityError('INVALID', 'Evento do webhook inválido.');
  }
  if (event.kind === 'ignored') return { accepted: true, duplicate: false };
  const keyring = parseCredentialKeyring(env.K5_CREDENTIALS_KEY, env.K5_CREDENTIALS_PREVIOUS_KEYS, env.K5_CREDENTIALS_NEXT_KEY);
  const encrypted = encryptCredential(raw, keyring);
  const result = await withTransaction(async tx => {
    await tx.prepare(`SET LOCAL statement_timeout='3000ms'`).run();
    await tx.prepare(`SET LOCAL lock_timeout='1000ms'`).run();
    const connection = await tx.prepare(`SELECT * FROM whatsapp_connection WHERE account_id=? AND profile_id=? FOR UPDATE`)
      .get<ConnectionRow>(event.accountId, event.profileId);
    if (!connection || !(connection.status === 'connected' || connection.status === 'reconnect_required'
      || connection.status === 'pending' && connection.verified_at !== null))
      return { accepted: true, duplicate: false };
    const inserted = await tx.prepare(`INSERT INTO whatsapp_event(id,office_id,connection_id,event_name,encrypted_payload)
      VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING RETURNING id`)
      .get<{ id: string }>(event.id, connection.office_id, connection.id, event.eventName, encrypted);
    if (!inserted) return { accepted: true, duplicate: true };
    if (event.kind === 'disconnect' && connection.status === 'connected'
      && (!connection.verified_at || Date.parse(event.occurredAt) >= Date.parse(connection.verified_at))) {
      await tx.prepare(`UPDATE whatsapp_connection SET status='reconnect_required',generation=generation+1,
        sync_state='error',updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(connection.id);
      await tx.prepare(`UPDATE whatsapp_send SET status=CASE WHEN status='pending' THEN 'failed' ELSE 'unknown' END,
        error='A conexão com o WhatsApp foi interrompida.',updated_at=CURRENT_TIMESTAMP
        WHERE connection_id=? AND office_id=? AND status IN ('pending','dispatching')`)
        .run(connection.id, connection.office_id);
    }
    await enqueueWhatsAppJob(tx, { officeId: connection.office_id, connectionId: connection.id,
      generation: connection.generation, kind: 'event', subjectId: event.id, dedupeKey: `whatsapp:event:${event.id}` });
    return { accepted: true, duplicate: false };
  });
  if (!result.duplicate) await wakeWhatsAppWorker();
  return result;
}
