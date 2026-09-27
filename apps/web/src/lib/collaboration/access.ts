import 'server-only';
import { database, type Transaction } from '@/lib/database';
import type { WorkspaceContext } from '@/lib/application/context';
import type { OfficeRole } from '@/lib/offices';
import { CapabilityError } from '@/lib/capabilities/errors';

type Reader = Pick<Transaction, 'prepare'>;
export type CaseAccess = { officeId: string; caseId: string; role: OfficeRole; external: boolean; canManage: boolean };

/** The owner office comes from the case, never a client supplied tenant id. */
export async function caseAccess(userId: string, caseId: string, db: Reader = database): Promise<CaseAccess> {
  const row = await db.prepare(`SELECT c.office_id, m.role, p.permission, p.can_invite
    FROM vault_case c
    LEFT JOIN office_member m ON m.office_id=c.office_id AND m.user_id=?
    LEFT JOIN case_participant p ON p.case_id=c.id AND p.office_id=c.office_id AND p.user_id=? AND p.revoked_at IS NULL
    WHERE c.id=? AND c.deleted_at IS NULL`).get<{
      office_id: string; role: OfficeRole | null; permission: 'viewer' | 'editor' | null; can_invite: boolean | null;
    }>(userId, userId, caseId);
  if (!row || (!row.role && !row.permission)) throw new CapabilityError('NOT_FOUND', 'Caso não encontrado ou acesso removido.');
  return { officeId: row.office_id, caseId, role: row.role ?? (row.permission === 'editor' ? 'lawyer' : 'reviewer'),
    external: !row.role, canManage: row.role ? row.role !== 'reviewer' : Boolean(row.can_invite) };
}

export async function documentAccess(context: WorkspaceContext, documentId: string) {
  const row = await database.prepare('SELECT office_id,case_id FROM vault_document WHERE id=? AND deleted_at IS NULL')
    .get<{ office_id: string; case_id: string | null }>(documentId);
  if (!row) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');
  if (row.office_id === context.officeId && !context.caseScope) return { ...context };
  if (!row.case_id) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');
  return contextForCase(context, row.case_id);
}

export async function contextForCase(context: WorkspaceContext, caseId: string): Promise<WorkspaceContext> {
  if (context.caseScope && context.caseScope.caseId !== caseId) throw new CapabilityError('FORBIDDEN', 'Acesso restrito ao caso compartilhado.');
  const access = await caseAccess(context.userId, caseId);
  if (access.officeId === context.officeId && !context.caseScope && !access.external) return { ...context, role: access.role };
  return { ...context, officeId: access.officeId, role: access.role,
    caseScope: { caseId, homeOfficeId: context.caseScope?.homeOfficeId ?? context.officeId } };
}
