import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { database, withTransaction } from '@/lib/database';
import { assertCapabilityAllowed, type WorkspaceContext } from '@/lib/application/context';
import { CapabilityError } from '@/lib/capabilities/errors';
import { decryptCredential, encryptCredential, parseCredentialKeyring } from '@/lib/platform-crypto';
import { type ConnectionRow, type ConnectionStatus } from './domain';
import { whatsappEnvironment } from './environment';
import { isWhatsAppEnabled } from './rollout';
import { connectionUrl, createProfile, createProfileKey, deleteAccount, getAccount, revokeKey } from './provider';
import { enqueueWhatsAppJob } from './jobs';
import { reserveWhatsAppApiCall } from './limits';
import { ZernioError } from './transport';
import { wakeWhatsAppWorker } from './wake';

function keyring() {
  const env = whatsappEnvironment();
  return parseCredentialKeyring(env.K5_CREDENTIALS_KEY, env.K5_CREDENTIALS_PREVIOUS_KEYS, env.K5_CREDENTIALS_NEXT_KEY);
}

export function connectedCredential(connection: ConnectionRow) {
  if (!connection.encrypted_api_key) throw new CapabilityError('NOT_READY', 'Reconecte o WhatsApp Business para continuar.');
  return decryptCredential(connection.encrypted_api_key, keyring());
}

export async function authorizeWhatsApp(context: WorkspaceContext, options: { write?: boolean; allowDisabled?: boolean } = {}) {
  const current = await assertCapabilityAllowed(context, options.write ? 'k5_whatsapp_send' : 'k5_whatsapp_list_threads');
  if (!options.allowDisabled && !await isWhatsAppEnabled(current.officeId)) throw new CapabilityError('NOT_FOUND', 'O WhatsApp não está disponível para este escritório.');
  return current;
}

export async function requireWhatsApp(context: WorkspaceContext, options: { write?: boolean; allowDisabled?: boolean } = {}) {
  await authorizeWhatsApp(context, options);
  const connection = await database.prepare('SELECT * FROM whatsapp_connection WHERE office_id=?').get<ConnectionRow>(context.officeId);
  if (!connection || !connection.account_id || !['connected', ...(options.write ? [] : ['reconnect_required'])].includes(connection.status)) {
    throw new CapabilityError('NOT_READY', 'Conecte o WhatsApp Business em Integrações para continuar.');
  }
  return connection;
}

export async function whatsappStatus(context: WorkspaceContext): Promise<ConnectionStatus> {
  await authorizeWhatsApp(context, { allowDisabled: true });
  const connection = await database.prepare('SELECT * FROM whatsapp_connection WHERE office_id=?').get<ConnectionRow>(context.officeId);
  return {
    enabled: await isWhatsAppEnabled(context.officeId),
    configured: Boolean(whatsappEnvironment().ZERNIO_API_KEY && whatsappEnvironment().ZERNIO_WEBHOOK_SECRET),
    canManage: true,
    connection: connection ? { id: connection.id, status: connection.status, number: connection.number, label: connection.label, updatedAt: connection.updated_at } : null,
  };
}

export async function beginWhatsAppConnect(context: WorkspaceContext) {
  await authorizeWhatsApp(context, { write: true });
  if (!context.sessionId) throw new CapabilityError('UNAUTHENTICATED', 'Entre novamente para conectar o WhatsApp.');
  const env = whatsappEnvironment();
  if (!env.ZERNIO_API_KEY || !env.ZERNIO_WEBHOOK_SECRET || !env.BETTER_AUTH_URL) {
    throw new CapabilityError('NOT_READY', 'A conexão WhatsApp ainda não está configurada. Fale com o suporte.');
  }
  keyring();
  const state = randomBytes(32).toString('base64url');
  const stateHash = createHash('sha256').update(state).digest('hex');
  const reserved = await withTransaction(async tx => {
    await tx.prepare('SELECT id FROM office WHERE id=? FOR UPDATE').get(context.officeId);
    let row = await tx.prepare('SELECT * FROM whatsapp_connection WHERE office_id=?').get<ConnectionRow>(context.officeId);
    if (row && ['pending', 'unknown'].includes(row.key_provisioning_state)) throw new CapabilityError('NOT_READY', 'A criação da credencial precisa ser conferida pelo suporte antes de conectar novamente.');
    if (row?.status === 'connected' || row?.status === 'disconnecting') throw new CapabilityError('CONFLICT', 'A conexão atual precisa ser encerrada antes de iniciar outra.');
    const pending = await tx.prepare("SELECT id FROM whatsapp_connect_state WHERE office_id=? AND status IN ('pending','verifying') AND expires_at>CURRENT_TIMESTAMP").get(context.officeId);
    if (pending) throw new CapabilityError('CONFLICT', 'Já existe uma conexão em andamento. Conclua o fluxo ou aguarde dez minutos.');
    if (!row) {
      row = await tx.prepare("INSERT INTO whatsapp_connection(id,office_id,status) VALUES(?,?,'pending') RETURNING *").get<ConnectionRow>(randomUUID(), context.officeId);
    } else {
      row = await tx.prepare("UPDATE whatsapp_connection SET generation=generation+1,status='pending',updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING *").get<ConnectionRow>(row.id);
    }
    if (!row) throw new CapabilityError('CONFLICT', 'Não foi possível iniciar a conexão. Tente novamente.');
    await tx.prepare(`INSERT INTO whatsapp_connect_state(id,office_id,connection_id,generation,user_id,session_id,state_hash,expires_at)
      VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP+INTERVAL '10 minutes')`).run(randomUUID(), context.officeId, row.id, row.generation, context.userId, context.sessionId, stateHash);
    return row;
  });
  try {
    let profileId = reserved.profile_id;
    if (!profileId) {
      await reserveWhatsAppApiCall(context.officeId);
      profileId = (await createProfile(context.officeId)).id;
      const saved = await database.prepare("UPDATE whatsapp_connection SET profile_id=? WHERE id=? AND generation=? AND status='pending' RETURNING id")
        .get(profileId, reserved.id, reserved.generation);
      if (!saved) throw new CapabilityError('CONFLICT', 'A conexão foi interrompida. Inicie novamente.');
    }
    const redirect = new URL('/api/whatsapp/callback', env.BETTER_AUTH_URL);
    redirect.searchParams.set('state', state);
    await reserveWhatsAppApiCall(context.officeId);
    const url = await connectionUrl(profileId, redirect.toString());
    await authorizeWhatsApp(context, { write: true });
    return { url };
  } catch (error) {
    await database.prepare("UPDATE whatsapp_connect_state SET status='consumed' WHERE state_hash=?").run(stateHash);
    await database.prepare("UPDATE whatsapp_connection SET status=CASE WHEN account_id IS NULL THEN 'disconnected' ELSE 'reconnect_required' END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND generation=? AND status='pending'").run(reserved.id, reserved.generation);
    throw error;
  }
}

