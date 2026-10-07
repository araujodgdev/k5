import { createHash } from 'node:crypto';
import type { Database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import { aclTransaction } from '@/lib/acl-transaction';
import { assertWorkspaceSession } from '@/lib/application/context';

export const invitationHash = (token: string) => createHash('sha256').update(token).digest('hex');
export async function portalInvitation(db: Pick<Database, 'prepare'>, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new CapabilityError('NOT_FOUND', 'Convite inválido ou expirado. Peça um novo convite ao escritório.');
  const row = await db.prepare(`SELECT p.id,p.email,c.name AS clientName,o.name AS officeName
    FROM client_portal_access p JOIN crm_client c ON c.office_id=p.office_id AND c.id=p.client_id JOIN office o ON o.id=p.office_id
    WHERE p.token_hash=? AND p.expires_at>clock_timestamp() AND p.revoked_at IS NULL AND p.accepted_at IS NULL`)
    .get<{ id: string; email: string; clientName: string; officeName: string }>(invitationHash(token));
  if (!row) throw new CapabilityError('NOT_FOUND', 'Convite inválido ou expirado. Peça um novo convite ao escritório.');
  return row;
}
export async function acceptPortalInvitation(db: Pick<Database, 'prepare'>, token: string, user: { id: string; email: string }, session?: { id: string; signal?: AbortSignal }) {
  const invitation = await portalInvitation(db, token);
  await aclTransaction(async tx => {
    const access = await tx.prepare('SELECT office_id,client_id FROM client_portal_access WHERE id=?').get<{ office_id: string; client_id: string }>(invitation.id);
    if (!access) throw new CapabilityError('NOT_FOUND', 'Convite inválido ou expirado.');
    await tx.prepare('SELECT id FROM crm_client WHERE office_id=? AND id=? FOR UPDATE').get(access.office_id, access.client_id);
    const context = { officeId: access.office_id, userId: user.id, sessionId: session?.id, signal: session?.signal };
    await assertWorkspaceSession(context, tx);
    const result = await tx.prepare(`UPDATE client_portal_access SET user_id=?,accepted_at=CURRENT_TIMESTAMP,token_hash=NULL,expires_at=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND token_hash=? AND lower(email)=lower(?) AND expires_at>clock_timestamp() AND revoked_at IS NULL AND accepted_at IS NULL`)
      .run(user.id, invitation.id, invitationHash(token), user.email);
    if (!result.changes) throw new CapabilityError('NOT_FOUND', 'Convite inválido, expirado ou destinado a outro e-mail.');
    await assertWorkspaceSession(context, tx);
  });
}
