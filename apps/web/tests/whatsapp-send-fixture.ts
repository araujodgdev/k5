import { testDb } from './test-setup';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { WorkspaceContext } from '../src/lib/application/context';
import { encryptCredential, parseCredentialKeyring } from '../src/lib/platform-crypto';
import { withWhatsAppEnvironment, type WhatsAppEnvironment } from '../src/lib/whatsapp/environment';
import { withWhatsAppTransport, type WhatsAppFetch } from '../src/lib/whatsapp/transport';

export { testDb };

const credentialKey = Buffer.alloc(32, 17).toString('base64');
const restrictedGroups = ['publishing', 'engagement', 'contacts', 'analytics', 'ads', 'telephony', 'accounts', 'billing', 'webhooks'];
const profileBody = z.object({ name: z.string() });

export async function whatsappSession(userId: string) {
  const sessionId = randomUUID();
  await testDb.prepare(`INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt)
    VALUES(?,?,?,CURRENT_TIMESTAMP+INTERVAL '1 day',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    .run(sessionId, userId, randomUUID());
  return sessionId;
}

export async function whatsappIdentity(options: { role?: WorkspaceContext['role']; officeId?: string } = {}) {
  const officeId = options.officeId ?? randomUUID();
  const userId = randomUUID();
  if (!options.officeId) await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório WhatsApp');
  await testDb.prepare('INSERT INTO "user"(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@whatsapp.test`, 'Advogada WhatsApp');
  const role = options.role ?? 'administrator';
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), officeId, userId, role);
  const sessionId = await whatsappSession(userId);
  const context: WorkspaceContext = { officeId, userId, sessionId, role };
  return { officeId, userId, sessionId, context };
}

export type WhatsAppFixture = Awaited<ReturnType<typeof whatsappIdentity>> & {
  connectionId: string; profileId: string; accountId: string; profileKey: string; apiKeyId: string;
  threadId: string; providerThreadId: string; participantId: string;
};

export async function whatsappThread(fixture: Pick<WhatsAppFixture, 'officeId' | 'connectionId' | 'accountId'>, options: {
  lastCustomerMessageAt?: string | null; participantName?: string;
} = {}) {
  const threadId = randomUUID();
  const providerThreadId = `conversation-${randomUUID()}`;
  const participantId = `5511${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`;
  const received = options.lastCustomerMessageAt === undefined ? new Date(Date.now() - 60_000).toISOString() : options.lastCustomerMessageAt;
  await testDb.prepare(`INSERT INTO whatsapp_thread(id,office_id,connection_id,account_id,provider_id,participant_id,
    participant_name,last_text,last_message_at,last_customer_message_at) VALUES(?,?,?,?,?,?,?,'Preciso de ajuda.',CURRENT_TIMESTAMP,?)`)
    .run(threadId, fixture.officeId, fixture.connectionId, fixture.accountId, providerThreadId, participantId,
      options.participantName ?? 'Cliente WhatsApp', received);
  return { threadId, providerThreadId, participantId };
}

export async function whatsappFixture(options: {
  connected?: boolean; role?: WorkspaceContext['role']; lastCustomerMessageAt?: string | null;
} = {}): Promise<WhatsAppFixture> {
  const identity = await whatsappIdentity({ role: options.role });
  const ids = {
    connectionId: randomUUID(), profileId: `profile-${randomUUID()}`, accountId: `account-${randomUUID()}`,
    profileKey: `profile-key-${randomUUID()}`, apiKeyId: `key-${randomUUID()}`,
  };
  if (options.connected === false) return { ...identity, ...ids, threadId: randomUUID(), providerThreadId: `conversation-${randomUUID()}`, participantId: '5511999999999' };
  await testDb.prepare(`INSERT INTO whatsapp_connection(id,office_id,status,profile_id,account_id,api_key_id,encrypted_api_key,
    number,label,verified_at,key_provisioning_state) VALUES(?,?,'connected',?,?,?,?,?,'Escritório WhatsApp',CURRENT_TIMESTAMP,'ready')`)
    .run(ids.connectionId, identity.officeId, ids.profileId, ids.accountId, ids.apiKeyId,
      encryptCredential(ids.profileKey, parseCredentialKeyring(credentialKey)), '+55 11 99999-9999');
  const thread = await whatsappThread({ ...identity, ...ids }, { lastCustomerMessageAt: options.lastCustomerMessageAt });
  return { ...identity, ...ids, ...thread };
}

