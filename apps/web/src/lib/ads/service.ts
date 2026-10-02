import 'server-only';
import { randomUUID } from 'node:crypto';
import { database, withTransaction } from '@/lib/database';
import type { WorkspaceContext } from '@/lib/application/context';
import { CapabilityError } from '@/lib/capabilities/errors';
import { decryptCredential, encryptCredential, parseCredentialKeyring } from '@/lib/platform-crypto';
import { adsAccount, adsConnectInput, adsVersionInput, type AdsStatus } from './contracts';
import { adsEnvironment } from './environment';
import { isAdsEnabled } from './rollout';
import { verifyAdsAccount } from './provider';

type ConnectionRow = { account_id: string; account_json: string; encrypted_api_key: string; version: string; verified_at: string };

function keyring() {
  const env = adsEnvironment();
  return parseCredentialKeyring(env.K5_CREDENTIALS_KEY, env.K5_CREDENTIALS_PREVIOUS_KEYS, env.K5_CREDENTIALS_NEXT_KEY);
}

export async function authorizeAds(context: WorkspaceContext) {
  if (!context.sessionId || context.caseScope) throw new CapabilityError('UNAUTHENTICATED', 'Entre novamente para continuar.');
  const session = await database.prepare('SELECT 1 FROM session WHERE id=? AND userId=? AND expiresAt>CURRENT_TIMESTAMP').get(context.sessionId, context.userId);
  if (!session) throw new CapabilityError('UNAUTHENTICATED', 'Sua sessão foi encerrada. Entre novamente para continuar.');
  if (!await database.prepare('SELECT 1 FROM office_member WHERE office_id=? AND user_id=?').get(context.officeId, context.userId))
    throw new CapabilityError('FORBIDDEN', 'Seu acesso a este escritório foi removido.');
  if (!await isAdsEnabled(context)) throw new CapabilityError('NOT_FOUND', 'Anúncios não está disponível.');
}

export async function getAdsStatus(context: WorkspaceContext): Promise<AdsStatus> {
  await authorizeAds(context);
  const row = await database.prepare('SELECT * FROM ads_connection WHERE office_id=?').get<ConnectionRow>(context.officeId);
  return { canManage: true, connection: row ? {
    account: adsAccount.parse(JSON.parse(row.account_json)), version: row.version, verifiedAt: row.verified_at,
  } : null };
}

export async function connectAds(context: WorkspaceContext, raw: unknown) {
  await authorizeAds(context);
  const input = adsConnectInput.parse(raw);
  const ring = keyring();
  const account = await verifyAdsAccount(input.apiKey);
  await authorizeAds(context);
  await withTransaction(async tx => {
    await tx.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(`ads-account:${account.id}`);
    await tx.prepare('SELECT id FROM office WHERE id=? FOR UPDATE').get(context.officeId);
    const existing = await tx.prepare('SELECT account_id,version FROM ads_connection WHERE office_id=?').get<Pick<ConnectionRow, 'account_id' | 'version'>>(context.officeId);
    if ((existing?.version ?? null) !== input.expectedVersion) throw new CapabilityError('CONFLICT', 'A conexão mudou. Atualize a página antes de continuar.');
    if (existing && existing.account_id !== account.id) throw new CapabilityError('CONFLICT', 'A chave pertence a outra conta. Desconecte a conta atual antes de substituí-la.');
    const owner = await tx.prepare('SELECT office_id FROM ads_connection WHERE account_id=?').get<{ office_id: string }>(account.id);
    if (owner && owner.office_id !== context.officeId) throw new CapabilityError('CONFLICT', 'Esta conta de anúncios já está conectada a outro escritório.');
    await tx.prepare(`INSERT INTO ads_connection(office_id,account_id,encrypted_api_key,account_json,version) VALUES(?,?,?,?,?)
      ON CONFLICT(office_id) DO UPDATE SET encrypted_api_key=excluded.encrypted_api_key,account_json=excluded.account_json,
      version=excluded.version,verified_at=CURRENT_TIMESTAMP`)
      .run(context.officeId, account.id, encryptCredential(input.apiKey, ring), JSON.stringify(account), randomUUID());
    await tx.prepare('INSERT INTO ads_connection_audit(id,office_id,actor_user_id,action,account_id) VALUES(?,?,?,?,?)')
      .run(randomUUID(), context.officeId, context.userId, 'connected', account.id);
  });
  return getAdsStatus(context);
}

export async function refreshAds(context: WorkspaceContext, raw: unknown) {
  await authorizeAds(context);
  const { expectedVersion } = adsVersionInput.parse(raw);
  const row = await database.prepare('SELECT * FROM ads_connection WHERE office_id=?').get<ConnectionRow>(context.officeId);
  if (!row || row.version !== expectedVersion) throw new CapabilityError('CONFLICT', 'A conexão mudou. Atualize a página antes de continuar.');
  const account = await verifyAdsAccount(decryptCredential(row.encrypted_api_key, keyring()));
  if (account.id !== row.account_id) throw new CapabilityError('CONFLICT', 'A chave retornou uma conta diferente. Confira a conexão.');
  await authorizeAds(context);
  await withTransaction(async tx => {
    const updated = await tx.prepare(`UPDATE ads_connection SET account_json=?,version=?,verified_at=CURRENT_TIMESTAMP
      WHERE office_id=? AND version=? AND account_id=? RETURNING office_id`)
      .get(JSON.stringify(account), randomUUID(), context.officeId, expectedVersion, account.id);
    if (!updated) throw new CapabilityError('CONFLICT', 'A conexão mudou. Atualize a página antes de continuar.');
    await tx.prepare('INSERT INTO ads_connection_audit(id,office_id,actor_user_id,action,account_id) VALUES(?,?,?,?,?)')
      .run(randomUUID(), context.officeId, context.userId, 'verified', account.id);
  });
  return getAdsStatus(context);
}

export async function disconnectAds(context: WorkspaceContext, raw: unknown) {
  await authorizeAds(context);
  const { expectedVersion } = adsVersionInput.parse(raw);
  await withTransaction(async tx => {
    const row = await tx.prepare('DELETE FROM ads_connection WHERE office_id=? AND version=? RETURNING account_id')
      .get<{ account_id: string }>(context.officeId, expectedVersion);
    if (!row) throw new CapabilityError('CONFLICT', 'A conexão mudou. Atualize a página antes de continuar.');
    await tx.prepare('INSERT INTO ads_connection_audit(id,office_id,actor_user_id,action,account_id) VALUES(?,?,?,?,?)')
      .run(randomUUID(), context.officeId, context.userId, 'disconnected', row.account_id);
  });
  return getAdsStatus(context);
}
