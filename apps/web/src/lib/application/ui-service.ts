import 'server-only';
import { database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';
import type { WorkspaceContext } from './context';

export function openResource(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_ui_open_resource'>
): CapabilityOutput<'k5_ui_open_resource'> {
  const { resourceType, resourceId } = input;
  let path = '/app';

  switch (resourceType) {
    case 'vault':
      path = '/app/vault';
      break;
    case 'case':
      if (resourceId) {
        const found = database.prepare('SELECT 1 FROM vault_case WHERE id=? AND office_id=? AND deleted_at IS NULL').get(resourceId, context.officeId);
        if (!found) throw new CapabilityError('NOT_FOUND', 'Caso não encontrado.');
      }
      path = resourceId ? `/app/vault?caseId=${encodeURIComponent(resourceId)}` : '/app/vault';
      break;
    case 'document':
      if (resourceId) {
        const found = database.prepare('SELECT 1 FROM vault_document WHERE id=? AND office_id=? AND deleted_at IS NULL').get(resourceId, context.officeId);
        if (!found) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');
      }
      path = resourceId ? `/app/vault?documentId=${encodeURIComponent(resourceId)}` : '/app/vault';
      break;
    case 'run':
      if (resourceId) {
        const found = database.prepare('SELECT 1 FROM ai_run WHERE id=? AND office_id=? AND user_id=?').get(resourceId, context.officeId, context.userId);
        if (!found) throw new CapabilityError('NOT_FOUND', 'Tarefa não encontrada.');
      }
      path = resourceId ? `/app/documents?runId=${encodeURIComponent(resourceId)}` : '/app/documents';
      break;
    case 'artifact':
      if (resourceId) {
        const found = database.prepare('SELECT 1 FROM ai_artifact WHERE id=? AND office_id=? AND user_id=?').get(resourceId, context.officeId, context.userId);
        if (!found) throw new CapabilityError('NOT_FOUND', 'Documento gerado não encontrado.');
      }
      path = resourceId ? `/app/documents?artifactId=${encodeURIComponent(resourceId)}` : '/app/documents';
      break;
    default:
      throw new CapabilityError('INVALID', 'Tipo de recurso inválido.');
  }

  return { path };
}

export function endGlobalSession(
  context: WorkspaceContext
): CapabilityOutput<'k5_session_end_global'> {
  // Better Auth session table: delete all active sessions for this user
  try {
    database.prepare('DELETE FROM session WHERE user_id=? OR userId=?').run(context.userId, context.userId);
  } catch {
    // If column name differs, try standard userId
    database.prepare('DELETE FROM session WHERE userId=?').run(context.userId);
  }

  return {
    success: true,
    message: 'Todas as sessões ativas foram encerradas com sucesso.',
  };
}
