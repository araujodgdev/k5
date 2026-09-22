import 'server-only';
import { database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';
import type { WorkspaceContext } from './context';

export async function openResource(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_ui_open_resource'>
): Promise<CapabilityOutput<'k5_ui_open_resource'>> {
  const { resourceType, resourceId } = input;
  let path = '/app';

  switch (resourceType) {
    case 'agenda':
      path = '/app/agenda';
      break;
    case 'client':
    case 'activity': {
      if (!resourceId) throw new CapabilityError('INVALID', 'Informe o registro.');
      const table = resourceType === 'client' ? 'crm_client' : 'agenda_activity';
      const found = await database.prepare(`SELECT 1 FROM ${table} WHERE id=? AND office_id=?`).get(resourceId, context.officeId);
      if (!found) throw new CapabilityError('NOT_FOUND', 'Registro não encontrado.');
      path = resourceType === 'client'
        ? `/app/agenda/clients/${encodeURIComponent(resourceId)}`
        : `/app/agenda?activityId=${encodeURIComponent(resourceId)}`;
      break;
    }
    case 'vault':
      path = '/app/vault';
      break;
    case 'case':
      if (resourceId) {
        const found = await database.prepare('SELECT 1 FROM vault_case WHERE id=? AND office_id=? AND deleted_at IS NULL').get(resourceId, context.officeId);
        if (!found) throw new CapabilityError('NOT_FOUND', 'Caso não encontrado.');
      }
      path = resourceId ? `/app/vault/cases/${encodeURIComponent(resourceId)}` : '/app/vault';
      break;
    case 'document':
      if (resourceId) {
        const found = await database.prepare('SELECT 1 FROM vault_document WHERE id=? AND office_id=? AND deleted_at IS NULL').get(resourceId, context.officeId);
        if (!found) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');
      }
      path = resourceId ? `/app/vault?documentId=${encodeURIComponent(resourceId)}` : '/app/vault';
      break;
    case 'run':
      if (resourceId) {
        const found = await database.prepare('SELECT 1 FROM ai_run WHERE id=? AND office_id=? AND user_id=?').get(resourceId, context.officeId, context.userId);
        if (!found) throw new CapabilityError('NOT_FOUND', 'Tarefa não encontrada.');
      }
      path = resourceId ? `/app/documents?runId=${encodeURIComponent(resourceId)}` : '/app/documents';
      break;
    case 'artifact':
      if (resourceId) {
        const found = await database.prepare('SELECT 1 FROM ai_artifact WHERE id=? AND office_id=? AND user_id=?').get(resourceId, context.officeId, context.userId);
        if (!found) throw new CapabilityError('NOT_FOUND', 'Documento gerado não encontrado.');
      }
      path = resourceId ? `/app/documents?artifactId=${encodeURIComponent(resourceId)}` : '/app/documents';
      break;
    default:
      throw new CapabilityError('INVALID', 'Tipo de recurso inválido.');
  }

  return { path };
}

/**
 * Revocation goes through Better Auth, which owns the session table and whatever caching sits in
 * front of it. Deleting rows directly - and guessing the column name at runtime - works only while
 * the cookie cache happens to be disabled, and stops being immediate the moment it is turned on.
 */
export async function endGlobalSession(): Promise<CapabilityOutput<'k5_session_end_global'>> {
  const { headers } = await import('next/headers');
  const { auth } = await import('@/lib/auth');
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders, query: { disableCookieCache: true, disableRefresh: true } });
  try {
    if (session) {
      const { revokePushSubscriptionsForUser } = await import('@/lib/notifications/revocation');
      await revokePushSubscriptionsForUser(database, session.user.id);
    }
  } finally {
    await auth.api.revokeSessions({ headers: requestHeaders });
  }
  return { success: true, message: 'Todas as sessões ativas foram encerradas.' };
}
