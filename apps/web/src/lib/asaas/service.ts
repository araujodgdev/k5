import 'server-only';
import { randomUUID } from 'node:crypto';
import { database, withTransaction, type Transaction } from '@/lib/database';
import type { WorkspaceContext } from '@/lib/application/context';
import { CapabilityError } from '@/lib/capabilities/errors';
import { decryptCredential, encryptCredential, parseCredentialKeyring } from '@/lib/platform-crypto';
import { asaasAccount, asaasConnectInput, asaasVersionInput, type AsaasEnvironment, type AsaasStatus } from './contracts';
import { verifyAsaasAccount } from './provider';

type ConnectionRow = { environment: AsaasEnvironment; wallet_id: string; account_json: string; encrypted_api_key: string; version: string; verified_at: string };
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
    version: row.version, verifiedAt: new Date(row.verified_at).toISOString(),
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
  return getAsaasStatus(context);
}

export async function disconnectAsaas(context: WorkspaceContext, raw: unknown) {
  await authorizeAsaas(context);
  const { expectedVersion } = asaasVersionInput.parse(raw);
  await withTransaction(async tx => {
    const row = await tx.prepare('DELETE FROM asaas_connection WHERE office_id=? AND version=? RETURNING wallet_id').get<{ wallet_id: string }>(context.officeId, expectedVersion);
    if (!row) throw changed();
    await audit(tx, context, 'disconnected', row.wallet_id);
  });
  return getAsaasStatus(context);
}
