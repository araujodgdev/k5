import 'server-only';
import { database } from '@/lib/database';
import type { CapabilityName } from '@/lib/capabilities/contracts';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { WorkspaceContext } from '@/lib/application/context';
import { contextForCase, documentAccess } from './access';

// Only operations whose entire data surface can be bounded to a single case may use a guest grant.
export const sharedCaseCapabilities = new Set<CapabilityName>([
  'k5_vault_update_case', 'k5_vault_list_folders', 'k5_vault_create_folder', 'k5_vault_update_folder_access', 'k5_vault_delete_folder',
  'k5_vault_list_documents', 'k5_vault_get_document', 'k5_vault_update_document', 'k5_vault_delete_document',
  'k5_vault_add_document_version', 'k5_vault_download_document', 'k5_vault_retry_ingestion', 'k5_vault_ingest_upload',
  'k5_knowledge_search', 'k5_knowledge_get_source', 'k5_knowledge_get_index_status', 'k5_knowledge_reindex',
  'k5_vault_plan_annexes', 'k5_vault_generate_annexes',
  'k5_research_get_profile', 'k5_research_save_profile', 'k5_research_list_references',
  'k5_research_assess_material', 'k5_research_get_assessment',
  'k5_research_add_reference', 'k5_research_update_reference', 'k5_research_remove_reference',
]);

/** Resolve every supplied resource before switching the data office, including secondary targets. */
export async function scopeCapability(context: WorkspaceContext, name: CapabilityName, input: Record<string, unknown>) {
  if (!sharedCaseCapabilities.has(name)) return context;
  let scoped = context;
  const caseIds: string[] = [];
  const documents = [input.documentId, input.scanDocumentId, input.petitionDocumentId, ...(Array.isArray(input.documentIds) ? input.documentIds : [])].filter((v): v is string => typeof v === 'string');
  const folders = [input.folderId, input.parentId].filter((v): v is string => typeof v === 'string');
  if (typeof input.caseId === 'string') caseIds.push(input.caseId);
  for (const id of documents) {
    const row = await database.prepare('SELECT case_id FROM vault_document WHERE id=? AND deleted_at IS NULL').get<{ case_id: string | null }>(id);
    if (!row) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');
    const checked = await documentAccess(context, id);
    if (checked.caseScope) scoped = checked;
    if (row.case_id) caseIds.push(row.case_id);
    else if (scoped.caseScope) throw new CapabilityError('FORBIDDEN', 'Selecione apenas documentos do caso compartilhado.');
  }
  for (const id of folders) {
    const row = await database.prepare('SELECT case_id FROM vault_folder WHERE id=? AND deleted_at IS NULL').get<{ case_id: string }>(id);
    if (!row) throw new CapabilityError('NOT_FOUND', 'Pasta não encontrada.');
    caseIds.push(row.case_id);
  }
  if (typeof input.referenceId === 'string') {
    const row = await database.prepare('SELECT case_id FROM research_case_reference WHERE id=? AND deleted_at IS NULL').get<{ case_id: string }>(input.referenceId);
    if (!row) throw new CapabilityError('NOT_FOUND', 'Referência não encontrada.');
    caseIds.push(row.case_id);
  }
  if (typeof input.assessmentId === 'string') {
    const row = await database.prepare('SELECT case_id FROM research_case_assessment WHERE id=?').get<{ case_id: string }>(input.assessmentId);
    if (!row) throw new CapabilityError('NOT_FOUND', 'Avaliação não encontrada.');
    caseIds.push(row.case_id);
  }
  for (const caseId of new Set(caseIds)) scoped = await contextForCase(scoped, caseId);
  if (scoped.caseScope) {
    // All documents must really live in the one authorized case, including a library item seen before the scope changed.
    for (const id of documents) {
      if (!await database.prepare('SELECT 1 FROM vault_document WHERE id=? AND office_id=? AND case_id=? AND deleted_at IS NULL')
        .get(id, scoped.officeId, scoped.caseScope.caseId)) throw new CapabilityError('FORBIDDEN', 'Selecione apenas documentos do caso compartilhado.');
    }
    if (input.scope === 'library' || input.caseId === null || (typeof input.targetCaseId === 'string' && input.targetCaseId !== scoped.caseScope.caseId))
      throw new CapabilityError('FORBIDDEN', 'Os arquivos devem permanecer no caso compartilhado.');
  }
  return scoped;
}
