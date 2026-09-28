import { z } from 'zod';

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
const person = z.object({ id: z.string(), name: z.string(), email: z.string() });
const invitation = z.object({ id: z.string(), kind: z.string(), email: z.string(), role: z.string(), canInvite: z.boolean(), status: z.string(), expiresAt: z.string(), officeName: z.string(), caseName: z.string().nullable(), inviterName: z.string() });
export const collaborationOverviewDto = z.object({
  members: z.array(person.extend({ role: officeRole })),
  participants: z.array(person.extend({ role: permission, canInvite: z.boolean() })),
  associates: z.array(person), outgoing: z.array(invitation), incoming: z.array(invitation),
  history: z.array(z.object({ id: z.string(), action: z.string(), createdAt: z.string(), actorName: z.string(), targetName: z.string().nullable() })),
  canManage: z.boolean(), canAssociate: z.boolean(), canManageParticipants: z.boolean(), external: z.boolean(), caseRole: officeRole.optional(),
});
