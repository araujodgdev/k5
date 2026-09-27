import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, withTransaction, type Transaction } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { WorkspaceContext } from '@/lib/application/context';
import { caseAccess } from './access';

const officeRole = z.enum(['administrator', 'lawyer', 'reviewer']);
const permission = z.enum(['viewer', 'editor']);
export const invitationInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('team'), email: z.email().max(254), role: officeRole }),
  z.object({ kind: z.literal('associate'), email: z.email().max(254) }),
  z.object({ kind: z.literal('case'), email: z.email().max(254), caseId: z.string().min(1), role: permission, canInvite: z.boolean().default(false) }),
]);
export const collaborationAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('invite'), invitation: invitationInput }),
  z.object({ action: z.literal('respond'), id: z.string().min(1), accept: z.boolean(), token: z.string().max(128).optional() }),
  z.object({ action: z.literal('cancel'), id: z.string().min(1) }),
  z.object({ action: z.literal('member'), userId: z.string().min(1), role: officeRole.nullable() }),
  z.object({ action: z.literal('associate'), userId: z.string().min(1) }),
  z.object({ action: z.literal('participant'), caseId: z.string().min(1), userId: z.string().min(1), role: permission.nullable(), canInvite: z.boolean().default(false) }),
]);
type Invitation = { id: string; office_id: string; kind: 'team' | 'associate' | 'case'; case_id: string | null;
  email: string; recipient_user_id: string | null; invited_by: string; role: string; can_invite: boolean;
  token_hash: string; status: string; expires_at: string };
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const denied = (message = 'Você não pode gerenciar este acesso.') => new CapabilityError('FORBIDDEN', message);

async function memberRole(tx: Transaction, userId: string, officeId: string) {
  return (await tx.prepare('SELECT role FROM office_member WHERE office_id=? AND user_id=?').get<{ role: string }>(officeId, userId))?.role;
}
async function authority(tx: Transaction, userId: string, officeId: string, kind: string, caseId: string | null) {
  if (kind === 'case' && caseId) {
    const access = await caseAccess(userId, caseId, tx);
    if (access.officeId !== officeId || !access.canManage) throw denied();
    return access;
  }
  const role = await memberRole(tx, userId, officeId);
  if (!role || role === 'reviewer' || (kind === 'team' && role !== 'administrator')) throw denied();
  return { role, external: false };
}
async function audit(tx: Transaction, officeId: string, caseId: string | null, actor: string, target: string | null, action: string) {
  await tx.prepare('INSERT INTO collaboration_audit(id,office_id,case_id,actor_user_id,target_user_id,action) VALUES(?,?,?,?,?,?)')
    .run(randomUUID(), officeId, caseId, actor, target, action);
}
async function lockOffice(tx: Transaction, officeId: string) {
  await tx.prepare('SELECT id FROM office WHERE id=? FOR UPDATE').get(officeId);
}
async function liveSession(tx: Transaction, context: WorkspaceContext) {
  if (context.sessionId && !await tx.prepare('SELECT 1 FROM session WHERE id=? AND userId=? AND expiresAt>CURRENT_TIMESTAMP').get(context.sessionId, context.userId))
    throw new CapabilityError('UNAUTHENTICATED', 'Sua sessão foi encerrada.');
}

