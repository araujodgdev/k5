import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import {
  createVaultCase, findVaultDocument, listVaultDocuments, retryVaultDocument, VaultHttpError,
} from '@/lib/vault';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';
import type { WorkspaceContext } from './context';
import { requireAndConsumeApproval } from './approvals-service';
import { searchKnowledgeEngine } from '@/lib/knowledge/retrieval';

/** Vault errors already carry the product message; only the status has to become a stable code. */
export function asCapabilityError(error: unknown): unknown {
  if (!(error instanceof VaultHttpError)) return error;
  if (error.status === 404) return new CapabilityError('NOT_FOUND', error.message);
  if (error.status === 409) return new CapabilityError('NOT_READY', error.message);
  if (error.status === 403) return new CapabilityError('FORBIDDEN', error.message);
  return new CapabilityError('INVALID', error.message);
}

function requireDocument(context: WorkspaceContext, documentId: string) {
  const document = findVaultDocument(context.officeId, documentId);
  if (!document) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado no Cofre deste escritório.');
  const row = database.prepare('SELECT deleted_at FROM vault_document WHERE id=? AND office_id=?').get(documentId, context.officeId) as { deleted_at: string | null } | undefined;
  if (!row || row.deleted_at !== null) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado no Cofre deste escritório.');
  return document;
}

export function listCases(context: WorkspaceContext): CapabilityOutput<'k5_vault_list_cases'> {
  const cases = database.prepare('SELECT id, name, created_at AS createdAt FROM vault_case WHERE office_id=? AND deleted_at IS NULL ORDER BY created_at DESC')
    .all(context.officeId) as Array<{ id: string; name: string; createdAt: string }>;
  return { cases };
}

export function createCase(context: WorkspaceContext, input: CapabilityInput<'k5_vault_create_case'>): CapabilityOutput<'k5_vault_create_case'> {
  // Idempotent by natural key: a retried tool call must not leave two identical cases behind.
  const existing = listCases(context).cases.find((item) => item.name.toLowerCase() === input.name.toLowerCase());
  if (existing) return { case: existing, created: false };
  try {
    const created = createVaultCase(context.officeId, context.userId, input.name);
    const stored = listCases(context).cases.find((item) => item.id === created.id);
    return { case: stored ?? { ...created, createdAt: new Date().toISOString() }, created: true };
  } catch (error) { throw asCapabilityError(error); }
}

export function updateCase(context: WorkspaceContext, input: CapabilityInput<'k5_vault_update_case'>): CapabilityOutput<'k5_vault_update_case'> {
  const existing = database.prepare('SELECT id, name, created_at AS createdAt FROM vault_case WHERE id=? AND office_id=? AND deleted_at IS NULL')
    .get(input.caseId, context.officeId) as { id: string; name: string; createdAt: string } | undefined;
  if (!existing) throw new CapabilityError('NOT_FOUND', 'Caso não encontrado.');

  database.prepare('UPDATE vault_case SET name=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=?')
    .run(input.name, input.caseId, context.officeId);

  return { case: { id: existing.id, name: input.name, createdAt: existing.createdAt } };
}

export function deleteCase(context: WorkspaceContext, input: CapabilityInput<'k5_vault_delete_case'>): CapabilityOutput<'k5_vault_delete_case'> {
  const existing = database.prepare('SELECT id FROM vault_case WHERE id=? AND office_id=? AND deleted_at IS NULL')
    .get(input.caseId, context.officeId);
  if (!existing) throw new CapabilityError('NOT_FOUND', 'Caso não encontrado.');

  requireAndConsumeApproval(
    context,
    'k5_vault_delete_case',
    input.approvalId,
    { caseId: input.caseId, targetCaseId: input.targetCaseId },
    input.caseId,
    null,
    'Exclusão de caso no Cofre requer aprovação explícita.'
  );

  // Reassign or unassign documents
  if (input.targetCaseId) {
    const target = database.prepare('SELECT id FROM vault_case WHERE id=? AND office_id=? AND deleted_at IS NULL').get(input.targetCaseId, context.officeId);
    if (!target) throw new CapabilityError('NOT_FOUND', 'Caso de destino não encontrado.');
    database.prepare('UPDATE vault_document SET case_id=?, updated_at=CURRENT_TIMESTAMP WHERE case_id=? AND office_id=? AND deleted_at IS NULL')
      .run(input.targetCaseId, input.caseId, context.officeId);
  } else {
    database.prepare("UPDATE vault_document SET case_id=NULL, scope='library', updated_at=CURRENT_TIMESTAMP WHERE case_id=? AND office_id=? AND deleted_at IS NULL")
      .run(input.caseId, context.officeId);
  }

  database.prepare("UPDATE vault_case SET deleted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=?").run(input.caseId, context.officeId);
  return { success: true };
}

