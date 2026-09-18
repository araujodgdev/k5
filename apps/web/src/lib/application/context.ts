import 'server-only';
import { database } from '@/lib/database';
import type { OfficeRole } from '@/lib/offices';
import { CapabilityError } from '@/lib/capabilities/errors';
import { capabilities, type CapabilityName } from '@/lib/capabilities/contracts';

/** Trusted context, always built on the server from the session. The model never supplies these fields. */
export type WorkspaceContext = { userId: string; officeId: string; role: OfficeRole };

export function workspaceContext(workspace: { user: { id: string }; office: { officeId: string; role: OfficeRole } }): WorkspaceContext {
  return { userId: workspace.user.id, officeId: workspace.office.officeId, role: workspace.office.role };
}

/**
 * Re-reads the membership before a privileged step. A context built at the start of a long
 * conversation must not keep authorizing writes after the role changed or the member was removed.
 */
export function assertCapabilityAllowed(context: WorkspaceContext, name: CapabilityName) {
  const capability = capabilities[name];
  const current = database.prepare('SELECT role FROM office_member WHERE user_id=? AND office_id=?').get(context.userId, context.officeId) as { role: OfficeRole } | undefined;
  if (!current) throw new CapabilityError('FORBIDDEN', 'Seu acesso a este escritório foi removido.');
  if (!(capability.roles as readonly OfficeRole[]).includes(current.role)) {
    throw new CapabilityError('FORBIDDEN', capability.effect === 'write' ? 'Seu papel permite apenas consultar os documentos.' : 'Esta operação não está disponível para o seu papel.');
  }
  return { ...context, role: current.role };
}
