import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, withTransaction, type Transaction } from '@/lib/database';
import type { WorkspaceContext } from '@/lib/application/context';
import { CapabilityError } from '@/lib/capabilities/errors';
import { decryptCredential, encryptCredential, parseCredentialKeyring } from '@/lib/platform-crypto';
import { asaasAccount, asaasConnectInput, asaasVersionInput, type AsaasEnvironment, type AsaasStatus, type AsaasWebhookState } from './contracts';
import { AsaasProviderError, asaasRequest, verifyAsaasAccount } from './provider';

type ConnectionRow = { environment: AsaasEnvironment; wallet_id: string; account_json: string; encrypted_api_key: string; version: string; verified_at: string;
  webhook_id: string | null; webhook_state: AsaasWebhookState; webhook_error: string | null };
const changed = () => new CapabilityError('CONFLICT', 'A conexão mudou. Atualize a página antes de continuar.');

export async function authorizeAsaas(context: WorkspaceContext) {
  if (!context.sessionId || context.caseScope) throw new CapabilityError('UNAUTHENTICATED', 'Entre novamente para continuar.');
  const session = await database.prepare('SELECT 1 FROM session WHERE id=? AND userId=? AND expiresAt>CURRENT_TIMESTAMP').get(context.sessionId, context.userId);
  if (!session) throw new CapabilityError('UNAUTHENTICATED', 'Sua sessão foi encerrada. Entre novamente para continuar.');
  if (!await database.prepare('SELECT 1 FROM office_member WHERE office_id=? AND user_id=?').get(context.officeId, context.userId))
    throw new CapabilityError('FORBIDDEN', 'Seu acesso a este escritório foi removido.');
}

async function audit(tx: Transaction, context: WorkspaceContext, action: 'connected' | 'verified' | 'disconnected', walletId: string) {
  await tx.prepare('INSERT INTO asaas_connection_audit(id,office_id,actor_user_id,action,wallet_id) VALUES(?,?,?,?,?)')
    .run(randomUUID(), context.officeId, context.userId, action, walletId);
}

export async function getAsaasStatus(context: WorkspaceContext): Promise<AsaasStatus> {
  await authorizeAsaas(context);
  const row = await database.prepare('SELECT * FROM asaas_connection WHERE office_id=?').get<ConnectionRow>(context.officeId);
  return { canManage: true, connection: row ? {
    environment: row.environment, walletId: row.wallet_id, account: asaasAccount.parse(JSON.parse(row.account_json)),
    version: row.version, verifiedAt: new Date(row.verified_at).toISOString(), webhook: { state: row.webhook_state, error: row.webhook_error },
  } : null };
}

/** The decrypted key for server-side calls on the office's behalf. Never send it to the browser. */
export async function asaasCredential(officeId: string, db: Pick<Transaction, 'prepare'> = database) {
  const row = await db.prepare('SELECT environment,wallet_id,encrypted_api_key FROM asaas_connection WHERE office_id=?')
    .get<Pick<ConnectionRow, 'environment' | 'wallet_id' | 'encrypted_api_key'>>(officeId);
  if (!row) return null;
  return { environment: row.environment, walletId: row.wallet_id, apiKey: decryptCredential(row.encrypted_api_key, parseCredentialKeyring()) };
}