export async function completeWhatsAppConnect(context: WorkspaceContext, input: { state: string; accountId: string; profileId: string }) {
  await authorizeWhatsApp(context, { write: true });
  if (!context.sessionId) throw new CapabilityError('UNAUTHENTICATED', 'Entre novamente para continuar.');
  const hash = createHash('sha256').update(input.state).digest('hex');
  const claimed = await database.prepare(`UPDATE whatsapp_connect_state SET status='verifying'
    WHERE state_hash=? AND office_id=? AND user_id=? AND session_id=? AND status='pending' AND expires_at>CURRENT_TIMESTAMP
    RETURNING connection_id,generation`).get<{ connection_id: string; generation: number }>(hash, context.officeId, context.userId, context.sessionId);
  if (!claimed) throw new CapabilityError('CONFLICT', 'Esta conexão expirou ou já foi utilizada. Inicie novamente.');
  let newKey: { id: string; key: string } | undefined;
  try {
    const connection = await database.prepare("SELECT * FROM whatsapp_connection WHERE id=? AND office_id=? AND generation=? AND status='pending'")
      .get<ConnectionRow>(claimed.connection_id, context.officeId, claimed.generation);
    if (!connection || connection.profile_id !== input.profileId) throw new CapabilityError('FORBIDDEN', 'A conta não corresponde à conexão deste escritório.');
    await reserveWhatsAppApiCall(context.officeId);
    const account = await getAccount(input.accountId, input.profileId);
    await authorizeWhatsApp(context, { write: true });
    await reserveWhatsAppApiCall(context.officeId);
    const operationId = randomUUID();
    const provisioning = await database.prepare(`UPDATE whatsapp_connection SET key_provisioning_state='pending',key_operation_id=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND generation=? AND status='pending' AND key_provisioning_state IN ('none','ready') RETURNING id`)
      .get(operationId, connection.id, claimed.generation);
    if (!provisioning) throw new CapabilityError('NOT_READY', 'A criação da credencial precisa ser conferida pelo suporte.');
    const createdKey = await createProfileKey(input.profileId, operationId);
    newKey = createdKey;
    const encrypted = encryptCredential(createdKey.key, keyring());
    await authorizeWhatsApp(context, { write: true });
    await withTransaction(async tx => {
      const pending = await tx.prepare("SELECT id FROM whatsapp_connect_state WHERE state_hash=? AND status='verifying' AND expires_at>CURRENT_TIMESTAMP FOR UPDATE").get(hash);
      if (!pending) throw new CapabilityError('CONFLICT', 'Esta conexão expirou. Inicie novamente.');
      const updated = await tx.prepare(`UPDATE whatsapp_connection SET account_id=?,number=?,label=?,encrypted_api_key=?,api_key_id=?,
        status='connected',key_provisioning_state='ready',sync_state='pending',sync_cursor=NULL,verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND office_id=? AND generation=? AND status='pending' RETURNING id`)
        .get(account.id, account.number, account.label, encrypted, createdKey.id, connection.id, context.officeId, claimed.generation);
      if (!updated) throw new CapabilityError('CONFLICT', 'A conexão foi interrompida. Inicie novamente.');
      await tx.prepare("UPDATE whatsapp_connect_state SET status='consumed' WHERE state_hash=?").run(hash);
      await enqueueWhatsAppJob(tx, { officeId: context.officeId, connectionId: connection.id, generation: claimed.generation, kind: 'conversations', dedupeKey: `conversations:${connection.id}:${claimed.generation}` });
      if (connection.api_key_id && connection.api_key_id !== createdKey.id) {
        await enqueueWhatsAppJob(tx, { officeId: context.officeId, connectionId: connection.id, generation: claimed.generation, kind: 'revoke_key', subjectId: connection.api_key_id, dedupeKey: `revoke:${connection.api_key_id}` });
      }
    });
    await wakeWhatsAppWorker();
    return { connected: true };
  } catch (error) {
    const connected = await database.prepare("SELECT id FROM whatsapp_connection WHERE id=? AND generation=? AND status='connected'").get(claimed.connection_id, claimed.generation);
    if (newKey && !connected) {
      await enqueueWhatsAppJob(database, { officeId: context.officeId, connectionId: claimed.connection_id, generation: claimed.generation, kind: 'revoke_key', subjectId: newKey.id, dedupeKey: `revoke:${newKey.id}` });
    }
    if (!connected) {
      await database.prepare("UPDATE whatsapp_connect_state SET status='consumed' WHERE state_hash=?").run(hash);
      const keyState = newKey || error instanceof ZernioError && !error.isAmbiguous ? 'none' : 'unknown';
      await database.prepare("UPDATE whatsapp_connection SET key_provisioning_state=? WHERE id=? AND generation=? AND key_provisioning_state='pending'")
        .run(keyState, claimed.connection_id, claimed.generation);
      await database.prepare("UPDATE whatsapp_connection SET status='reconnect_required',updated_at=CURRENT_TIMESTAMP WHERE id=? AND generation=? AND status='pending'").run(claimed.connection_id, claimed.generation);
    }
    if (connected) return { connected: true };
    throw error;
  }
}

