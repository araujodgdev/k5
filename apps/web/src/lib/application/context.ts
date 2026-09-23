import 'server-only';
import { database } from '@/lib/database';
import type { OfficeRole } from '@/lib/offices';
import { CapabilityError } from '@/lib/capabilities/errors';
import { capabilities, type CapabilityName } from '@/lib/capabilities/contracts';

/** Trusted context, always built on the server from the session. The model never supplies these fields. */
export type WorkspaceContext = {
  userId: string;
  officeId: string;
  role: OfficeRole;
  sessionId?: string;
  /** Set by server adapters, never read from capability inputs. */
  invocation?: 'agent' | 'webmcp';
  signal?: AbortSignal;
  agendaConfirmation?: { proposalId: string; hash: string };
  /** Selected by the person for this chat turn; model tools cannot enlarge this public-source scope. */
  allowedResearchCaseId?: string;
  allowedResearchReferenceIds?: string[];
  /** The chat conversation of this turn, set by the chat route; decides which documents are the agent's own. */
  conversationId?: string;
};

export function workspaceContext(workspace: {
  user: { id: string };
  office: { officeId: string; role: OfficeRole };
  session?: { id?: string };
}): WorkspaceContext {
  return {
    userId: workspace.user.id,
    officeId: workspace.office.officeId,
    role: workspace.office.role,
    sessionId: workspace.session?.id,
  };
}

/**
 * Re-reads the membership and the session before a privileged step. A context built at the start
 * of a long conversation must not keep authorizing writes after the role changed, the member was
 * removed, or the person signed out everywhere mid-turn.
 */
export async function assertCapabilityAllowed(context: WorkspaceContext, name: CapabilityName) {
  const capability = capabilities[name];
  if (context.sessionId) {
    const live = await database.prepare('SELECT 1 FROM session WHERE id=? AND userId=? AND expiresAt>CURRENT_TIMESTAMP')
      .get(context.sessionId,context.userId);
    if (!live) throw new CapabilityError('UNAUTHENTICATED', 'Sua sessão foi encerrada. Entre novamente para continuar.');
  }

  const current = await database.prepare('SELECT role FROM office_member WHERE user_id=? AND office_id=?')
    .get(context.userId, context.officeId) as { role: OfficeRole } | undefined;
  if (!current) throw new CapabilityError('FORBIDDEN', 'Seu acesso a este escritório foi removido.');
  if (!(capability.roles as readonly OfficeRole[]).includes(current.role)) {
    throw new CapabilityError('FORBIDDEN', capability.effect === 'write'
      ? 'Seu papel permite apenas consultas.'
      : 'Esta operação não está disponível para o seu papel.');
  }
  return { ...context, role: current.role };
}
