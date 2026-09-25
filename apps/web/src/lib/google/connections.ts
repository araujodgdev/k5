import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { database, type Database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import { decryptCredential, encryptCredential, parseCredentialKeyring } from '@/lib/platform-crypto';
import { googleOAuthConfig, identityScopes, moduleScopes, modulesForScopes, type GoogleModule } from './config';
import { apiErrorFrom, decodeJson, GoogleApiError, googleHosts, googleTransport, type GoogleService, type TransportResponse } from './transport';
import { checkGoogleWrite } from './write-context';
import { readPolicy } from './policy';
import { googleEnvironment } from './environment';
import { captureOperationalError } from '@/lib/observability/report';

export type ConnectionRow = {
  id: string; office_id: string; user_id: string; google_subject: string; email: string; display_name: string | null;
  status: 'active' | 'reauth_required' | 'disconnected' | 'member_removed'; granted_scopes: string[];
  encrypted_refresh_token: string | null; encrypted_access_token: string | null; access_expires_at: string | null;
  token_generation: number; refresh_lease_until: string | null; last_error_code: string | null; connected_at: string; updated_at: string;
  authorization_generation: number;
};

/** Owner of the work: always derived from the authenticated context or a job row, never from input. */
export type Owner = { officeId: string; userId: string };

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const keyring = () => parseCredentialKeyring(googleEnvironment().K5_CREDENTIALS_KEY, googleEnvironment().K5_CREDENTIALS_PREVIOUS_KEYS, googleEnvironment().K5_CREDENTIALS_NEXT_KEY ?? '');
const STATE_TTL_MS = 10 * 60_000;

export async function findLiveConnection(owner: Owner, db: Pick<Database, 'prepare'> = database) {
  return db.prepare(`SELECT * FROM google_connection WHERE office_id=? AND user_id=? AND status IN ('active','reauth_required')`)
    .get<ConnectionRow>(owner.officeId, owner.userId);
}

export async function rolloutFor(officeId: string, db: Pick<Database, 'prepare'> = database): Promise<Record<GoogleModule, boolean>> {
  const rows = await db.prepare('SELECT module, enabled FROM google_rollout WHERE office_id=?').all<{ module: GoogleModule; enabled: number }>(officeId);
  // Missing overrides inherit access; explicit platform blocks remain effective.
  const disabled = new Set(rows.filter(row => !row.enabled).map(row => row.module));
  return { gmail: !disabled.has('gmail'), calendar: !disabled.has('calendar'), drive: !disabled.has('drive'), docs: !disabled.has('docs') };
}

/**
 * The connection an operation may use: live, owned by this member of this office, and with the
 * module's scopes actually granted (partial consent leaves modules unavailable, not broken).
 */
export async function requireConnection(owner: Owner, module: GoogleModule, db: Pick<Database, 'prepare'> = database): Promise<ConnectionRow> {
  if (!await db.prepare('SELECT 1 FROM office_member WHERE office_id=? AND user_id=?').get(owner.officeId, owner.userId)) {
    throw new CapabilityError('FORBIDDEN', 'Seu acesso a este escritório foi removido.');
  }
  if (!(await rolloutFor(owner.officeId, db))[module]) throw new CapabilityError('FORBIDDEN', 'Este recurso do Google ainda não foi liberado para o escritório.');
  if (!(await readPolicy(owner.officeId, db)).rules.modules[module]) throw new CapabilityError('FORBIDDEN', 'O administrador desativou este recurso do Google.');
  const connection = await findLiveConnection(owner, db);
  if (!connection) throw new CapabilityError('SCOPE_REQUIRED', 'Conecte sua conta Google em Integrações para continuar.');
  if (connection.status === 'reauth_required') throw new CapabilityError('SCOPE_REQUIRED', 'A conexão com o Google expirou. Reconecte a conta em Integrações.');
  if (!moduleScopes[module].every(scope => connection.granted_scopes.includes(scope))) {
    throw new CapabilityError('SCOPE_REQUIRED', 'Você ainda não autorizou este recurso do Google. Conceda o acesso em Integrações.');
  }
  return connection;
}

// ---------- OAuth: start and callback ----------

function base64url(buffer: Buffer) { return buffer.toString('base64url'); }

/** Builds the Google consent URL. The state is single use and bound to this member and session. */
export async function startGoogleConnect(owner: Owner & { sessionId: string }, modules: GoogleModule[], db: Database = database) {
  const config = googleOAuthConfig();
  if (!config) throw new CapabilityError('NOT_READY', 'A integração Google não está configurada neste ambiente.');
  if (!modules.length) throw new CapabilityError('INVALID', 'Escolha ao menos um recurso para conectar.');
  const rollout = await rolloutFor(owner.officeId, db);
  const policy = await readPolicy(owner.officeId, db);
  const requested = modules.filter(module => rollout[module] && policy.rules.modules[module]);
  if (!requested.length) throw new CapabilityError('FORBIDDEN', 'Estes recursos do Google ainda não foram liberados para o escritório.');
  const existing = await findLiveConnection(owner, db);
  const scopes = [...new Set([...identityScopes, ...requested.flatMap(module => moduleScopes[module])])];
  const state = base64url(randomBytes(32));
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  await db.prepare('DELETE FROM google_oauth_state WHERE expires_at<CURRENT_TIMESTAMP').run();
  await db.prepare(`INSERT INTO google_oauth_state(id,state_hash,office_id,user_id,session_id,encrypted_verifier,modules,scopes,expires_at,connection_id,connection_generation)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), sha256(state), owner.officeId, owner.userId, owner.sessionId,
    encryptCredential(verifier, keyring()), requested, scopes, new Date(Date.now() + STATE_TTL_MS).toISOString(), existing?.id ?? null, existing?.authorization_generation ?? null);
  const params = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: scopes.join(' '),
    access_type: 'offline', include_granted_scopes: 'true', prompt: 'consent select_account', state,
    code_challenge: challenge, code_challenge_method: 'S256',
  });
  if (existing) params.set('login_hint', existing.email);
  return { url: `${googleHosts.accounts}/o/oauth2/v2/auth?${params}` };
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope?: string; id_token?: string; token_type?: string };

async function tokenRequest(body: Record<string, string>): Promise<TransportResponse> {
  return googleTransport().request({
    url: `${googleHosts.oauth}/token`, method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(), timeoutMs: 15_000, maxBytes: 64_000,
  });
}

function idTokenClaims(idToken: string, clientId: string) {
  // The token came straight from Google's token endpoint over TLS, so the payload is trusted as
  // Google documents; issuer and audience are still checked so a token minted for another client
  // cannot bind an identity here.
  const payload = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as { sub?: string; email?: string; email_verified?: boolean; aud?: string; iss?: string; name?: string; exp?: number };
  if (!payload.sub || !payload.email || payload.email_verified !== true || !payload.exp || payload.exp * 1000 <= Date.now() || payload.aud !== clientId || !['https://accounts.google.com', 'accounts.google.com'].includes(payload.iss ?? '')) {
    throw new CapabilityError('FORBIDDEN', 'Não foi possível confirmar a identidade da conta Google.');
  }
  return { subject: payload.sub, email: payload.email.toLowerCase(), name: payload.name ?? null };
}

/** OAuth error codes Google documents for the token endpoint; anything else is reported as `other`. */
const tokenErrorCodes = new Set(['invalid_request', 'invalid_client', 'invalid_grant', 'unauthorized_client', 'unsupported_grant_type', 'invalid_scope', 'redirect_uri_mismatch', 'access_denied']);
function tokenErrorCode(body: Uint8Array) {
  try {
    const code = decodeJson<{ error?: unknown }>(body).error;
    return typeof code === 'string' && tokenErrorCodes.has(code) ? code : 'other';
  } catch { return 'unreadable'; }
}

/** A failed connection used to leave no trace; the reason goes to logs and Sentry, never token data. */
function connectFailure(reason: string, error?: unknown, tags: Record<string, string> = {}) {
  // The runtime's own error class (TypeError, AbortError) says whether fetch refused or timed out.
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.name : undefined;
  console.warn(`google.oauth.callback failed: ${reason}`, cause ? { ...tags, cause } : tags);
  captureOperationalError(error ?? new Error(reason), 'google.oauth.callback', { reason, ...tags });
}

export type CallbackResult = { outcome: 'connected' | 'partial' | 'denied' | 'invalid' | 'other_account' | 'account_in_use' | 'failed'; missing?: GoogleModule[] };

/** Completes the flow. Everything that could bind a token to the wrong person is checked before storing it. */
export async function completeGoogleConnect(
  owner: Owner & { sessionId: string },
  params: { code?: string | null; state?: string | null; error?: string | null },
  db: Database = database,
): Promise<CallbackResult> {
  const config = googleOAuthConfig();
  if (!config || !params.state) return { outcome: 'invalid' };
  const state = await db.prepare(`UPDATE google_oauth_state SET consumed_at=CURRENT_TIMESTAMP
    WHERE state_hash=? AND office_id=? AND user_id=? AND session_id=? AND consumed_at IS NULL AND expires_at>CURRENT_TIMESTAMP
    RETURNING id,office_id,user_id,session_id,encrypted_verifier,modules,connection_id,connection_generation`).get<{ id: string; office_id: string; user_id: string; session_id: string; encrypted_verifier: string; modules: GoogleModule[]; connection_id: string | null; connection_generation: number | null }>(sha256(params.state), owner.officeId, owner.userId, owner.sessionId);
  if (!state || state.office_id !== owner.officeId || state.user_id !== owner.userId || state.session_id !== owner.sessionId) return { outcome: 'invalid' };
  if (params.error || !params.code) return { outcome: 'denied' };
  const response = await tokenRequest({
    code: params.code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri,
    grant_type: 'authorization_code', code_verifier: decryptCredential(state.encrypted_verifier, keyring()),
  }).catch((error: unknown) => {
    // The transport refuses redirects and oversized bodies itself; those are Google answering, not the network failing.
    if (error instanceof GoogleApiError) connectFailure('token_rejected', error, { status: String(error.status), google_error: ['redirect', 'too_large'].includes(error.reason) ? error.reason : 'other' });
    else connectFailure('token_network', error);
    return null;
  });
  if (!response) return { outcome: 'failed' };
  if (response.status !== 200) {
    connectFailure('token_rejected', undefined, { status: String(response.status), google_error: tokenErrorCode(response.body) });
    return { outcome: 'failed' };
  }
  const token = decodeJson<TokenResponse>(response.body);
  if (!token.id_token || !token.access_token || !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
    connectFailure('token_incomplete');
    return { outcome: 'failed' };
  }
  const identity = idTokenClaims(token.id_token, config.clientId);
  const granted = (token.scope ?? '').split(/\s+/).filter(Boolean);
  const existing = await findLiveConnection(owner, db);
  if (existing && existing.google_subject !== identity.subject) {
    // Revoking here could revoke a grant owned by another valid connection of this Google user.
    return { outcome: 'other_account' };
  }
  if ((existing?.id ?? null) !== state.connection_id || (existing && existing.authorization_generation !== state.connection_generation)) return { outcome: 'invalid' };
  const refresh = token.refresh_token ?? (existing?.encrypted_refresh_token ? decryptCredential(existing.encrypted_refresh_token, keyring()) : null);
  if (!refresh) {
    connectFailure('no_refresh_token');
    return { outcome: 'failed' };
  }
  const ring = keyring();
  const expiresAt = new Date(Date.now() + Math.max(60, token.expires_in - 60) * 1000).toISOString();
  try {
    if (existing) {
      // Incremental consent keeps the connection id, so calendars, files and history stay attached.
      const changed = await db.prepare(`UPDATE google_connection SET status='active',email=?,display_name=?,granted_scopes=?,encrypted_refresh_token=?,
        encrypted_access_token=?,access_expires_at=?,token_generation=token_generation+1,refresh_lease_token=NULL,refresh_lease_until=NULL,
        authorization_generation=authorization_generation+1,last_error_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND authorization_generation=? AND status IN ('active','reauth_required')
        AND EXISTS(SELECT 1 FROM google_oauth_state WHERE id=?)
        AND EXISTS(SELECT 1 FROM office_member WHERE office_id=? AND user_id=?)
        AND EXISTS(SELECT 1 FROM session WHERE id=? AND userId=? AND expiresAt>CURRENT_TIMESTAMP)`)
        .run(identity.email, identity.name, granted, encryptCredential(refresh, ring), encryptCredential(token.access_token, ring), expiresAt, existing.id, state.connection_generation,
          state.id, owner.officeId, owner.userId, owner.sessionId, owner.userId);
      if (!changed.changes) return { outcome: 'invalid' };
    } else {
      const changed = await db.prepare(`INSERT INTO google_connection(id,office_id,user_id,google_subject,email,display_name,status,granted_scopes,
        encrypted_refresh_token,encrypted_access_token,access_expires_at) SELECT ?,?,?,?,?,?,'active',?,?,?,?
        WHERE EXISTS(SELECT 1 FROM google_oauth_state WHERE id=?) AND EXISTS(SELECT 1 FROM office_member WHERE office_id=? AND user_id=?)
        AND EXISTS(SELECT 1 FROM session WHERE id=? AND userId=? AND expiresAt>CURRENT_TIMESTAMP)`)
        .run(randomUUID(), owner.officeId, owner.userId, identity.subject, identity.email, identity.name, granted,
          encryptCredential(refresh, ring), encryptCredential(token.access_token, ring), expiresAt, state.id, owner.officeId, owner.userId, owner.sessionId, owner.userId);
      if (!changed.changes) return { outcome: 'invalid' };
    }
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      return { outcome: 'account_in_use' };
    }
    throw error;
  }
  const available = modulesForScopes(granted);
  const missing = state.modules.filter(module => !available.includes(module));
  return missing.length ? { outcome: 'partial', missing } : { outcome: 'connected' };
}

async function revokeAtGoogle(token: string) {
  await googleTransport().request({
    url: `${googleHosts.oauth}/revoke`, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(), timeoutMs: 10_000, maxBytes: 16_000,
  }).catch(() => undefined);
}

/**
 * Stops all remote access for this connection: tokens are revoked at Google and erased here, queued
 * work is cancelled. Copies already imported into the Cofre stay, under the Cofre's retention.
 */
export async function closeConnection(connectionId: string, status: 'disconnected' | 'member_removed', db: Database = database) {
  const row = await db.prepare(`WITH previous AS (SELECT * FROM google_connection WHERE id=? AND status IN ('active','reauth_required') FOR UPDATE),
    closed AS (UPDATE google_connection SET status=?,encrypted_refresh_token=NULL,encrypted_access_token=NULL,access_expires_at=NULL,
    refresh_lease_token=NULL,refresh_lease_until=NULL,disconnected_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,token_generation=token_generation+1,authorization_generation=authorization_generation+1
    WHERE id IN (SELECT id FROM previous) RETURNING id)
    SELECT previous.* FROM previous JOIN closed USING(id)`).get<ConnectionRow>(connectionId, status);
  if (!row) return false;
  await db.batch([
    db.prepare('DELETE FROM google_oauth_state WHERE office_id=? AND user_id=?').bind(row.office_id, row.user_id),
    db.prepare(`UPDATE google_job SET status='cancelled',lease_token=NULL,updated_at=CURRENT_TIMESTAMP WHERE connection_id=? AND status IN ('queued','running')`).bind(connectionId),
    db.prepare(`UPDATE google_calendar SET selected=0,sync_state='removed',sync_token=NULL,channel_id=NULL,channel_resource_id=NULL,channel_token_hash=NULL,channel_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE connection_id=?`).bind(connectionId),
    db.prepare(`UPDATE google_drive_import SET status='failed',error_code='connection_closed',error_message='A conta Google foi desconectada antes da importação.' WHERE status IN ('queued','running') AND job_id IN (SELECT id FROM google_job WHERE connection_id=?)`).bind(connectionId),
  ]);
  if (row.encrypted_refresh_token) {
    try { await revokeAtGoogle(decryptCredential(row.encrypted_refresh_token, keyring())); } catch { /* the local erase already stops all use */ }
  }
  return true;
}

export async function disconnectGoogle(owner: Owner, db: Database = database) {
  const connection = await findLiveConnection(owner, db);
  if (!connection) throw new CapabilityError('NOT_FOUND', 'Nenhuma conta Google conectada.');
  await closeConnection(connection.id, 'disconnected', db);
}

/** Members who left the office lose their connection on the next maintenance pass. */
export async function sweepRemovedMembers(db: Database = database, limit = 20) {
  const rows = await db.prepare(`SELECT c.id FROM google_connection c WHERE c.status IN ('active','reauth_required')
    AND NOT EXISTS(SELECT 1 FROM office_member m WHERE m.office_id=c.office_id AND m.user_id=c.user_id) LIMIT ?`).all<{ id: string }>(limit);
  for (const row of rows) await closeConnection(row.id, 'member_removed', db);
  return rows.length;
}

// ---------- Access tokens ----------

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function markReauth(connectionId: string, lease: string, code: string, db: Database) {
  await db.batch([
    db.prepare(`UPDATE google_connection SET status='reauth_required',encrypted_access_token=NULL,access_expires_at=NULL,
      refresh_lease_token=NULL,refresh_lease_until=NULL,last_error_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND refresh_lease_token=? AND status='active'`).bind(code, connectionId, lease),
    db.prepare(`UPDATE google_job SET status='cancelled',lease_token=NULL,updated_at=CURRENT_TIMESTAMP WHERE connection_id=? AND status='queued'
      AND EXISTS(SELECT 1 FROM google_connection WHERE id=? AND status='reauth_required')`).bind(connectionId, connectionId),
  ]);
}

/**
 * A valid access token for the connection. Concurrent callers (web requests, worker, agent) share
 * one refresh: the first takes a short lease in the row and the others wait for its result, so a
 * rotating refresh token is never spent twice.
 */
export async function accessToken(connectionId: string, options: { forceRefresh?: boolean } = {}, db: Database = database): Promise<string> {
  const config = googleOAuthConfig();
  if (!config) throw new CapabilityError('NOT_READY', 'A integração Google não está configurada neste ambiente.');
  let forced = options.forceRefresh ? (await db.prepare('SELECT token_generation FROM google_connection WHERE id=?').get<{ token_generation: number }>(connectionId))?.token_generation : undefined;
  for (let attempt = 0; attempt < 150; attempt++) {
    const row = await db.prepare('SELECT * FROM google_connection WHERE id=?').get<ConnectionRow>(connectionId);
    if (!row || row.status !== 'active') throw new CapabilityError('SCOPE_REQUIRED', 'A conexão com o Google expirou. Reconecte a conta em Integrações.');
    if (!await db.prepare('SELECT 1 FROM office_member WHERE office_id=? AND user_id=?').get(row.office_id, row.user_id)) throw new CapabilityError('FORBIDDEN', 'Seu acesso ao escritório foi removido.');
    const fresh = row.encrypted_access_token && row.access_expires_at && Date.parse(row.access_expires_at) > Date.now() + 30_000;
    if (fresh && (forced === undefined || row.token_generation > forced)) return decryptCredential(row.encrypted_access_token!, keyring());
    const lease = randomUUID();
    const claimed = await db.prepare(`UPDATE google_connection SET refresh_lease_token=?,refresh_lease_until=?
      WHERE id=? AND status='active' AND token_generation=? AND (refresh_lease_until IS NULL OR refresh_lease_until<CURRENT_TIMESTAMP)`)
      .run(lease, new Date(Date.now() + 20_000).toISOString(), connectionId, row.token_generation);
    if (!claimed.changes) { await sleep(150); continue; }
    if (!row.encrypted_refresh_token) { await markReauth(connectionId, lease, 'missing_refresh_token', db); throw new CapabilityError('SCOPE_REQUIRED', 'Reconecte a conta Google em Integrações.'); }
    let response: TransportResponse;
    try {
      response = await tokenRequest({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'refresh_token', refresh_token: decryptCredential(row.encrypted_refresh_token, keyring()) });
    } catch {
      await db.prepare('UPDATE google_connection SET refresh_lease_token=NULL,refresh_lease_until=NULL WHERE id=? AND refresh_lease_token=?').run(connectionId, lease);
      throw new CapabilityError('NOT_READY', 'O Google não respondeu. Tente novamente em instantes.');
    }
    if (response.status === 400 || response.status === 401) {
      const reason = (() => { try { return decodeJson<{ error?: unknown }>(response.body).error; } catch { return undefined; } })();
      if (reason === 'invalid_grant') {
        await markReauth(connectionId, lease, 'invalid_grant', db);
        throw new CapabilityError('SCOPE_REQUIRED', 'A conexão com o Google foi revogada ou expirou. Reconecte a conta em Integrações.');
      }
      // A client configuration failure is not a revoked grant. Keep tokens and queued work intact.
      await db.prepare('UPDATE google_connection SET refresh_lease_token=NULL,refresh_lease_until=NULL WHERE id=? AND refresh_lease_token=?').run(connectionId, lease);
      captureOperationalError(new Error('OAuth refresh rejected'), 'google.oauth.refresh');
      throw new CapabilityError('NOT_READY', 'A integração Google está temporariamente indisponível. Fale com o suporte da plataforma.');
    }
    if (response.status !== 200) {
      await db.prepare('UPDATE google_connection SET refresh_lease_token=NULL,refresh_lease_until=NULL WHERE id=? AND refresh_lease_token=?').run(connectionId, lease);
      throw new CapabilityError('NOT_READY', 'O Google não respondeu. Tente novamente em instantes.');
    }
    const token = decodeJson<TokenResponse>(response.body);
    if (typeof token.access_token !== 'string' || !token.access_token || !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
      await db.prepare('UPDATE google_connection SET refresh_lease_token=NULL,refresh_lease_until=NULL WHERE id=? AND refresh_lease_token=?').run(connectionId, lease);
      throw new CapabilityError('NOT_READY', 'O Google retornou uma resposta inválida. Tente novamente.');
    }
    const ring = keyring();
    const granted = token.scope ? token.scope.split(/\s+/).filter(Boolean) : null;
    const stored = await db.prepare(`UPDATE google_connection SET encrypted_access_token=?,access_expires_at=?,
      encrypted_refresh_token=COALESCE(?,encrypted_refresh_token),granted_scopes=COALESCE(?,granted_scopes),token_generation=token_generation+1,
      refresh_lease_token=NULL,refresh_lease_until=NULL,last_error_code=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND refresh_lease_token=? AND status='active'`)
      .run(encryptCredential(token.access_token, ring), new Date(Date.now() + Math.max(60, token.expires_in - 60) * 1000).toISOString(),
        token.refresh_token ? encryptCredential(token.refresh_token, ring) : null, granted, connectionId, lease);
    if (!stored.changes) throw new CapabilityError('SCOPE_REQUIRED', 'A conexão com o Google foi encerrada.');
    forced = undefined;
    return token.access_token;
  }
  throw new CapabilityError('NOT_READY', 'A conexão com o Google está ocupada. Tente novamente em instantes.');
}

// ---------- API calls ----------

export type GoogleRequest = {
  service: GoogleService;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | string[] | undefined>;
  json?: unknown;
  body?: string | Uint8Array;
  contentType?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
};

function buildUrl(request: GoogleRequest) {
  if (!request.path.startsWith('/') || request.path.includes('..') || /[?#]/.test(request.path)) throw new Error('Caminho Google inválido.');
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach(item => query.append(key, item));
    else query.set(key, String(value));
  }
  const suffix = query.size ? `?${query}` : '';
  return `${request.service === 'gmail' ? `${googleHosts.gmail}/gmail/v1` : request.service === 'docs' ? `${googleHosts.docs}/v1` : googleHosts[request.service]}${request.path}${suffix}`;
}

/** Authorized call on behalf of a connection. A 401 refreshes once; Google errors become GoogleApiError. */
export async function googleRequest(connection: Pick<ConnectionRow, 'id'>, request: GoogleRequest, db: Database = database): Promise<TransportResponse> {
  const send = async (token: string) => {
    if (request.method && request.method !== 'GET') await checkGoogleWrite();
    return googleTransport().request({
    url: buildUrl(request), method: request.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`, accept: 'application/json',
      ...(request.json !== undefined ? { 'content-type': 'application/json' } : request.contentType ? { 'content-type': request.contentType } : {}),
      ...request.headers,
    },
    body: request.json !== undefined ? JSON.stringify(request.json) : request.body,
    timeoutMs: request.timeoutMs ?? 20_000, maxBytes: request.maxBytes ?? 8_000_000,
    });
  };
  let response = await send(await accessToken(connection.id, {}, db));
  // 401 means the request was not accepted, so a single retry with a new token is safe for writes too.
  if (response.status === 401) response = await send(await accessToken(connection.id, { forceRefresh: true }, db));
  if (response.status >= 400) throw apiErrorFrom(response);
  return response;
}

export async function googleJson<T>(connection: Pick<ConnectionRow, 'id'>, request: GoogleRequest, db: Database = database): Promise<T> {
  const response = await googleRequest(connection, request, db);
  return response.body.byteLength ? decodeJson<T>(response.body) : ({} as T);
}

export { GoogleApiError };