export async function invite(context: WorkspaceContext, raw: z.input<typeof invitationInput>) {
  const input = invitationInput.parse(raw);
  const email = input.email.trim().toLowerCase();
  const caseId = input.kind === 'case' ? input.caseId : null;
  const officeId = caseId ? (await caseAccess(context.userId, caseId)).officeId : context.officeId;
  return withTransaction(async tx => {
    await lockOffice(tx, officeId);
    await liveSession(tx, context);
    const access = await authority(tx, context.userId, officeId, input.kind, caseId);
    if (input.kind === 'case' && access.external && (input.canInvite || (access.role === 'reviewer' && input.role === 'editor')))
      throw denied('Você só pode convidar com permissões iguais ou menores que as suas, sem delegar convites.');
    const recipient = await tx.prepare('SELECT id FROM "user" WHERE lower(email)=?').get<{ id: string }>(email);
    if (recipient?.id === context.userId) throw new CapabilityError('INVALID', 'Você já tem acesso.');
    if (recipient && (input.kind === 'team' || input.kind === 'case') && await memberRole(tx, recipient.id, officeId))
      throw new CapabilityError('CONFLICT', 'Esta pessoa já faz parte da equipe do escritório.');
    if (recipient && input.kind === 'case' && await tx.prepare('SELECT 1 FROM case_participant WHERE case_id=? AND user_id=? AND revoked_at IS NULL').get(caseId, recipient.id))
      throw new CapabilityError('CONFLICT', 'Esta pessoa já participa do caso.');
    if (recipient && input.kind === 'associate' && await tx.prepare('SELECT 1 FROM office_associate WHERE office_id=? AND user_id=?').get(officeId, recipient.id))
      throw new CapabilityError('CONFLICT', 'Esta pessoa já está na lista de associados.');
    await tx.prepare(`UPDATE collaboration_invitation SET status='revoked',responded_at=CURRENT_TIMESTAMP
      WHERE office_id=? AND kind=? AND COALESCE(case_id,'')=? AND email=? AND status='pending' AND expires_at<=CURRENT_TIMESTAMP`)
      .run(officeId, input.kind, caseId ?? '', email);
    if (await tx.prepare(`SELECT 1 FROM collaboration_invitation WHERE office_id=? AND kind=? AND COALESCE(case_id,'')=? AND email=? AND status='pending'`)
      .get(officeId, input.kind, caseId ?? '', email)) throw new CapabilityError('CONFLICT', 'Já existe um convite pendente para este e-mail.');
    const id = randomUUID(); const token = randomBytes(32).toString('base64url');
    await tx.prepare(`INSERT INTO collaboration_invitation(id,office_id,kind,case_id,email,recipient_user_id,invited_by,role,can_invite,token_hash)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, officeId, input.kind, caseId, email, recipient?.id ?? null, context.userId,
        input.kind === 'associate' ? 'viewer' : input.role, input.kind === 'case' && input.canInvite, digest(token));
    await audit(tx, officeId, caseId, context.userId, recipient?.id ?? null, 'invitation.created');
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
    // Same lock order as revocation; accepting cannot race a membership or inviter removal.
    const initial = await tx.prepare('SELECT office_id FROM collaboration_invitation WHERE id=?').get<{ office_id: string }>(id);
    if (!initial) throw new CapabilityError('NOT_FOUND', 'Convite não encontrado.');
    await lockOffice(tx, initial.office_id);
    await liveSession(tx, context);
    const invitation = await tx.prepare('SELECT * FROM collaboration_invitation WHERE id=? FOR UPDATE').get<Invitation>(id);
    const user = await tx.prepare('SELECT id,email FROM "user" WHERE id=?').get<{ id: string; email: string }>(context.userId);
    if (!invitation || !user || !recipientMatches(invitation, user, token)) throw new CapabilityError('NOT_FOUND', 'Convite não encontrado para esta conta.');
    if (invitation.status !== 'pending' || Date.parse(invitation.expires_at) <= Date.now()) throw new CapabilityError('CONFLICT', 'Este convite foi respondido, cancelado ou expirou.');
    if (accept) {
      const access = await authority(tx, invitation.invited_by, invitation.office_id, invitation.kind, invitation.case_id);
      if (access.external && (invitation.can_invite || (access.role === 'reviewer' && invitation.role === 'editor'))) throw denied('As permissões de quem convidou foram alteradas. Peça um novo convite.');
      if (invitation.kind === 'team') {
        await tx.prepare('SELECT id FROM "user" WHERE id=? FOR UPDATE').get(user.id);
        await tx.prepare(`INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?) ON CONFLICT(office_id,user_id) DO NOTHING`)
          .run(randomUUID(), invitation.office_id, user.id, invitation.role);
      } else if (invitation.kind === 'associate') {
        await tx.prepare('INSERT INTO office_associate(office_id,user_id,created_by) VALUES(?,?,?) ON CONFLICT DO NOTHING')
          .run(invitation.office_id, user.id, invitation.invited_by);
      } else {
        await tx.prepare(`INSERT INTO case_participant(office_id,case_id,user_id,permission,can_invite,invited_by) VALUES(?,?,?,?,?,?)
          ON CONFLICT(case_id,user_id) DO UPDATE SET permission=excluded.permission,can_invite=excluded.can_invite,invited_by=excluded.invited_by,revoked_at=NULL,created_at=CURRENT_TIMESTAMP
          WHERE case_participant.revoked_at IS NOT NULL`)
          .run(invitation.office_id, invitation.case_id, user.id, invitation.role, invitation.can_invite, invitation.invited_by);
      }
    }
    await tx.prepare('UPDATE collaboration_invitation SET status=?,responded_at=CURRENT_TIMESTAMP,recipient_user_id=? WHERE id=?')
      .run(accept ? 'accepted' : 'declined', user.id, id);
    await audit(tx, invitation.office_id, invitation.case_id, user.id, user.id, accept ? 'invitation.accepted' : 'invitation.declined');
    return { success: true, caseId: accept ? invitation.case_id : null };
  });
}

export async function changeAccess(context: WorkspaceContext, input: Exclude<z.infer<typeof collaborationAction>, { action: 'invite' | 'respond' }>) {
  const caseId = input.action === 'participant' ? input.caseId : null;
  const invitation = input.action === 'cancel' ? await database.prepare('SELECT * FROM collaboration_invitation WHERE id=?').get<Invitation>(input.id) : undefined;
  const officeId = invitation?.office_id ?? (caseId ? (await caseAccess(context.userId, caseId)).officeId : context.officeId);
  return withTransaction(async tx => {
    await lockOffice(tx, officeId);
    await liveSession(tx, context);
    const kind = input.action === 'cancel' ? invitation?.kind : input.action === 'participant' ? 'case' : input.action === 'member' ? 'team' : 'associate';
    if (!kind) throw new CapabilityError('NOT_FOUND', 'Convite não encontrado.');
    const access = await authority(tx, context.userId, officeId, kind, invitation?.case_id ?? caseId);
    if (access.external && (input.action !== 'cancel' || invitation?.invited_by !== context.userId)) throw denied();
    if (input.action === 'cancel') {
      const changed = await tx.prepare("UPDATE collaboration_invitation SET status='revoked',responded_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").run(input.id);
      if (!changed.changes) throw new CapabilityError('CONFLICT', 'O convite já foi respondido ou cancelado.');
    } else if (input.action === 'member') {
      const currentRole = await memberRole(tx, input.userId, officeId);
      if (!currentRole) throw new CapabilityError('NOT_FOUND', 'Membro não encontrado.');
      if (currentRole === 'administrator' && input.role !== 'administrator') {
        const other = await tx.prepare("SELECT 1 FROM office_member WHERE office_id=? AND role='administrator' AND user_id<>?").get(officeId, input.userId);
        if (!other) throw new CapabilityError('CONFLICT', 'O escritório precisa manter pelo menos um administrador.');
      }
      if (input.role) await tx.prepare('UPDATE office_member SET role=? WHERE office_id=? AND user_id=?').run(input.role, officeId, input.userId);
      else {
        // Do not leave an older guest grant or pending invitation behind after removing a member.
        await tx.prepare('UPDATE case_participant SET revoked_at=CURRENT_TIMESTAMP WHERE office_id=? AND user_id=?').run(officeId, input.userId);
        await tx.prepare("UPDATE collaboration_invitation SET status='revoked',responded_at=CURRENT_TIMESTAMP WHERE office_id=? AND status='pending' AND (recipient_user_id=? OR invited_by=?)")
          .run(officeId, input.userId, input.userId);
        await tx.prepare('DELETE FROM office_member WHERE office_id=? AND user_id=?').run(officeId, input.userId);
      }
    } else if (input.action === 'associate') {
      await tx.prepare('DELETE FROM office_associate WHERE office_id=? AND user_id=?').run(officeId, input.userId);
    } else {
      const changed = input.role
        ? await tx.prepare('UPDATE case_participant SET permission=?,can_invite=? WHERE case_id=? AND user_id=? AND revoked_at IS NULL').run(input.role, input.canInvite, caseId, input.userId)
        : await tx.prepare('UPDATE case_participant SET revoked_at=CURRENT_TIMESTAMP WHERE case_id=? AND user_id=? AND revoked_at IS NULL').run(caseId, input.userId);
      if (!changed.changes) throw new CapabilityError('NOT_FOUND', 'Participante não encontrado.');
      if (!input.role) await tx.prepare("UPDATE collaboration_invitation SET status='revoked',responded_at=CURRENT_TIMESTAMP WHERE case_id=? AND status='pending' AND (recipient_user_id=? OR invited_by=?)")
        .run(caseId, input.userId, input.userId);
    }
    await audit(tx, officeId, invitation?.case_id ?? caseId, context.userId, 'userId' in input ? input.userId : invitation?.recipient_user_id ?? null,
      input.action === 'cancel' ? 'invitation.revoked' : `${input.action}.${'role' in input && input.role ? 'updated' : 'removed'}`);
    return { success: true };
  });
}

const inviteSelect = `SELECT i.id,i.kind,i.email,i.role,i.can_invite AS "canInvite",i.status,i.expires_at AS "expiresAt",
  o.name AS "officeName",c.name AS "caseName",u.name AS "inviterName"
  FROM collaboration_invitation i JOIN office o ON o.id=i.office_id
  JOIN "user" u ON u.id=i.invited_by LEFT JOIN vault_case c ON c.id=i.case_id`;

export async function invitationForToken(userId: string, token: string) {
  const invitation = await database.prepare('SELECT * FROM collaboration_invitation WHERE token_hash=?').get<Invitation>(digest(token));
  const user = await database.prepare('SELECT id,email FROM "user" WHERE id=?').get<{ id: string; email: string }>(userId);
  if (!invitation || !user || !recipientMatches(invitation, user, token)) throw new CapabilityError('NOT_FOUND', 'Entre com a conta do e-mail que recebeu o convite.');
  return database.prepare(`${inviteSelect} WHERE i.id=?`).get(invitation.id);
}

export async function collaborationOverview(context: WorkspaceContext, caseId?: string) {
  const access = caseId ? await caseAccess(context.userId, caseId) : null;
  const officeId = access?.officeId ?? context.officeId;
  const role = await memberRole(database, context.userId, officeId);
  const canManage = access ? access.canManage : role === 'administrator';
  const canAssociate = Boolean(role && role !== 'reviewer');
  const members = !access || !access.external ? await database.prepare(`SELECT u.id,u.name,u.email,m.role FROM office_member m
    JOIN "user" u ON u.id=m.user_id WHERE m.office_id=? ORDER BY u.name,u.id`).all(officeId) : [];
  const participants = caseId ? await database.prepare(`SELECT u.id,u.name,u.email,p.permission AS role,p.can_invite AS "canInvite"
    FROM case_participant p JOIN "user" u ON u.id=p.user_id WHERE p.case_id=? AND p.revoked_at IS NULL ORDER BY u.name,u.id`).all(caseId) : [];
  const associates = !access?.external ? await database.prepare(`SELECT u.id,u.name,u.email FROM office_associate a JOIN "user" u ON u.id=a.user_id WHERE a.office_id=? ORDER BY u.name,u.id`).all(officeId) : [];
  const outgoing = canManage || (!caseId && canAssociate) ? await database.prepare(`${inviteSelect}
    WHERE i.office_id=? AND ${caseId ? 'i.case_id=?' : "i.case_id IS NULL AND (i.kind='associate' OR ?)"}
    AND i.status='pending' AND i.expires_at>CURRENT_TIMESTAMP AND (? OR i.invited_by=?)
    ORDER BY i.created_at DESC`).all(officeId, caseId ?? canManage, !access?.external, context.userId) : [];
  const incoming = await database.prepare(`${inviteSelect} WHERE i.recipient_user_id=? AND i.status='pending' AND i.expires_at>CURRENT_TIMESTAMP
    AND (i.case_id IS NULL OR c.deleted_at IS NULL) ORDER BY i.created_at DESC`).all(context.userId);
  const history = (caseId ? canManage && !access?.external : canManage) ? await database.prepare(`SELECT a.id,a.action,a.created_at AS "createdAt",u.name AS "actorName",t.name AS "targetName"
    FROM collaboration_audit a JOIN "user" u ON u.id=a.actor_user_id LEFT JOIN "user" t ON t.id=a.target_user_id
    WHERE a.office_id=? AND ${caseId ? 'a.case_id=?' : 'a.case_id IS NULL'} ORDER BY a.created_at DESC LIMIT 40`).all(officeId, ...(caseId ? [caseId] : [])) : [];
  return { members, participants, associates, outgoing, incoming, history, canManage, canAssociate,
    canManageParticipants: Boolean(access && canManage && !access.external), external: access?.external ?? false,
    caseRole: access?.role };
}