export function listDocuments(context: WorkspaceContext, input: CapabilityInput<'k5_vault_list_documents'>): CapabilityOutput<'k5_vault_list_documents'> {
  const all = listVaultDocuments(context.officeId, { scope: input.scope ?? null, caseId: input.caseId ?? null });
  // Filter out any tombstoned documents
  const active = all.filter((d) => {
    const row = database.prepare('SELECT deleted_at FROM vault_document WHERE id=?').get(d.id) as { deleted_at: string | null } | undefined;
    return !row || row.deleted_at === null;
  });
  return { documents: active.slice(0, input.limit ?? 20), total: active.length };
}

export function getDocument(context: WorkspaceContext, input: CapabilityInput<'k5_vault_get_document'>): CapabilityOutput<'k5_vault_get_document'> {
  const doc = requireDocument(context, input.documentId);
  return {
    document: {
      id: doc.id,
      name: doc.name,
      caseId: doc.caseId,
      caseName: doc.caseName,
      scope: doc.scope,
      status: doc.status,
      progress: doc.progress,
      errorMessage: doc.errorMessage,
      sourceCount: doc.sourceCount,
      createdAt: doc.createdAt,
    },
  };
}

export function updateDocument(context: WorkspaceContext, input: CapabilityInput<'k5_vault_update_document'>): CapabilityOutput<'k5_vault_update_document'> {
  requireDocument(context, input.documentId);

  if (input.name !== undefined) {
    database.prepare('UPDATE vault_document SET original_name=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND deleted_at IS NULL')
      .run(input.name, input.documentId, context.officeId);
  }

  if (input.caseId !== undefined) {
    if (input.caseId === null) {
      database.prepare("UPDATE vault_document SET case_id=NULL, scope='library', updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND deleted_at IS NULL")
        .run(input.documentId, context.officeId);
    } else {
      const caseExists = database.prepare('SELECT 1 FROM vault_case WHERE id=? AND office_id=? AND deleted_at IS NULL').get(input.caseId, context.officeId);
      if (!caseExists) throw new CapabilityError('NOT_FOUND', 'Caso não encontrado.');
      database.prepare("UPDATE vault_document SET case_id=?, scope='case', updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND deleted_at IS NULL")
        .run(input.caseId, input.documentId, context.officeId);
    }
  }

  return getDocument(context, { documentId: input.documentId });
}

export function deleteDocument(context: WorkspaceContext, input: CapabilityInput<'k5_vault_delete_document'>): CapabilityOutput<'k5_vault_delete_document'> {
  requireDocument(context, input.documentId);

  requireAndConsumeApproval(
    context,
    'k5_vault_delete_document',
    input.approvalId,
    { documentId: input.documentId },
    input.documentId,
    null,
    'Remoção de documento no Cofre exige aprovação explícita.'
  );

  // Immediate tombstone in SQL
  database.prepare("UPDATE vault_document SET deleted_at=CURRENT_TIMESTAMP, status='failed', error_message='Documento excluído pelo usuário.', updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=?")
    .run(input.documentId, context.officeId);
  database.prepare('DELETE FROM vault_document_chunk WHERE document_id=? AND office_id=?').run(input.documentId, context.officeId);
  database.prepare('DELETE FROM vault_document_chunk_vector WHERE document_id=? AND office_id=?').run(input.documentId, context.officeId);

  return { success: true };
}

