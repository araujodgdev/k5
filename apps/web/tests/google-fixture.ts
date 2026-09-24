import { testDb } from './test-setup';
import { randomUUID } from 'node:crypto';
import { encryptCredential, parseCredentialKeyring } from '../src/lib/platform-crypto';
import { setGoogleTransport, type GoogleTransport, type TransportRequest, type TransportResponse, GoogleNetworkError } from '../src/lib/google/transport';
import { moduleScopes, identityScopes, type GoogleModule } from '../src/lib/google/config';
import type { WorkspaceContext } from '../src/lib/application/context';

process.env.GOOGLE_OAUTH_CLIENT_ID ??= 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_OAUTH_CLIENT_SECRET ??= 'test-client-secret';
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';

export type FakeRequest = TransportRequest & { path: string; query: URLSearchParams; json: () => unknown; text: () => string };
type Handler = (request: FakeRequest, match: RegExpMatchArray) => TransportResponse | Promise<TransportResponse>;

export function respond(status: number, body?: unknown, headers: Record<string, string> = {}): TransportResponse {
  const bytes = body === undefined ? new Uint8Array() : body instanceof Uint8Array ? body : new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body));
  return { status, headers: new Headers({ 'content-type': body instanceof Uint8Array ? 'application/octet-stream' : 'application/json', ...headers }), body: bytes };
}

/**
 * Simulated Google. Routes match "METHOD url-without-query" against a RegExp; unmatched calls fail
 * the test loudly. Every request is recorded so tests can assert what reached "Google".
 */
export class FakeGoogle implements GoogleTransport {
  calls: FakeRequest[] = [];
  private routes: { method: string; pattern: RegExp; handler: Handler; times?: number }[] = [];
  tokenCounter = 0;
  constructor() {
    this.on('POST', /^https:\/\/oauth2\.googleapis\.com\/token$/, () => respond(200, { access_token: `access-${++this.tokenCounter}`, expires_in: 3600, token_type: 'Bearer' }));
    this.on('POST', /^https:\/\/oauth2\.googleapis\.com\/revoke$/, () => respond(200, {}));
  }
  /** Later registrations win, so a test can override a default. `times` makes a one-shot route. */
  on(method: string, pattern: RegExp, handler: Handler, times?: number) { this.routes.unshift({ method, pattern, handler, times }); return this; }
  /** Simulates a timeout / lost response for the next matching call (the request did reach Google when `delivered`). */
  failNetwork(method: string, pattern: RegExp, delivered: Handler | null = null) {
    return this.on(method, pattern, async (request, match) => { if (delivered) await delivered(request, match); throw new GoogleNetworkError('response'); }, 1);
  }
  async request(request: TransportRequest): Promise<TransportResponse> {
    const url = new URL(request.url);
    const base = `${url.origin}${url.pathname}`;
    const body = typeof request.body === 'string' ? request.body : request.body ? new TextDecoder().decode(request.body) : '';
    const fake: FakeRequest = { ...request, path: url.pathname, query: url.searchParams, text: () => body, json: () => JSON.parse(body) };
    this.calls.push(fake);
    for (const route of this.routes) {
      if (route.method !== request.method) continue;
      const match = base.match(route.pattern);
      if (!match) continue;
      if (route.times !== undefined) { route.times -= 1; if (route.times <= 0) this.routes.splice(this.routes.indexOf(route), 1); }
      return route.handler(fake, match);
    }
    throw new Error(`FakeGoogle: rota não simulada ${request.method} ${base}`);
  }
  count(method: string, pattern: RegExp) { return this.calls.filter(call => call.method === method && pattern.test(call.url.split('?')[0])).length; }
}

export function installFakeGoogle() { const fake = new FakeGoogle(); setGoogleTransport(fake); return fake; }

export type GoogleFixture = { context: WorkspaceContext; officeId: string; userId: string; connectionId: string; email: string };

/** Office, member, rollout for every module and an active connection whose access token is valid. */
export async function googleFixture(options: {
  role?: WorkspaceContext['role']; officeId?: string; modules?: GoogleModule[]; grantedModules?: GoogleModule[]; connect?: boolean; accessValid?: boolean;
} = {}): Promise<GoogleFixture> {
  const officeId = options.officeId ?? randomUUID();
  const userId = randomUUID();
  const email = `${userId.slice(0, 8)}@example.com`;
  if (!options.officeId) await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório');
  await testDb.prepare('INSERT INTO "user"(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@test.local`, `Pessoa ${userId.slice(0, 4)}`);
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), officeId, userId, options.role ?? 'lawyer');
  for (const feature of options.modules ?? ['gmail', 'calendar', 'drive', 'docs']) {
    await testDb.prepare('INSERT INTO google_rollout(office_id,module,enabled) VALUES(?,?,1) ON CONFLICT DO NOTHING').run(officeId, feature);
  }
  const connectionId = randomUUID();
  if (options.connect !== false) {
    const ring = parseCredentialKeyring();
    const scopes = [...identityScopes, ...(options.grantedModules ?? ['gmail', 'calendar', 'drive', 'docs']).flatMap(module => moduleScopes[module])];
    await testDb.prepare(`INSERT INTO google_connection(id,office_id,user_id,google_subject,email,status,granted_scopes,encrypted_refresh_token,encrypted_access_token,access_expires_at)
      VALUES(?,?,?,?,?,'active',?,?,?,?)`).run(connectionId, officeId, userId, `sub-${userId}`, email, [...new Set(scopes)],
      encryptCredential(`refresh-${userId}`, ring), encryptCredential(`access-initial-${userId}`, ring),
      new Date(Date.now() + (options.accessValid === false ? -60_000 : 3_600_000)).toISOString());
  }
  return { context: { officeId, userId, role: options.role ?? 'lawyer' }, officeId, userId, connectionId, email };
}

/** Saves office rules directly (as an administrator would through the interface). */
export async function setRule(officeId: string, action: string, rule: Partial<{ mode: 'blocked' | 'confirmation' | 'automatic'; dailyLimit: number | null; maxRecipients: number | null; maxAttachments: number | null; maxAttachmentBytes: number | null }>) {
  const { readPolicy, savePolicy } = await import('../src/lib/google/policy');
  const current = await readPolicy(officeId, testDb);
  const rules = structuredClone(current.rules);
  Object.assign((rules.actions as Record<string, object>)[action], rule);
  return savePolicy(officeId, 'test-admin', current.version, rules, testDb);
}