export async function connectAsaas(context: WorkspaceContext, raw: unknown) {
  await authorizeAsaas(context);
  const input = asaasConnectInput.parse(raw);
  const ring = parseCredentialKeyring();
  const verified = await verifyAsaasAccount(input.apiKey);
  await authorizeAsaas(context);
  await withTransaction(async tx => {
    await tx.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(`asaas-wallet:${verified.walletId}`);
    await tx.prepare('SELECT id FROM office WHERE id=? FOR UPDATE').get(context.officeId);
    const existing = await tx.prepare('SELECT wallet_id,version FROM asaas_connection WHERE office_id=?').get<Pick<ConnectionRow, 'wallet_id' | 'version'>>(context.officeId);
    if ((existing?.version ?? null) !== input.expectedVersion) throw changed();
    if (existing && existing.wallet_id !== verified.walletId)
      throw new CapabilityError('CONFLICT', 'A chave pertence a outra conta do Asaas. Desconecte a conta atual antes de trocar de conta.');
    const owner = await tx.prepare('SELECT office_id FROM asaas_connection WHERE wallet_id=?').get<{ office_id: string }>(verified.walletId);
    if (owner && owner.office_id !== context.officeId) throw new CapabilityError('CONFLICT', 'Esta conta do Asaas já está conectada a outro escritório.');
    await tx.prepare(`INSERT INTO asaas_connection(office_id,environment,wallet_id,encrypted_api_key,account_json,version) VALUES(?,?,?,?,?,?)
      ON CONFLICT(office_id) DO UPDATE SET environment=excluded.environment,encrypted_api_key=excluded.encrypted_api_key,
      account_json=excluded.account_json,version=excluded.version,verified_at=CURRENT_TIMESTAMP`)
      .run(context.officeId, verified.environment, verified.walletId, encryptCredential(input.apiKey, ring), JSON.stringify(verified.account), randomUUID());
    await audit(tx, context, 'connected', verified.walletId);
  });
  await syncAsaasWebhook(context);
  return getAsaasStatus(context);
}

export async function refreshAsaas(context: WorkspaceContext, raw: unknown) {
  await authorizeAsaas(context);
  const { expectedVersion } = asaasVersionInput.parse(raw);
  const row = await database.prepare('SELECT * FROM asaas_connection WHERE office_id=?').get<ConnectionRow>(context.officeId);
  if (!row || row.version !== expectedVersion) throw changed();
  const verified = await verifyAsaasAccount(decryptCredential(row.encrypted_api_key, parseCredentialKeyring()));
  if (verified.walletId !== row.wallet_id) throw new CapabilityError('CONFLICT', 'A chave retornou outra conta do Asaas. Confira a conexão.');
  await authorizeAsaas(context);
  await withTransaction(async tx => {
    const updated = await tx.prepare(`UPDATE asaas_connection SET account_json=?,version=?,verified_at=CURRENT_TIMESTAMP
      WHERE office_id=? AND version=? AND wallet_id=? RETURNING office_id`)
      .get(JSON.stringify(verified.account), randomUUID(), context.officeId, expectedVersion, verified.walletId);
    if (!updated) throw changed();
    await audit(tx, context, 'verified', verified.walletId);
  });
  await syncAsaasWebhook(context);
  return getAsaasStatus(context);
}

export async function disconnectAsaas(context: WorkspaceContext, raw: unknown) {
  await authorizeAsaas(context);
  const { expectedVersion } = asaasVersionInput.parse(raw);
  const removed = await withTransaction(async tx => {
    await lockWebhook(tx, context.officeId);
    const row = await tx.prepare('DELETE FROM asaas_connection WHERE office_id=? AND version=? RETURNING environment,wallet_id,encrypted_api_key,webhook_id')
      .get<Pick<ConnectionRow, 'environment' | 'wallet_id' | 'encrypted_api_key' | 'webhook_id'>>(context.officeId, expectedVersion);
    if (!row) throw changed();
    await audit(tx, context, 'disconnected', row.wallet_id);
    return row;
  });
  // The Lume no longer accepts this webhook's token; removing it spares the account a failing queue.
  if (removed.webhook_id) {
    const apiKey = decryptCredential(removed.encrypted_api_key, parseCredentialKeyring());
    await asaasRequest(removed.environment, apiKey, 'DELETE', `/webhooks/${encodeURIComponent(removed.webhook_id)}`, z.unknown()).catch(() => undefined);
  }
  return getAsaasStatus(context);
}

const WEBHOOK_EVENTS = ['PAYMENT_CREATED', 'PAYMENT_UPDATED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'PAYMENT_DELETED',
  'PAYMENT_RESTORED', 'PAYMENT_REFUNDED', 'PAYMENT_RECEIVED_IN_CASH_UNDONE', 'PAYMENT_CHARGEBACK_REQUESTED'];
const remoteWebhook = z.object({ id: z.string().min(1).max(100), url: z.string().max(2_000), enabled: z.boolean().nullish(), interrupted: z.boolean().nullish() });

