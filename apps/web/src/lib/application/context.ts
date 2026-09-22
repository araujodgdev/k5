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
  /** The model the person selected for this turn. Absent means Lume's default for the provider. */
  model?: { provider: string; modelId: string };
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

let sessionTableColumn: string | null | undefined;

/**
 * Better Auth owns the session table and its column naming differs across versions, so the column
 * is discovered once instead of guessed per call. An unknown shape disables the check rather than
 * failing every tool call: the membership check below still runs.
 */
async function sessionIdColumn(): Promise<string | null> {
  if (sessionTableColumn !== undefined) return sessionTableColumn;
  try {
    const columns = await database.prepare("SELECT name FROM pragma_table_info('session')").all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => String(column.name)));
    sessionTableColumn = names.has('id') ? 'id' : null;
  } catch {
    sessionTableColumn = null;
  }
  return sessionTableColumn;
}

/**
 * Re-reads the membership and the session before a privileged step. A context built at the start
 * of a long conversation must not keep authorizing writes after the role changed, the member was
 * removed, or the person signed out everywhere mid-turn.
 */
export async function assertCapabilityAllowed(context: WorkspaceContext, name: CapabilityName) {
  const capability = capabilities[name];
  if (context.invocation && ['k5_agenda_create_activity', 'k5_agenda_update_activity', 'k5_agenda_apply_proposal'].includes(name)) {
    throw new CapabilityError('APPROVAL_REQUIRED', 'Prepare uma sugestão para a pessoa revisar e salvar na Agenda.');
  }

  if (context.sessionId) {
    const column = await sessionIdColumn();
    if (column) {
      const live = await database.prepare(`SELECT 1 FROM session WHERE ${column} = ?`).get(context.sessionId);
      if (!live) throw new CapabilityError('UNAUTHENTICATED', 'Sua sessão foi encerrada. Entre novamente para continuar.');
    }
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

export function resetSessionColumnCacheForTests() {
  sessionTableColumn = undefined;
}
