import { randomUUID } from 'node:crypto';
import type { Transaction } from './db/postgres';
import { credentialNeedsReencryption, decryptCredential, encryptCredential, type CredentialKeyring } from './platform-crypto';
import { PlatformRequestError } from './platform-core';

// Identifiers are a fixed allowlist, never request input. Keep all encrypted columns together.
const targets = [
  { table: 'ai_connection', pk: 'id', fields: ['encrypted_api_key'] },
  { table: 'google_connection', pk: 'id', fields: ['encrypted_refresh_token', 'encrypted_access_token'] },
  { table: 'google_oauth_state', pk: 'id', fields: ['encrypted_verifier'] },
  { table: 'google_operation', pk: 'id', fields: ['encrypted_args', 'encrypted_result', 'checkpoint_json'] },
  { table: 'platform_secret_ref', pk: 'id', fields: ['encrypted_secret'] },
  { table: 'push_subscription', pk: 'id', fields: ['encrypted_subscription'] },
  { table: 'typesafe_connection', pk: 'office_id', fields: ['encrypted_api_key'] },
  { table: 'typesafe_platform_connection', pk: 'id', fields: ['encrypted_api_key'] },
] as const;

export type CredentialRotationStatus = {
  keyId: string;
  total: number;
  pending: number;
  unreadable: number;
};

export class CredentialRotationError extends Error {
  constructor() { super('Não foi possível validar todas as credenciais. Nenhuma alteração foi concluída.'); }
}

function absent(table: string, value: unknown) {
  // Consuming a one-use reference deliberately erases its ciphertext with an empty string.
  return value === null || (table === 'platform_secret_ref' && value === '');
}

/** Read-only preflight; authenticated decryption also detects a damaged current-key envelope. */
export async function credentialRotationStatus(db: Transaction, ring: CredentialKeyring): Promise<CredentialRotationStatus> {
  const status = { keyId: ring.current.id, total: 0, pending: 0, unreadable: 0 };
  for (const target of targets) {
    const rows = await db.prepare(`SELECT ${target.fields.join(',')} FROM ${target.table}`).all<Record<string, string | null>>();
    for (const row of rows) for (const field of target.fields) {
      const value = row[field];
      if (absent(target.table, value)) continue;
      status.total++;
      try {
        decryptCredential(value!, ring);
        if (credentialNeedsReencryption(value!, ring)) status.pending++;
      } catch { status.unreadable++; status.pending++; }
    }
  }
  return status;
}

/** Must run inside one transaction: row locks, ciphertext changes and audit commit together. */
export async function rotateCredentials(tx: Transaction, ring: CredentialKeyring, actorUserId: string, expectedKeyId: string) {
  const actor = await tx.prepare('SELECT user_id FROM platform_admin WHERE user_id=? FOR KEY SHARE').get(actorUserId);
  if (!actor) throw new PlatformRequestError(403, 'Acesso restrito aos administradores da plataforma.');
  if (expectedKeyId !== ring.current.id) throw new PlatformRequestError(409, 'A chave ativa mudou. Atualize a página antes de continuar.');
  try {
    await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('k5.credentials.rotate'))").get();
    let total = 0, reencrypted = 0;
    for (const target of targets) {
      const rows = await tx.prepare(`SELECT ${target.pk},${target.fields.join(',')} FROM ${target.table} ORDER BY ${target.pk} FOR UPDATE`).all<Record<string, string | number | null>>();
      for (const row of rows) for (const field of target.fields) {
        const value = row[field] as string | null;
        if (absent(target.table, value)) continue;
        total++;
        const plaintext = decryptCredential(value!, ring);
        if (!credentialNeedsReencryption(value!, ring)) continue;
        await tx.prepare(`UPDATE ${target.table} SET ${field}=? WHERE ${target.pk}=?`).run(encryptCredential(plaintext, ring), row[target.pk]);
        reencrypted++;
      }
    }
    if (reencrypted) await tx.prepare('INSERT INTO platform_audit_log (id,actor_user_id,action,details_json) VALUES (?,?,?,?)')
      .run(randomUUID(), actorUserId, 'credentials.master_key_reencrypted', JSON.stringify({ keyId: ring.current.id, total, reencrypted }));
    return { keyId: ring.current.id, total, reencrypted };
  } catch { throw new CredentialRotationError(); }
}
