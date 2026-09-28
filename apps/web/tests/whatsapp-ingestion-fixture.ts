import { randomUUID, createHmac } from 'node:crypto';
import { testDb } from './test-setup';
import type { WorkspaceContext } from '../src/lib/application/context';
import { encryptCredential, parseCredentialKeyring } from '../src/lib/platform-crypto';
import { withWhatsAppEnvironment } from '../src/lib/whatsapp/environment';
import type { ConnectionRow } from '../src/lib/whatsapp/domain';

export const webhookSecret = 'synthetic-whatsapp-webhook-secret';

export function whatsappTestEnvironment<T>(action: () => T, enabled = true) {
  return withWhatsAppEnvironment({ K5_CREDENTIALS_KEY: process.env.K5_CREDENTIALS_KEY,
    ZERNIO_WEBHOOK_SECRET: webhookSecret, ZERNIO_API_KEY: 'synthetic-master-key',
    K5_WHATSAPP_REQUESTS_PER_MINUTE: '1000', K5_WHATSAPP_OFFICE_REQUESTS_PER_MINUTE: '1000',
    FLAGS: { getBooleanValue: async () => enabled } }, action);
}

export async function whatsappFixture(role: WorkspaceContext['role'] = 'lawyer') {
  const officeId = randomUUID(), userId = randomUUID(), connectionId = randomUUID(), sessionId = randomUUID();
  const profileId = `profile-${randomUUID()}`, accountId = `account-${randomUUID()}`;
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'WhatsApp sintético');
  await testDb.prepare('INSERT INTO "user"(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@test.local`, 'Pessoa sintética');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), officeId, userId, role);
  await testDb.prepare(`INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt)
    VALUES(?,?,?,CURRENT_TIMESTAMP+INTERVAL '1 day',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    .run(sessionId, userId, randomUUID());
  await testDb.prepare(`INSERT INTO whatsapp_connection(id,office_id,status,profile_id,account_id,api_key_id,encrypted_api_key,verified_at)
    VALUES(?,?,'connected',?,?,?,?,CURRENT_TIMESTAMP-INTERVAL '1 hour')`)
    .run(connectionId, officeId, profileId, accountId, `key-${randomUUID()}`, encryptCredential('synthetic-office-key', parseCredentialKeyring()));
  const context: WorkspaceContext = { officeId, userId, role, sessionId };
  return { officeId, userId, connectionId, profileId, accountId, context };
}

export async function fixtureConnection(id: string) {
  const row = await testDb.prepare('SELECT * FROM whatsapp_connection WHERE id=?').get<ConnectionRow>(id);
  if (!row) throw new Error('Conexão sintética não encontrada.');
  return row;
}

export function webhookMessage(fixture: Awaited<ReturnType<typeof whatsappFixture>>, options: {
  event?: string; id?: string; providerId?: string; threadId?: string; text?: string;
  sentAt?: string; timestamp?: string; direction?: 'incoming' | 'outgoing'; editedAt?: string;
  deletedAt?: string; statusAt?: string; source?: string;
} = {}) {
  const now = new Date(Date.now() - 1000).toISOString();
  const threadId = options.threadId ?? 'peer-5511999990000';
  return { id: options.id ?? randomUUID(), event: options.event ?? 'message.received',
    timestamp: options.timestamp ?? now,
    account: { id: fixture.accountId, accountId: fixture.accountId, profileId: fixture.profileId,
      platform: 'whatsapp', username: '5511888880000' },
    conversation: { id: `internal-${threadId}`, platformConversationId: threadId,
      participantId: '5511999990000', participantName: 'Contato sintético', status: 'active' },
    message: { id: 'internal-message', conversationId: `internal-${threadId}`, platformMessageId: options.providerId ?? 'wamid-synthetic',
      platform: 'whatsapp', direction: options.direction ?? 'incoming', text: options.text ?? 'Mensagem sintética',
      attachments: [{ type: 'image', url: 'https://private.invalid/media/secret', mimeType: 'image/jpeg', filename: 'foto.jpg' }],
      sender: { id: options.direction === 'outgoing' ? fixture.accountId : '5511999990000', name: 'Nome do remetente' },
      sentAt: options.sentAt ?? now, isRead: false, ...(options.source ? { source: options.source } : {}) },
    ...(options.editedAt ? { editedAt: options.editedAt } : {}),
    ...(options.deletedAt ? { deletedAt: options.deletedAt } : {}),
    ...(options.statusAt ? { statusAt: options.statusAt } : {}),
  };
}

export function signWebhook(payload: { id: string; event: string }, raw = JSON.stringify(payload)) {
  const body = new TextEncoder().encode(raw);
  return { body, headers: new Headers({ 'x-zernio-signature': createHmac('sha256', webhookSecret).update(body).digest('hex'),
    'x-zernio-event-id': payload.id, 'x-zernio-event': payload.event }) };
}
