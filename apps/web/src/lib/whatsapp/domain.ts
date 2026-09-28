import { z } from 'zod';

export const connectionState = z.enum(['pending', 'connected', 'reconnect_required', 'disconnecting', 'disconnected']);
export const sendState = z.enum(['pending', 'dispatching', 'accepted', 'sent', 'delivered', 'read', 'failed', 'unknown']);
export const attachmentDto = z.object({
  id: z.string().uuid().nullable(), kind: z.string(), filename: z.string().nullable(), mimeType: z.string().nullable(),
  byteLength: z.number().int().nonnegative().nullable(), state: z.enum(['pending', 'ready', 'unavailable']),
  contentUrl: z.string().nullable(),
});
export const uploadReceiptDto = attachmentDto.extend({ id: z.string().uuid(), state: z.literal('ready'), contentUrl: z.string() });
export type WhatsAppAttachment = z.infer<typeof attachmentDto>;
export const connectionStatusDto = z.object({
  enabled: z.boolean(), configured: z.boolean(), canManage: z.boolean(),
  connection: z.object({ id: z.string(), status: connectionState, number: z.string().nullable(), label: z.string().nullable(), updatedAt: z.string() }).nullable(),
});
export const threadDto = z.object({
  id: z.string(), participantId: z.string(), participantName: z.string(), lastText: z.string(),
  lastMessageAt: z.string(), lastCustomerMessageAt: z.string().nullable(), unreadCount: z.number().int().nonnegative(),
  historyComplete: z.boolean(), windowClosesAt: z.string().nullable(),
});
export const messageDto = z.object({
  id: z.string(), direction: z.enum(['inbound', 'outbound']), source: z.enum(['whatsapp_business_app', 'tises', 'provider']),
  text: z.string(), createdAt: z.string(), status: z.enum(['received', ...sendState.options]),
  deleted: z.boolean(), edited: z.boolean(), attachments: z.array(attachmentDto),
});
export const syncState = z.enum(['idle', 'pending', 'error']);
export const threadPageDto = z.object({ items: z.array(threadDto), nextCursor: z.string().nullable(), syncState, updatedAt: z.string().nullable() });
export const historyPageDto = z.object({ thread: threadDto, items: z.array(messageDto), nextCursor: z.string().nullable(), canSend: z.boolean(), syncState });
export const sendInput = z.object({
  threadId: z.string().uuid(), text: z.string().trim().max(4096).default(''), attachmentId: z.string().uuid().optional(),
  idempotencyKey: z.string().uuid(), approvalId: z.string().uuid().optional(),
}).superRefine((input, context) => {
  if (!input.text && !input.attachmentId) context.addIssue({ code: 'custom', message: 'Escreva uma mensagem ou escolha um arquivo.' });
  if (input.attachmentId && input.text.length > 1024) context.addIssue({ code: 'custom', message: 'A legenda pode ter até 1.024 caracteres.' });
});
export const sendReceiptDto = z.object({ id: z.string(), threadId: z.string(), status: sendState, error: z.string().nullable() });
export const listInput = z.object({ cursor: z.string().max(1000).optional(), limit: z.number().int().min(1).max(50).default(30) });
export const historyInput = listInput.extend({ threadId: z.string().uuid() });
export type ConnectionStatus = z.infer<typeof connectionStatusDto>;
export type Thread = z.infer<typeof threadDto>;
export type InboxMessage = z.infer<typeof messageDto>;
export type ThreadPage = z.infer<typeof threadPageDto>;
export type HistoryPage = z.infer<typeof historyPageDto>;
export type SendInput = z.infer<typeof sendInput>;
export type SendReceipt = z.infer<typeof sendReceiptDto>;
export type ConnectionRow = {
  id: string; office_id: string; generation: number; status: z.infer<typeof connectionState>;
  profile_id: string | null; account_id: string | null; number: string | null; label: string | null;
  encrypted_api_key: string | null; api_key_id: string | null; updated_at: string; verified_at: string | null;
  key_provisioning_state: 'none' | 'pending' | 'unknown' | 'ready';
  sync_state: z.infer<typeof syncState>; synced_at: string | null; sync_cursor: string | null;
};
export function replyWindow(lastCustomerMessageAt: string | null, now = Date.now()) {
  if (!lastCustomerMessageAt) return null;
  const received = Date.parse(lastCustomerMessageAt);
  if (!Number.isFinite(received) || received > now + 60_000) return null;
  return new Date(received + 86_400_000).toISOString();
}
export function isReplyWindowOpen(lastCustomerMessageAt: string | null, now = Date.now()) {
  const closesAt = replyWindow(lastCustomerMessageAt, now);
  return closesAt !== null && Date.parse(closesAt) > now;
}
