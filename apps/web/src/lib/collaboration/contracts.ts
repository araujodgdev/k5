import { z } from 'zod';

/**
 * Lawyers work together through associations. An accepted invitation makes two lawyers associates
 * of each other; the owner of a case then picks, among their associates, who takes part in it.
 */
export const invitationInput = z.object({ email: z.email().max(254) });
export const collaborationAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('invite'), invitation: invitationInput }),
  z.object({ action: z.literal('respond'), id: z.string().min(1), accept: z.boolean(), token: z.string().max(128).optional() }),
  z.object({ action: z.literal('cancel'), id: z.string().min(1) }),
  /** Ends the association both ways and the case participation it allowed. */
  z.object({ action: z.literal('associate'), userId: z.string().min(1) }),
  /** `add` false removes; the owner removes anyone, a participant only themselves (leaving the case). */
  z.object({ action: z.literal('participant'), caseId: z.string().min(1), userId: z.string().min(1), add: z.boolean() }),
]);
const person = z.object({ id: z.string(), name: z.string(), email: z.string() });
const invitation = z.object({ id: z.string(), email: z.string(), status: z.string(), expiresAt: z.string(), inviterName: z.string() });
export const collaborationOverviewDto = z.object({
  associates: z.array(person), outgoing: z.array(invitation), incoming: z.array(invitation),
  /** Case view only: who owns the case and who takes part in it. */
  owner: person.nullable(), participants: z.array(person),
  history: z.array(z.object({ id: z.string(), action: z.string(), createdAt: z.string(), actorName: z.string(), targetName: z.string().nullable() })),
  isOwner: z.boolean(),
  viewerId: z.string(),
});
