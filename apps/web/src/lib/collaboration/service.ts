import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, withTransaction, type Transaction } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { WorkspaceContext } from '@/lib/application/context';
import { caseAccess } from './access';

import { invitationInput, collaborationAction } from './contracts';
export { invitationInput, collaborationAction } from './contracts';
type Invitation = { id: string; office_id: string; kind: string; email: string; recipient_user_id: string | null;
  invited_by: string; token_hash: string; status: string; expires_at: string };
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const denied = (message = 'Você não pode gerenciar este acesso.') => new CapabilityError('FORBIDDEN', message);

async function officeOf(tx: Pick<Transaction, 'prepare'>, userId: string) {
  return (await tx.prepare('SELECT office_id FROM office_member WHERE user_id=?').get<{ office_id: string }>(userId))?.office_id;
}
async function ownerOf(tx: Pick<Transaction, 'prepare'>, officeId: string) {
  return (await tx.prepare('SELECT user_id FROM office_member WHERE office_id=?').get<{ user_id: string }>(officeId))?.user_id;
}
async function audit(tx: Transaction, officeId: string, caseId: string | null, actor: string, target: string | null, action: string) {
  await tx.prepare('INSERT INTO collaboration_audit(id,office_id,case_id,actor_user_id,target_user_id,action) VALUES(?,?,?,?,?,?)')
    .run(randomUUID(), officeId, caseId, actor, target, action);
}
/** Offices are always locked in id order, so two lawyers acting on each other cannot deadlock. */
async function lockOffices(tx: Transaction, ...officeIds: (string | undefined)[]) {
  for (const id of [...new Set(officeIds.filter((value): value is string => Boolean(value)))].sort())
    await tx.prepare('SELECT id FROM office WHERE id=? FOR UPDATE').get(id);
}
async function liveSession(tx: Transaction, context: WorkspaceContext) {
  if (context.sessionId && !await tx.prepare('SELECT 1 FROM session WHERE id=? AND userId=? AND expiresAt>CURRENT_TIMESTAMP').get(context.sessionId, context.userId))
    throw new CapabilityError('UNAUTHENTICATED', 'Sua sessão foi encerrada.');
}
async function associated(tx: Pick<Transaction, 'prepare'>, officeId: string, userId: string) {
  return Boolean(await tx.prepare('SELECT 1 FROM office_associate WHERE office_id=? AND user_id=?').get(officeId, userId));
}

/** Invites another lawyer to become an associate. Only the inviter's own office is ever involved. */
export async function invite(context: WorkspaceContext, raw: z.input<typeof invitationInput>) {
  const input = invitationInput.parse(raw);
  const email = input.email.trim().toLowerCase();
  const officeId = context.officeId;
  return withTransaction(async tx => {
    await lockOffices(tx, officeId);
    await liveSession(tx, context);
    if (await ownerOf(tx, officeId) !== context.userId) throw denied();
    const recipient = await tx.prepare('SELECT id,"accountKind" FROM "user" WHERE lower(email)=?').get<{ id: string; accountKind: string }>(email);
    if (recipient?.id === context.userId) throw new CapabilityError('INVALID', 'Você não pode se convidar.');
    if (recipient?.accountKind === 'client') throw new CapabilityError('INVALID', 'Este e-mail pertence a uma conta de cliente.');
    if (recipient && await associated(tx, officeId, recipient.id)) throw new CapabilityError('CONFLICT', 'Esta pessoa já está na lista de associados.');
    if (recipient && await tx.prepare(`SELECT 1 FROM collaboration_invitation WHERE recipient_user_id=? AND invited_by=? AND status='pending' AND expires_at>CURRENT_TIMESTAMP`)
      .get(context.userId, recipient.id)) throw new CapabilityError('CONFLICT', 'Esta pessoa já convidou você. Responda em Convites.');
    await tx.prepare(`UPDATE collaboration_invitation SET status='revoked',responded_at=CURRENT_TIMESTAMP
      WHERE office_id=? AND kind='associate' AND case_id IS NULL AND email=? AND status='pending' AND expires_at<=CURRENT_TIMESTAMP`).run(officeId, email);
    if (await tx.prepare(`SELECT 1 FROM collaboration_invitation WHERE office_id=? AND kind='associate' AND case_id IS NULL AND email=? AND status='pending'`)
      .get(officeId, email)) throw new CapabilityError('CONFLICT', 'Já existe um convite pendente para este e-mail.');
    const id = randomUUID(); const token = randomBytes(32).toString('base64url');
    await tx.prepare(`INSERT INTO collaboration_invitation(id,office_id,kind,email,recipient_user_id,invited_by,token_hash)
      VALUES(?,?,'associate',?,?,?,?)`).run(id, officeId, email, recipient?.id ?? null, context.userId, digest(token));
    await audit(tx, officeId, null, context.userId, recipient?.id ?? null, 'invitation.created');
    return { id, path: `/invite/${token}`, deliveredInApp: Boolean(recipient) };
  });
}