export type WhatsAppRequest = { url: URL; method: string; headers: Headers; body: unknown };
type Handler = (request: WhatsAppRequest) => Response | Promise<Response>;

export function whatsappJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export class FakeWhatsApp {
  readonly calls: WhatsAppRequest[] = [];
  readonly flags: { key: string; fallback: boolean; context: Record<string, string> }[] = [];
  enabled = true;
  readonly messageId = `message-${randomUUID()}`;
  private readonly handlers: { method: string; path: string; handler: Handler }[] = [];

  constructor(readonly fixture: WhatsAppFixture) {}

  on(method: string, path: string, handler: Handler) {
    this.handlers.unshift({ method, path, handler });
    return this;
  }

  get sendPath() { return `/api/v1/inbox/conversations/${this.fixture.providerThreadId}/messages`; }
  get sends() { return this.calls.filter(call => call.method === 'POST' && call.url.pathname === this.sendPath); }

  readonly fetch: WhatsAppFetch = async (input, init) => {
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    const request: WhatsAppRequest = { url: new URL(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body };
    this.calls.push(request);
    const custom = this.handlers.find(handler => handler.method === request.method && handler.path === request.url.pathname);
    if (custom) return custom.handler(request);
    assert.equal(request.url.origin, 'https://zernio.com');
    if (request.method === 'POST' && request.url.pathname === '/api/v1/profiles') {
      return whatsappJson({ profile: { _id: this.fixture.profileId, name: profileBody.parse(body).name } }, 201);
    }
    if (request.method === 'GET' && request.url.pathname === '/api/v1/connect/whatsapp') {
      return whatsappJson({ authUrl: 'https://zernio.com/connect/whatsapp-test' });
    }
    if (request.method === 'GET' && request.url.pathname === '/api/v1/accounts') {
      return whatsappJson({ accounts: [{ _id: this.fixture.accountId, profileId: this.fixture.profileId,
        platform: 'whatsapp', isActive: true, metadata: { displayPhoneNumber: '+55 11 99999-9999', verifiedName: 'Escritório WhatsApp' } }] });
    }
    if (request.method === 'POST' && request.url.pathname === '/api/v1/api-keys') {
      return whatsappJson({ apiKey: { id: this.fixture.apiKeyId, key: this.fixture.profileKey,
        scope: 'profiles', profileIds: [this.fixture.profileId], permission: 'read-write', disabledResourceGroups: restrictedGroups } }, 201);
    }
    if (request.method === 'POST' && request.url.pathname === this.sendPath) {
      return whatsappJson({ success: true, data: { messageId: this.messageId } });
    }
    if (request.method === 'DELETE' && [`/api/v1/accounts/${this.fixture.accountId}`, `/api/v1/api-keys/${this.fixture.apiKeyId}`].includes(request.url.pathname)) {
      return whatsappJson({ message: 'Deleted' });
    }
    throw new Error(`Unexpected WhatsApp test request: ${request.method} ${request.url.pathname}`);
  };

  run<T>(action: () => T, environment: WhatsAppEnvironment = {}): T {
    return withWhatsAppEnvironment({
      ZERNIO_API_KEY: 'master-key-for-whatsapp-tests', ZERNIO_WEBHOOK_SECRET: 'whatsapp-test-secret',
      BETTER_AUTH_URL: 'https://tises.example.test', K5_CREDENTIALS_KEY: credentialKey,
      K5_WHATSAPP_REQUESTS_PER_MINUTE: '10000', K5_WHATSAPP_OFFICE_REQUESTS_PER_MINUTE: '10000',
      FLAGS: { getBooleanValue: async (key, fallback, context) => { this.flags.push({ key, fallback, context }); return this.enabled; } },
      ...environment,
    }, () => withWhatsAppTransport(this.fetch, action));
  }

  callback() {
    const call = this.calls.findLast(request => request.url.pathname === '/api/v1/connect/whatsapp');
    assert.ok(call, 'the connection flow reached the provider');
    const redirect = call.url.searchParams.get('redirect_url');
    assert.ok(redirect);
    const state = new URL(redirect).searchParams.get('state');
    assert.ok(state);
    return { state, accountId: this.fixture.accountId, profileId: this.fixture.profileId };
  }
}