export async function disconnectWhatsApp(context: WorkspaceContext) {
  await authorizeWhatsApp(context, { write: true, allowDisabled: true });
  await withTransaction(async tx => {
    const row = await tx.prepare("UPDATE whatsapp_connection SET status='disconnecting',generation=generation+1,updated_at=CURRENT_TIMESTAMP WHERE office_id=? AND status NOT IN ('disconnected','disconnecting') RETURNING *").get<ConnectionRow>(context.officeId);
    if (!row) return;
    await tx.prepare("UPDATE whatsapp_connect_state SET status='consumed' WHERE office_id=?").run(context.officeId);
    await enqueueWhatsAppJob(tx, { officeId: context.officeId, connectionId: row.id, generation: row.generation, kind: 'disconnect', dedupeKey: `disconnect:${row.id}:${row.generation}` });
  });
  await wakeWhatsAppWorker();
  return { status: 'disconnecting' };
}

export async function cancelWhatsAppConnect(context: WorkspaceContext, state: string) {
  await authorizeWhatsApp(context, { write: true, allowDisabled: true });
  if (!context.sessionId) throw new CapabilityError('UNAUTHENTICATED', 'Entre novamente para continuar.');
  const hash = createHash('sha256').update(state).digest('hex');
  await withTransaction(async tx => {
    const pending = await tx.prepare(`UPDATE whatsapp_connect_state SET status='consumed'
      WHERE state_hash=? AND office_id=? AND user_id=? AND session_id=? AND status='pending'
      RETURNING connection_id,generation`).get<{ connection_id: string; generation: number }>(hash, context.officeId, context.userId, context.sessionId);
    if (!pending) throw new CapabilityError('CONFLICT', 'Esta conexão expirou ou já foi utilizada.');
    await tx.prepare(`UPDATE whatsapp_connection SET status=CASE WHEN account_id IS NULL THEN 'disconnected' ELSE 'reconnect_required' END,
      updated_at=CURRENT_TIMESTAMP WHERE id=? AND generation=? AND status='pending'`).run(pending.connection_id, pending.generation);
  });
}

export async function finishDisconnect(connectionId: string, generation: number) {
  const row = await database.prepare("SELECT * FROM whatsapp_connection WHERE id=? AND generation=? AND status='disconnecting'").get<ConnectionRow>(connectionId, generation);
  if (!row) return;
  if (row.account_id) { await reserveWhatsAppApiCall(row.office_id); await deleteAccount(row.account_id); }
  if (row.api_key_id) { await reserveWhatsAppApiCall(row.office_id); await revokeKey(row.api_key_id); }
  await database.prepare("UPDATE whatsapp_connection SET status='disconnected',encrypted_api_key=NULL,api_key_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND generation=? AND status='disconnecting'").run(row.id, generation);
}

export async function finishRevokeKey(connectionId: string, keyId: string) {
  const row = await database.prepare('SELECT * FROM whatsapp_connection WHERE id=?').get<ConnectionRow>(connectionId);
  if (!row || row.api_key_id === keyId) return;
  await reserveWhatsAppApiCall(row.office_id);
  await revokeKey(keyId);
}
