import 'server-only';
import { database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';
import { canvasModules } from '@/lib/canvas-protocol';
import { vaultDocumentPath } from '@/lib/vault-document-path';
import type { WorkspaceContext } from './context';

type Destination = CapabilityOutput<'k5_ui_open_resource'>;

const required = (id: string | undefined, what: string) => {
  if (!id) throw new CapabilityError('INVALID', `Informe ${what}.`);
  return id;
};

/** One row of the office by id, or NOT_FOUND in the person's words. */
async function named(sql: string, params: unknown[], missing: string) {
  const row = await database.prepare(sql).get<{ name: string }>(...params);
  if (!row) throw new CapabilityError('NOT_FOUND', missing);
  return row.name;
}

/**
 * The canvas address of what the Lume was asked to show, checked against the person's office, and the
 * title its tab takes. The chat turn turns the result into a canvas command that opens the tab.
 */
export async function openResource(context: WorkspaceContext, input: CapabilityInput<'k5_ui_open_resource'>): Promise<Destination> {
  const { resourceType, resourceId } = input;
  switch (resourceType) {
    case 'module': {
      const place = canvasModules[input.module!];
      return { path: place.href, title: place.title };
    }
    case 'agenda':
      return { path: canvasModules.agenda.href, title: canvasModules.agenda.title };
    case 'vault':
      return { path: canvasModules.casos.href, title: canvasModules.casos.title };
    case 'client': {
      const id = required(resourceId, 'o cliente');
      const title = await named('SELECT name FROM crm_client WHERE id=? AND office_id=?', [id, context.officeId], 'Cliente não encontrado.');
      return { path: `/app/agenda/clients/${encodeURIComponent(id)}`, title };
    }
    case 'activity': {
      const id = required(resourceId, 'a atividade');
      await named('SELECT title AS name FROM agenda_activity WHERE id=? AND office_id=?', [id, context.officeId], 'Atividade não encontrada.');
      return { path: `/app/agenda?activityId=${encodeURIComponent(id)}` };
    }
    case 'case': {
      if (!resourceId) return { path: canvasModules.casos.href, title: canvasModules.casos.title };
      const title = await named('SELECT name FROM vault_case WHERE id=? AND office_id=? AND deleted_at IS NULL', [resourceId, context.officeId], 'Caso não encontrado.');
      return { path: `/app/vault/cases/${encodeURIComponent(resourceId)}`, title };
    }
    case 'document': {
      if (!resourceId) return { path: canvasModules.casos.href, title: canvasModules.casos.title };
      const path = await vaultDocumentPath(database, context.officeId, resourceId);
      if (!path) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');
      return { path };
    }
    case 'artifact': {
      const id = required(resourceId, 'a página');
      const title = await named('SELECT title AS name FROM ai_artifact WHERE id=? AND office_id=? AND user_id=?', [id, context.officeId, context.userId], 'Documento gerado não encontrado.');
      return { path: `/app/documents/${encodeURIComponent(id)}`, title };
    }
    case 'run': {
      const id = required(resourceId, 'a tarefa');
      const run = await database.prepare('SELECT artifact_id FROM ai_run WHERE id=? AND office_id=? AND user_id=?').get<{ artifact_id: string | null }>(id, context.officeId, context.userId);
      if (!run) throw new CapabilityError('NOT_FOUND', 'Tarefa não encontrada.');
      if (!run.artifact_id) throw new CapabilityError('INVALID', 'A tarefa ainda não gerou um documento. O andamento aparece no plano do Lume.');
      return openResource(context, { resourceType: 'artifact', resourceId: run.artifact_id });
    }
    default:
      throw new CapabilityError('INVALID', 'Tipo de recurso inválido.');
  }
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
