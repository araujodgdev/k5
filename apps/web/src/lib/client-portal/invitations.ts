import { createHash } from 'node:crypto';
import type { Database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';

export const invitationHash = (token: string) => createHash('sha256').update(token).digest('hex');
export async function portalInvitation(db: Pick<Database, 'prepare'>, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new CapabilityError('NOT_FOUND', 'Convite inválido ou expirado. Peça um novo convite ao escritório.');
  const row = await db.prepare(`SELECT p.id,p.email,c.name AS clientName,o.name AS officeName
    FROM client_portal_access p JOIN crm_client c ON c.office_id=p.office_id AND c.id=p.client_id JOIN office o ON o.id=p.office_id
    WHERE p.token_hash=? AND p.expires_at>CURRENT_TIMESTAMP AND p.revoked_at IS NULL AND p.accepted_at IS NULL`)
    .get<{ id: string; email: string; clientName: string; officeName: string }>(invitationHash(token));
  if (!row) throw new CapabilityError('NOT_FOUND', 'Convite inválido ou expirado. Peça um novo convite ao escritório.');
  return row;
}
export async function acceptPortalInvitation(db: Pick<Database, 'prepare'>, token: string, user: { id: string; email: string }) {
  const result = await db.prepare(`UPDATE client_portal_access SET user_id=?,accepted_at=CURRENT_TIMESTAMP,token_hash=NULL,expires_at=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE token_hash=? AND lower(email)=lower(?) AND expires_at>CURRENT_TIMESTAMP AND revoked_at IS NULL AND accepted_at IS NULL`)
    .run(user.id, invitationHash(token), user.email);
  if (!result.changes) throw new CapabilityError('NOT_FOUND', 'Convite inválido, expirado ou destinado a outro e-mail.');
}
