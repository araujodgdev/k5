import 'server-only';
import { database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityName } from '@/lib/capabilities/contracts';
import { caseAccess } from '@/lib/collaboration/access';
import { sharedCaseCapabilities } from '@/lib/collaboration/capability-access';

/** Trusted context, always built on the server from the session. The model never supplies these fields. */
export type WorkspaceContext = {
  userId: string;
  officeId: string;
  /** Server-resolved guest scope; never accepted from a browser or model. */
  caseScope?: { caseId: string; homeOfficeId: string };
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
  /** Pages the web search of this chat turn returned, filled by the chat as each step finishes. */
  consultedLinks?: ReadonlySet<string>;
  /**
   * Set by the chat's guard once this turn has read third-party text (e-mail, documents, web).
   * From then on an action the office allowed to run without confirmation asks for it.
   */
  untrustedContent?: { seen: boolean };
};

export function workspaceContext(workspace: {
  user: { id: string };
  office: { officeId: string };
  session?: { id?: string };
}): WorkspaceContext {
  return {
    userId: workspace.user.id,
    officeId: workspace.office.officeId,
    sessionId: workspace.session?.id,
  };
}

/**
 * Re-reads the membership and the session before a privileged step. A context built at the start
 * of a long conversation must not keep authorizing writes after the person lost access to the
 * office or the case, or signed out everywhere mid-turn.
 */
export async function assertCapabilityAllowed(context: WorkspaceContext, name: CapabilityName) {
  if (context.sessionId) {
    const live = await database.prepare('SELECT 1 FROM session WHERE id=? AND userId=? AND expiresAt>CURRENT_TIMESTAMP')
      .get(context.sessionId,context.userId);
    if (!live) throw new CapabilityError('UNAUTHENTICATED', 'Sua sessão foi encerrada. Entre novamente para continuar.');
  }

  if (context.caseScope) {
    if (!sharedCaseCapabilities.has(name)) throw new CapabilityError('FORBIDDEN', 'Esta operação exige acesso ao escritório.');
    const access = await caseAccess(context.userId, context.caseScope.caseId);
    if (access.officeId !== context.officeId) throw new CapabilityError('FORBIDDEN', 'Sua participação não permite esta operação.');
    return context;
  }
  const current = await database.prepare('SELECT 1 FROM office_member WHERE user_id=? AND office_id=?').get(context.userId, context.officeId);
  if (!current) throw new CapabilityError('FORBIDDEN', 'Seu acesso a este escritório foi removido.');
  return context;
}
