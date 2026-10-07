import 'server-only';
import { database, type Transaction } from '@/lib/database';
import type { WorkspaceContext } from '@/lib/application/context';
import { CapabilityError } from '@/lib/capabilities/errors';

type Reader = Pick<Transaction, 'prepare'>;
/** `owner` is the lawyer whose office holds the case; everyone else reaching it is a participant. */
export type CaseAccess = { officeId: string; caseId: string; owner: boolean };

/** The owner office comes from the case, never a client supplied tenant id. */
export async function caseAccess(userId: string, caseId: string, db: Reader = database): Promise<CaseAccess> {
  const row = await db.prepare(`SELECT c.office_id,
      EXISTS(SELECT 1 FROM office_member m WHERE m.office_id=c.office_id AND m.user_id=?) AS owner,
      EXISTS(SELECT 1 FROM case_participant p WHERE p.case_id=c.id AND p.office_id=c.office_id AND p.user_id=? AND p.revoked_at IS NULL) AS participant
    FROM vault_case c WHERE c.id=? AND c.deleted_at IS NULL`).get<{ office_id: string; owner: boolean; participant: boolean }>(userId, userId, caseId);
  if (!row || (!row.owner && !row.participant)) throw new CapabilityError('NOT_FOUND', 'Caso não encontrado ou acesso removido.');
  return { officeId: row.office_id, caseId, owner: Boolean(row.owner) };
}

/** A document in a folder the person cannot see is answered exactly like one that does not exist. */
export async function documentAccess(context: WorkspaceContext, documentId: string) {
  const row = await database.prepare('SELECT office_id,case_id FROM vault_document WHERE id=? AND deleted_at IS NULL AND lume_vault_visible(id, ?)')
    .get<{ office_id: string; case_id: string | null }>(documentId, context.userId);
  if (!row) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');
  if (row.office_id === context.officeId && !context.caseScope) return { ...context };
  if (!row.case_id) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');
  return contextForCase(context, row.case_id);
}

export async function contextForCase(context: WorkspaceContext, caseId: string): Promise<WorkspaceContext> {
  if (context.caseScope && context.caseScope.caseId !== caseId) throw new CapabilityError('FORBIDDEN', 'Acesso restrito ao caso compartilhado.');
  const access = await caseAccess(context.userId, caseId);
  if (access.owner && access.officeId === context.officeId && !context.caseScope) return { ...context };
  return { ...context, officeId: access.officeId,
    caseScope: { caseId, homeOfficeId: context.caseScope?.homeOfficeId ?? context.officeId } };
}