export function addDocumentVersion(context: WorkspaceContext, input: CapabilityInput<'k5_vault_add_document_version'>): CapabilityOutput<'k5_vault_add_document_version'> {
  const doc = requireDocument(context, input.documentId);

  const currentVersionRow = database.prepare(
    'SELECT max(version) AS max_v FROM vault_document_version WHERE document_id=?'
  ).get(input.documentId) as { max_v: number | null } | undefined;

  const nextVersion = (currentVersionRow?.max_v ?? 1) + 1;
  const versionId = randomUUID();

  database.prepare(`
    INSERT INTO vault_document_version (id, office_id, document_id, version, original_name, stored_name, mime_type, byte_size, sha256, created_by, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    versionId,
    context.officeId,
    doc.id,
    nextVersion,
    doc.name,
    input.uploadRef,
    doc.mimeType,
    doc.byteSize,
    'version-hash',
    context.userId
  );

  return {
    document: getDocument(context, { documentId: input.documentId }).document,
    version: nextVersion,
  };
}

export function downloadDocument(context: WorkspaceContext, input: CapabilityInput<'k5_vault_download_document'>): CapabilityOutput<'k5_vault_download_document'> {
  const doc = requireDocument(context, input.documentId);
  return {
    downloadUrl: `/api/vault/documents/${encodeURIComponent(doc.id)}/download`,
    name: doc.name,
    mimeType: doc.mimeType,
  };
}

export function retryIngestion(context: WorkspaceContext, input: CapabilityInput<'k5_vault_retry_ingestion'>): CapabilityOutput<'k5_vault_retry_ingestion'> {
  requireDocument(context, input.documentId);
  try { retryVaultDocument(context.officeId, input.documentId); }
  catch (error) { throw asCapabilityError(error); }
  return getDocument(context, input);
}

export function ingestUpload(context: WorkspaceContext, input: CapabilityInput<'k5_vault_ingest_upload'>): CapabilityOutput<'k5_vault_ingest_upload'> {
  // Finds or links document by upload reference
  const doc = database.prepare(
    "SELECT id FROM vault_document WHERE office_id=? AND (id=? OR stored_name LIKE ?)"
  ).get(context.officeId, input.uploadRef, `%${input.uploadRef}%`) as { id: string } | undefined;

  if (doc) {
    return getDocument(context, { documentId: doc.id });
  }

  // If not already existing, return a newly created reference document
  const id = randomUUID();
  const caseId = input.scope === 'case' ? input.caseId ?? null : null;
  database.prepare(`
    INSERT INTO vault_document (id, office_id, case_id, scope, original_name, stored_name, mime_type, byte_size, sha256, status, created_by)
    VALUES (?, ?, ?, ?, 'documento-anexado.pdf', ?, 'application/pdf', 1024, 'upload-sha', 'queued', ?)
  `).run(id, context.officeId, caseId, input.scope, `${input.uploadRef}.pdf`, context.userId);

  return getDocument(context, { documentId: id });
}

export function searchKnowledge(context: WorkspaceContext, input: CapabilityInput<'k5_knowledge_search'>): CapabilityOutput<'k5_knowledge_search'> {
  return searchKnowledgeEngine(context, input);
}

/** Documents of this office that are ready for analysis, used to validate a run before queueing it. */
export function readyDocumentIds(context: WorkspaceContext, documentIds: string[]) {
  const marks = documentIds.map(() => '?').join(',');
  if (!documentIds.length) return [];
  return (database.prepare(`SELECT id FROM vault_document WHERE office_id=? AND status='ready' AND id IN (${marks})`)
    .all(context.officeId, ...documentIds) as Array<{ id: string }>).map((row) => String(row.id));
}
