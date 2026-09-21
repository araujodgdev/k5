import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import { credentialHint, decryptCredential, encryptCredential, parseCredentialKeyring } from '@/lib/platform-crypto';

const SECRET_REF_TTL_MS = 15 * 60 * 1000;

/**
 * A provider key is submitted by a human through the platform form and parked here under the
 * master key. Tools receive only the reference id, so the key is never a tool argument, never
 * reaches a prompt, and is never echoed back to a caller.
 */
export async function createSecretRef(userId: string, secret: string): Promise<{ id: string; hint: string; expiresAt: number }> {
  const clean = secret.trim();
  if (!clean || clean.length > 4096) throw new CapabilityError('INVALID', 'Informe a chave do provedor.');
  const id = randomUUID();
  const expiresAt = Date.now() + SECRET_REF_TTL_MS;
  const hint = credentialHint(clean);
  await database.prepare(`
    INSERT INTO platform_secret_ref (id, user_id, purpose, encrypted_secret, secret_hint, expires_at)
    VALUES (?, ?, 'ai_connection_key', ?, ?, ?)
  `).run(id, userId, encryptCredential(clean, parseCredentialKeyring()), hint, expiresAt);
  return { id, hint, expiresAt };
}

/** Single use and bound to the person who submitted it, claimed with a conditional UPDATE. */
export async function consumeSecretRef(userId: string, refId: string): Promise<string> {
  const claimed = await database.prepare(
    "UPDATE platform_secret_ref SET consumed_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND purpose = 'ai_connection_key' AND consumed_at IS NULL AND expires_at > ?",
  ).run(refId, userId, Date.now());

  if (!claimed.changes) {
    throw new CapabilityError('NOT_FOUND', 'Referência de segredo inválida, expirada ou já utilizada. Reenvie a chave pelo formulário.');
  }

  const row = await database.prepare('SELECT encrypted_secret AS encrypted FROM platform_secret_ref WHERE id = ?')
    .get(refId) as { encrypted: string };
  const secret = decryptCredential(String(row.encrypted), parseCredentialKeyring());

  // The plaintext exists only for this call; the row keeps nothing recoverable afterwards.
  await database.prepare("UPDATE platform_secret_ref SET encrypted_secret = '' WHERE id = ?").run(refId);
  return secret;
}

export async function sweepExpiredSecretRefs(): Promise<number> {
  return Number((await database.prepare('DELETE FROM platform_secret_ref WHERE expires_at < ?').run(Date.now() - SECRET_REF_TTL_MS)).changes ?? 0);
}
