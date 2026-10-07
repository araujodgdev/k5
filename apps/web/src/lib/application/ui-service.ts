import 'server-only';
import { canvasModules } from '@/lib/canvas-protocol';
import { database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';
import { assertCapabilityAllowed, type WorkspaceContext } from './context';
import { authorizedCanvasResource } from '@/lib/canvas-resources';

export async function openResource(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_ui_open_resource'>
): Promise<CapabilityOutput<'k5_ui_open_resource'>> {
  const { resourceType, resourceId } = input;
  await assertCapabilityAllowed(context, 'k5_ui_open_resource');
  let path = '/app';
  let title: string | undefined;

  switch (resourceType) {
    case 'module': {
      if (!input.module) throw new CapabilityError('INVALID', 'Informe o módulo.');
      const destination = canvasModules[input.module];
      await authorizedCanvasResource(context, destination.href);
      return { path: destination.href, title: destination.title };
    }
    case 'agenda':
      path = '/app/agenda';
      break;
    case 'client':
    case 'activity': {
      if (!resourceId) throw new CapabilityError('INVALID', 'Informe o registro.');
      const table = resourceType === 'client' ? 'crm_client' : 'agenda_activity';
      const column = resourceType === 'client' ? 'name' : 'title';
      const found = await database.prepare(`SELECT ${column} AS title FROM ${table} WHERE id=? AND office_id=?`).get<{ title: string }>(resourceId, context.officeId);
      title = found?.title;
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
      path = resourceId ? (await authorizedCanvasResource(context, `/app/vault/cases/${encodeURIComponent(resourceId)}`)).href : '/app/vault';
      break;
    case 'document':
      path = resourceId ? (await authorizedCanvasResource(context, `/app/vault/files/${encodeURIComponent(resourceId)}`)).href : '/app/vault';
      break;
    case 'run':
      if (resourceId) {
        const found = await database.prepare('SELECT artifact_id FROM ai_run WHERE id=? AND office_id=? AND user_id=?').get<{ artifact_id: string | null }>(resourceId, context.officeId, context.userId);
        if (!found) throw new CapabilityError('NOT_FOUND', 'Tarefa não encontrada.');
        path = found.artifact_id ? (await authorizedCanvasResource(context, `/app/documents/${encodeURIComponent(found.artifact_id)}`)).href : '/app/agents';
      }
      else path = '/app/agents';
      break;
    case 'artifact':
      path = resourceId ? (await authorizedCanvasResource(context, `/app/documents/${encodeURIComponent(resourceId)}`)).href : '/app/agents';
      break;
    default:
      throw new CapabilityError('INVALID', 'Tipo de recurso inválido.');
  }

  const resource = await authorizedCanvasResource(context, path);
  return { path: resource.href, title: title ?? resource.title };
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
