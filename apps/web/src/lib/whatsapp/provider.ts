import { z } from 'zod';
import { whatsappEnvironment } from './environment';
import { zernioRequest, ZernioError } from './transport';

const identifier = z.string().min(1).max(1024);
const timestamp = z.iso.datetime({ offset: true })
  .refine(value => Date.parse(value) <= Date.now() + 60_000)
  .transform(value => new Date(value).toISOString());
const profileReference = z.union([identifier, z.object({ _id: identifier }).transform(profile => profile._id)]);
const pagination = z.object({ hasMore: z.boolean(), nextCursor: z.string().min(1).max(4096).nullish() })
  .refine(value => !value.hasMore || typeof value.nextCursor === 'string')
  .transform(value => value.hasMore ? value.nextCursor ?? null : null);
const acknowledgement = z.object({ message: z.string() });
const disabledResourceGroups = [
  'publishing', 'engagement', 'contacts', 'analytics', 'ads',
  'telephony', 'accounts', 'billing', 'webhooks',
];
const keyScopeSchema = z.object({
  scope: z.literal('profiles'), profileIds: z.array(profileReference).length(1),
  permission: z.literal('read-write'), disabledResourceGroups: z.array(z.string()),
});

const accountSchema = z.object({
  _id: identifier, profileId: profileReference, platform: z.string(), isActive: z.boolean(),
  needsReconnection: z.boolean().optional(),
  username: z.string().nullish(), displayName: z.string().nullish(),
  metadata: z.object({ displayPhoneNumber: z.string().nullish(), verifiedName: z.string().nullish() }).optional(),
});
const threadSchema = z.object({
  id: identifier, accountId: identifier, platform: z.string(), participantId: identifier,
  participantName: z.string().nullish(), lastMessage: z.string().nullish(), updatedTime: timestamp,
  unreadCount: z.number().int().nonnegative().nullish().transform(value => value ?? 0), isGroup: z.boolean().default(false),
});
const attachmentSchema = z.object({ type: z.string(), filename: z.string().nullish(), mimeType: z.string().nullish() });
const messageSchema = z.object({
  id: identifier, conversationId: identifier, accountId: identifier, platform: z.string(),
  message: z.string().default(''), direction: z.enum(['incoming', 'outgoing']), createdAt: timestamp,
  deliveryStatus: z.enum(['sent', 'delivered', 'read', 'failed', 'deleted']).nullish(),
  isDeleted: z.boolean().default(false), isEdited: z.boolean().default(false), editedAt: timestamp.nullish(),
  attachments: z.array(attachmentSchema).max(100).default([]),
  metadata: z.object({ source: z.string().optional() }).optional(),
}).refine(message => message.editedAt == null || Date.parse(message.editedAt) >= Date.parse(message.createdAt));

export type ProviderThread = {
  id: string;
  participantId: string;
  participantName: string;
  lastText: string;
  updatedAt: string;
  unreadCount: number;
};

export type ProviderMessage = {
  id: string;
  conversationId: string;
  text: string;
  direction: 'inbound' | 'outbound';
  source: 'provider' | 'whatsapp_business_app' | 'tises';
  createdAt: string;
  contentUpdatedAt: string;
  status: 'received' | 'sent' | 'delivered' | 'read' | 'failed';
  deleted: boolean;
  edited: boolean;
  attachments: { kind: string; filename: string | null; mimeType: string | null }[];
};

function masterKey() {
  const key = whatsappEnvironment().ZERNIO_API_KEY;
  if (!key) throw new ZernioError(null, 'not_configured');
  return key;
}

export async function createProfile(officeId: string): Promise<{ id: string }> {
  const name = `Tises-${officeId}`;
  const response = await zernioRequest(masterKey(), '/profiles', {
    method: 'POST', body: { name }, idempotencyKey: `tises-profile-${officeId}`,
    schema: z.object({ profile: z.object({ _id: identifier, name: z.literal(name) }) }),
  });
  return { id: response.profile._id };
}

export async function createProfileKey(profileId: string, operationId?: string): Promise<{ id: string; key: string }> {
  const response = await zernioRequest(masterKey(), '/api-keys', {
    method: 'POST',
    body: { name: `Tises-${profileId}${operationId ? `-${operationId}` : ''}`, scope: 'profiles', profileIds: [profileId],
      permission: 'read-write', disabledResourceGroups },
    schema: z.object({ apiKey: z.object({
      id: identifier, key: z.string().min(1), scope: z.unknown().optional(), profileIds: z.unknown().optional(),
      permission: z.unknown().optional(), disabledResourceGroups: z.unknown().optional(),
    }) }),
  });
  const key = response.apiKey;
  const scope = keyScopeSchema.safeParse(key);
  if (!scope.success || scope.data.profileIds[0] !== profileId || scope.data.disabledResourceGroups.includes('messages') ||
    !disabledResourceGroups.every(group => scope.data.disabledResourceGroups.includes(group))) {
    const revoked = await revokeKey(key.id).then(() => true, () => false);
    throw new ZernioError(201, 'key_scope_mismatch', !revoked);
  }
  return { id: key.id, key: key.key };
}