/** Unknown addresses require possession of the secret link; signing up with an address alone cannot claim an invitation. */
function recipientMatches(invitation: Invitation, user: { id: string; email: string }, token?: string) {
  return invitation.recipient_user_id ? invitation.recipient_user_id === user.id
    : invitation.email === user.email.toLowerCase() && Boolean(token && digest(token) === invitation.token_hash);
}

export async function respond(context: WorkspaceContext, id: string, accept: boolean, token?: string) {
  return withTransaction(async tx => {
    // Same lock order as removal; accepting cannot race the inviter ending the association.
    const initial = await tx.prepare('SELECT office_id FROM collaboration_invitation WHERE id=?').get<{ office_id: string }>(id);
    if (!initial) throw new CapabilityError('NOT_FOUND', 'Convite não encontrado.');
    const ownOffice = await officeOf(tx, context.userId);
    await lockOffices(tx, initial.office_id, ownOffice);
    await liveSession(tx, context);
    const invitation = await tx.prepare('SELECT * FROM collaboration_invitation WHERE id=? FOR UPDATE').get<Invitation>(id);
    const user = await tx.prepare('SELECT id,email,"accountKind" FROM "user" WHERE id=?').get<{ id: string; email: string; accountKind: string }>(context.userId);
    if (!invitation || !user || !recipientMatches(invitation, user, token)) throw new CapabilityError('NOT_FOUND', 'Convite não encontrado para esta conta.');
    if (invitation.kind !== 'associate' || invitation.status !== 'pending' || Date.parse(invitation.expires_at) <= Date.now())
      throw new CapabilityError('CONFLICT', 'Este convite foi respondido, cancelado ou expirou.');
    if (accept) {
      if (user.accountKind === 'client' || !ownOffice) throw new CapabilityError('FORBIDDEN', 'Esta conta tem acesso ao portal do cliente.');
      if (await ownerOf(tx, invitation.office_id) !== invitation.invited_by) throw denied('Quem convidou não tem mais acesso. Peça um novo convite.');
      await tx.prepare('INSERT INTO office_associate(office_id,user_id,created_by) VALUES(?,?,?),(?,?,?) ON CONFLICT DO NOTHING')
        .run(invitation.office_id, user.id, invitation.invited_by, ownOffice, invitation.invited_by, invitation.invited_by);
    }
    await tx.prepare('UPDATE collaboration_invitation SET status=?,responded_at=CURRENT_TIMESTAMP,recipient_user_id=? WHERE id=?')
      .run(accept ? 'accepted' : 'declined', user.id, id);
    await audit(tx, invitation.office_id, null, user.id, user.id, accept ? 'invitation.accepted' : 'invitation.declined');
    return { success: true };
  });
}

export async function changeAccess(context: WorkspaceContext, input: Exclude<z.infer<typeof collaborationAction>, { action: 'invite' | 'respond' }>) {
  if (input.action === 'cancel') return withTransaction(async tx => {
    await lockOffices(tx, context.officeId);
    await liveSession(tx, context);
    const changed = await tx.prepare(`UPDATE collaboration_invitation SET status='revoked',responded_at=CURRENT_TIMESTAMP
      WHERE id=? AND office_id=? AND invited_by=? AND status='pending' RETURNING recipient_user_id`).get<{ recipient_user_id: string | null }>(input.id, context.officeId, context.userId);
    if (!changed) throw new CapabilityError('CONFLICT', 'O convite já foi respondido ou cancelado.');
    await audit(tx, context.officeId, null, context.userId, changed.recipient_user_id, 'invitation.revoked');
    return { success: true };
  });

  if (input.action === 'associate') return withTransaction(async tx => {
    const theirOffice = await officeOf(tx, input.userId);
    await lockOffices(tx, context.officeId, theirOffice);
    await liveSession(tx, context);
    if (!await associated(tx, context.officeId, input.userId)) throw new CapabilityError('NOT_FOUND', 'Associado não encontrado.');
    // Ending the association ends what it allowed: neither keeps taking part in the other's cases.
    await tx.prepare('DELETE FROM office_associate WHERE (office_id=? AND user_id=?) OR (office_id=? AND user_id=?)')
      .run(context.officeId, input.userId, theirOffice ?? '', context.userId);
    await tx.prepare(`UPDATE case_participant SET revoked_at=CURRENT_TIMESTAMP WHERE revoked_at IS NULL
      AND ((office_id=? AND user_id=?) OR (office_id=? AND user_id=?))`).run(context.officeId, input.userId, theirOffice ?? '', context.userId);
    await audit(tx, context.officeId, null, context.userId, input.userId, 'associate.removed');
    return { success: true };
  });

  const access = await caseAccess(context.userId, input.caseId);
  return withTransaction(async tx => {
    await lockOffices(tx, access.officeId);
    await liveSession(tx, context);
    // Re-read under the lock: the case or the person's access may have changed since.
    const current = await caseAccess(context.userId, input.caseId, tx);
    if (input.add) {
      if (!current.owner) throw denied('Somente o responsável pelo caso escolhe os participantes.');
      if (input.userId === context.userId) throw new CapabilityError('INVALID', 'Você já é o responsável por este caso.');
      if (!await associated(tx, current.officeId, input.userId)) throw new CapabilityError('FORBIDDEN', 'Convide a pessoa como associada antes de incluí-la no caso.');
      const added = await tx.prepare(`INSERT INTO case_participant(office_id,case_id,user_id,invited_by) VALUES(?,?,?,?)
        ON CONFLICT(case_id,user_id) DO UPDATE SET invited_by=excluded.invited_by,revoked_at=NULL,created_at=CURRENT_TIMESTAMP
        WHERE case_participant.revoked_at IS NOT NULL`).run(current.officeId, input.caseId, input.userId, context.userId);
      if (!added.changes) throw new CapabilityError('CONFLICT', 'Esta pessoa já participa do caso.');
    } else {
      if (!current.owner && input.userId !== context.userId) throw denied('Somente o responsável pelo caso remove participantes.');
      const removed = await tx.prepare('UPDATE case_participant SET revoked_at=CURRENT_TIMESTAMP WHERE case_id=? AND user_id=? AND revoked_at IS NULL')
        .run(input.caseId, input.userId);
      if (!removed.changes) throw new CapabilityError('NOT_FOUND', 'Participante não encontrado.');
    }
    await audit(tx, current.officeId, input.caseId, context.userId, input.userId, input.add ? 'participant.added' : 'participant.removed');
    return { success: true };
  });
}