/** Serializes webhook changes of one office: syncs wait for each other, and a disconnect sees the latest hook. */
const lockWebhook = (tx: Transaction, officeId: string) => tx.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(`asaas-webhook:${officeId}`);

export const asaasWebhookTokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/** The public HTTPS address Asaas can reach; null where the Lume runs locally. */
export function asaasWebhookUrl(base = process.env.ASAAS_WEBHOOK_BASE_URL || process.env.BETTER_AUTH_URL) {
  if (!base) return null;
  let url: URL;
  try { url = new URL('/api/asaas/webhook', base); } catch { return null; }
  if (url.protocol !== 'https:' || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url.hostname) || url.hostname.endsWith('.local')) return null;
  return url.toString();
}

/**
 * Makes the account notify the Lume: reactivates an interrupted queue, or replaces a missing webhook
 * after removing stale ones with the same address. A failure is recorded for the panel, never thrown.
 */
export async function syncAsaasWebhook(context: WorkspaceContext) {
  // One sync per office at a time, across the whole remote sequence: otherwise a second sync can delete
  // the hook the first one created and leave the stored hash pointing at a token Asaas no longer sends.
  await withTransaction(async tx => {
    await lockWebhook(tx, context.officeId);
    const row = await tx.prepare('SELECT environment,wallet_id,encrypted_api_key,webhook_id FROM asaas_connection WHERE office_id=?')
      .get<Pick<ConnectionRow, 'environment' | 'wallet_id' | 'encrypted_api_key' | 'webhook_id'>>(context.officeId);
    if (!row) return;
    const record = (state: AsaasWebhookState, error: string | null, hook?: { id: string; tokenHash: string } | null) => tx.prepare(`UPDATE asaas_connection
      SET webhook_state=?,webhook_error=?,webhook_id=CASE WHEN ? THEN ? ELSE webhook_id END,webhook_token_hash=CASE WHEN ? THEN ? ELSE webhook_token_hash END
      WHERE office_id=? AND wallet_id=?`).run(state, error, hook !== undefined, hook?.id ?? null, hook !== undefined, hook?.tokenHash ?? null, context.officeId, row.wallet_id);
    const url = asaasWebhookUrl();
    if (!url) { await record('unavailable', null, null); return; }
    const apiKey = decryptCredential(row.encrypted_api_key, parseCredentialKeyring());
    const call = <T extends z.ZodType>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, schema: T, body?: unknown) => asaasRequest(row.environment, apiKey, method, path, schema, body);
    try {
      if (row.webhook_id) {
        const path = `/webhooks/${encodeURIComponent(row.webhook_id)}`;
        const current = await call('GET', path, remoteWebhook).catch(error => {
          if (error instanceof AsaasProviderError && error.upstream === 404) return null;
          throw error;
        });
        if (current?.url === url) {
          if (current.interrupted || current.enabled === false) await call('PUT', path, remoteWebhook, { enabled: true, interrupted: false });
          await record('active', null);
          return;
        }
      }
      const existing = await call('GET', '/webhooks?limit=100', z.object({ data: z.array(remoteWebhook) }));
      for (const stale of existing.data.filter(hook => hook.url === url)) await call('DELETE', `/webhooks/${encodeURIComponent(stale.id)}`, z.unknown());
      const user = await tx.prepare('SELECT email FROM "user" WHERE id=?').get<{ email: string }>(context.userId);
      const token = randomBytes(32).toString('base64url');
      const created = await call('POST', '/webhooks', remoteWebhook, {
        name: 'Lume - honorários', url, email: user?.email, enabled: true, interrupted: false, apiVersion: 3, authToken: token,
        sendType: 'SEQUENTIALLY', events: WEBHOOK_EVENTS,
      });
      await record('active', null, { id: created.id, tokenHash: asaasWebhookTokenHash(token) });
    } catch (error) {
      await record('failed', error instanceof AsaasProviderError ? error.message.slice(0, 500) : 'Não foi possível configurar o aviso de pagamentos no Asaas.');
    }
  });
}