export async function connectionUrl(profileId: string, redirectUrl: string): Promise<string> {
  const response = await zernioRequest(masterKey(), '/connect/whatsapp', {
    query: { profileId, redirect_url: redirectUrl, signup: 'hosted',
      onboarding: 'business_app', brandName: 'Tises', language: 'pt-BR' },
    schema: z.object({ authUrl: z.url() }),
  });
  const url = new URL(response.authUrl);
  if (url.username || url.password || !['https://zernio.com', 'https://www.facebook.com', 'https://facebook.com'].includes(url.origin)) {
    throw new ZernioError(200, 'unsafe_auth_url', true);
  }
  return url.href;
}

export async function getAccount(accountId: string, profileId: string): Promise<{
  id: string; profileId: string; number: string | null; label: string | null;
}> {
  const response = await zernioRequest(masterKey(), '/accounts', {
    query: { profileId, platform: 'whatsapp' },
    schema: z.object({ accounts: z.array(accountSchema).max(100) }),
  });
  const account = response.accounts.find(item => item._id === accountId);
  if (!account || account.profileId !== profileId || account.platform !== 'whatsapp' ||
    !account.isActive || account.needsReconnection) {
    throw new ZernioError(403, 'account_mismatch');
  }
  return { id: account._id, profileId: account.profileId,
    number: account.metadata?.displayPhoneNumber ?? account.username ?? null,
    label: account.metadata?.verifiedName ?? account.displayName ?? null };
}

export async function deleteAccount(accountId: string): Promise<void> {
  try {
    await zernioRequest(masterKey(), `/accounts/${encodeURIComponent(accountId)}`, {
      method: 'DELETE', schema: acknowledgement,
    });
  } catch (error) {
    if (!(error instanceof ZernioError) || error.status !== 404) throw error;
  }
}

export async function revokeKey(keyId: string): Promise<void> {
  try {
    await zernioRequest(masterKey(), `/api-keys/${encodeURIComponent(keyId)}`, {
      method: 'DELETE', schema: acknowledgement,
    });
  } catch (error) {
    if (!(error instanceof ZernioError) || error.status !== 404) throw error;
  }
}

export async function listProviderConversations(key: string, accountId: string, profileId: string, cursor?: string):
Promise<{ items: ProviderThread[]; nextCursor: string | null }> {
  const response = await zernioRequest(key, '/inbox/conversations', {
    query: { accountId, profileId, platform: 'whatsapp', limit: 100, sortOrder: 'desc', cursor },
    schema: z.object({ data: z.array(threadSchema).max(100), pagination,
      meta: z.object({ accountsFailed: z.number().int().nonnegative().optional(),
        failedAccounts: z.array(z.unknown()).optional(), accountsSkipped: z.array(z.unknown()).optional() }).optional(),
    }),
  });
  if ((response.meta?.accountsFailed ?? 0) > 0 || response.meta?.failedAccounts?.length || response.meta?.accountsSkipped?.length) {
    throw new ZernioError(200, 'partial_response', true);
  }
  if (response.data.some(thread => thread.accountId !== accountId || thread.platform !== 'whatsapp')) {
    throw new ZernioError(200, 'account_mismatch', true);
  }
  return {
    items: response.data.filter(thread => !thread.isGroup).map(thread => ({
      id: thread.id, participantId: thread.participantId, participantName: thread.participantName ?? '',
      lastText: thread.lastMessage ?? '', updatedAt: thread.updatedTime, unreadCount: thread.unreadCount,
    })),
    nextCursor: response.pagination,
  };
}

export async function listProviderMessages(key: string, accountId: string, providerThreadId: string, cursor?: string):
Promise<{ items: ProviderMessage[]; nextCursor: string | null }> {
  const response = await zernioRequest(key, `/inbox/conversations/${encodeURIComponent(providerThreadId)}/messages`, {
    query: { accountId, limit: 100, sortOrder: 'desc', cursor },
    schema: z.object({ messages: z.array(messageSchema).max(100), pagination }),
  });
  if (response.messages.some(message => message.accountId !== accountId || message.platform !== 'whatsapp')) {
    throw new ZernioError(200, 'account_mismatch', true);
  }
  return {
    items: response.messages.map((message): ProviderMessage => ({
      id: message.id, conversationId: providerThreadId,
      text: message.message, direction: message.direction === 'incoming' ? 'inbound' : 'outbound',
      source: message.metadata?.source === 'whatsapp_business_app' ? 'whatsapp_business_app' : 'provider',
      createdAt: message.createdAt, contentUpdatedAt: message.editedAt ?? message.createdAt,
      status: message.direction === 'incoming' ? 'received'
        : message.deliveryStatus === 'deleted' ? 'sent' : message.deliveryStatus ?? 'sent',
      deleted: message.isDeleted || message.deliveryStatus === 'deleted', edited: message.isEdited,
      attachments: message.attachments.map(attachment => ({ kind: attachment.type,
        filename: attachment.filename ?? null, mimeType: attachment.mimeType ?? null })),
    })),
    nextCursor: response.pagination,
  };
}

export async function sendProviderText(key: string, accountId: string, providerThreadId: string,
  text: string, idempotencyKey: string): Promise<{ messageId: string }> {
  const response = await zernioRequest(key, `/inbox/conversations/${encodeURIComponent(providerThreadId)}/messages`, {
    method: 'POST', body: { accountId, message: text }, idempotencyKey,
    schema: z.object({ success: z.literal(true), data: z.object({ messageId: identifier }) }),
  });
  return { messageId: response.data.messageId };
}