const inviteSelect = `SELECT i.id,i.email,i.status,i.expires_at AS "expiresAt",u.name AS "inviterName"
  FROM collaboration_invitation i JOIN "user" u ON u.id=i.invited_by`;

export async function invitationForToken(userId: string, token: string) {
  const invitation = await database.prepare('SELECT * FROM collaboration_invitation WHERE token_hash=?').get<Invitation>(digest(token));
  const user = await database.prepare('SELECT id,email FROM "user" WHERE id=?').get<{ id: string; email: string }>(userId);
  if (!invitation || !user || invitation.kind !== 'associate' || !recipientMatches(invitation, user, token))
    throw new CapabilityError('NOT_FOUND', 'Entre com a conta do e-mail que recebeu o convite.');
  return database.prepare(`${inviteSelect} WHERE i.id=?`).get(invitation.id);
}

// The photo version lets the lists show each person's avatar; the agent's DTO drops it.
const personSelect = `u.id,u.name,u.email,up.avatar_version AS "avatarVersion"`;
const photo = 'LEFT JOIN user_profile up ON up.user_id=u.id';

export async function collaborationOverview(context: WorkspaceContext, caseId?: string) {
  const access = caseId ? await caseAccess(context.userId, caseId) : null;
  const associates = await database.prepare(`SELECT ${personSelect} FROM office_associate a JOIN "user" u ON u.id=a.user_id ${photo}
    WHERE a.office_id=? ORDER BY u.name,u.id`).all(context.officeId);
  const outgoing = await database.prepare(`${inviteSelect} WHERE i.office_id=? AND i.kind='associate' AND i.status='pending'
    AND i.expires_at>CURRENT_TIMESTAMP ORDER BY i.created_at DESC`).all(context.officeId);
  const incoming = await database.prepare(`${inviteSelect} WHERE i.recipient_user_id=? AND i.kind='associate' AND i.status='pending'
    AND i.expires_at>CURRENT_TIMESTAMP ORDER BY i.created_at DESC`).all(context.userId);
  const owner = access ? await database.prepare(`SELECT ${personSelect} FROM office_member m JOIN "user" u ON u.id=m.user_id ${photo} WHERE m.office_id=?`)
    .get(access.officeId) ?? null : null;
  const participants = access ? await database.prepare(`SELECT ${personSelect} FROM case_participant p JOIN "user" u ON u.id=p.user_id ${photo}
    WHERE p.case_id=? AND p.revoked_at IS NULL ORDER BY u.name,u.id`).all(caseId) : [];
  // The case history belongs to its owner; the associations history to each lawyer.
  const history = !access || access.owner ? await database.prepare(`SELECT a.id,a.action,a.created_at AS "createdAt",u.name AS "actorName",t.name AS "targetName"
    FROM collaboration_audit a JOIN "user" u ON u.id=a.actor_user_id LEFT JOIN "user" t ON t.id=a.target_user_id
    WHERE a.office_id=? AND ${caseId ? 'a.case_id=?' : 'a.case_id IS NULL'} ORDER BY a.created_at DESC LIMIT 40`)
    .all(access?.officeId ?? context.officeId, ...(caseId ? [caseId] : [])) : [];
  return { associates, outgoing, incoming, owner, participants, history, isOwner: access ? access.owner : true, viewerId: context.userId };
}
