import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import {
  countVaultDocuments, createVaultDocument, createVaultCase, createVaultFolder, deleteVaultFolder, findVaultCase,
  findVaultDocument, findVaultDocumentIncludingDeleted, findVaultFolder, listVaultCases, listVaultDocuments,
  listVaultFolders, retryVaultDocument, updateVaultCase, vaultFolderPath, VaultHttpError,
} from '@/lib/vault';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';
import type { WorkspaceContext } from './context';
import { requireAndConsumeApproval } from './approvals-service';
import { consumeUploadRef, releaseUploadRef } from './uploads-service';
import { enqueueDeletion } from '@/lib/knowledge/indexing';
import { searchKnowledgeEngine } from '@/lib/knowledge/retrieval';

/** Vault errors already carry the product message; only the status has to become a stable code. */
export function asCapabilityError(error: unknown): unknown {
  if (!(error instanceof VaultHttpError)) return error;
  if (error.status === 404) return new CapabilityError('NOT_FOUND', error.message);
  if (error.status === 409) return new CapabilityError('NOT_READY', error.message);
  if (error.status === 403) return new CapabilityError('FORBIDDEN', error.message);
  if (error.status === 503) return new CapabilityError('NOT_READY', error.message);
  return new CapabilityError('INVALID', error.message);
}

/** `findVaultDocument` already excludes tombstones, so one lookup settles both office and liveness. */
function requireDocument(context: WorkspaceContext, documentId: string) {
  const document = findVaultDocument(context.officeId, documentId);
  if (!document) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado no Cofre deste escritório.');
  return document;
}

export function listCases(context: WorkspaceContext): CapabilityOutput<'k5_vault_list_cases'> {
  return { cases: listVaultCases(context.officeId) };
}

export function createCase(context: WorkspaceContext, input: CapabilityInput<'k5_vault_create_case'>): CapabilityOutput<'k5_vault_create_case'> {
  // Idempotent by natural key: a retried tool call must not leave two identical cases behind.
  const existing = listCases(context).cases.find((item) => item.name.toLowerCase() === input.name.toLowerCase());
  if (existing) return { case: existing, created: false };
  try {
    return { case: createVaultCase(context.officeId, context.userId, input.name, { description: input.description, client: input.client }), created: true };
  } catch (error) { throw asCapabilityError(error); }
}

export function updateCase(context: WorkspaceContext, input: CapabilityInput<'k5_vault_update_case'>): CapabilityOutput<'k5_vault_update_case'> {
  if (!findVaultCase(context.officeId, input.caseId)) throw new CapabilityError('NOT_FOUND', 'Caso não encontrado.');
  try {
    return { case: updateVaultCase(context.officeId, input.caseId, { name: input.name, description: input.description, client: input.client }) };
  } catch (error) { throw asCapabilityError(error); }
}

export function listFolders(context: WorkspaceContext, input: CapabilityInput<'k5_vault_list_folders'>): CapabilityOutput<'k5_vault_list_folders'> {
  if (!findVaultCase(context.officeId, input.caseId)) throw new CapabilityError('NOT_FOUND', 'Caso não encontrado.');
  const parentId = input.parentId ?? null;
  if (parentId) {
    const parent = findVaultFolder(context.officeId, parentId);
    if (!parent || parent.caseId !== input.caseId) throw new CapabilityError('NOT_FOUND', 'Pasta não encontrada.');
  }
  return { folders: listVaultFolders(context.officeId, input.caseId, parentId), path: parentId ? vaultFolderPath(context.officeId, parentId) : [] };
}

export function createFolder(context: WorkspaceContext, input: CapabilityInput<'k5_vault_create_folder'>): CapabilityOutput<'k5_vault_create_folder'> {
  try {
    return { folder: createVaultFolder(context.officeId, context.userId, input.caseId, input.name, input.parentId ?? null) };
  } catch (error) { throw asCapabilityError(error); }
}

export function deleteFolder(context: WorkspaceContext, input: CapabilityInput<'k5_vault_delete_folder'>): CapabilityOutput<'k5_vault_delete_folder'> {
  try { deleteVaultFolder(context.officeId, input.folderId); }
  catch (error) { throw asCapabilityError(error); }
  return { success: true };
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
    'Exclusão de caso no Cofre requer aprovação explícita.',
  );

  // Documents are reassigned, never cascade-deleted: removing a folder is not removing its contents.
  if (input.targetCaseId) {
    const target = database.prepare('SELECT id FROM vault_case WHERE id=? AND office_id=? AND deleted_at IS NULL').get(input.targetCaseId, context.officeId);
    if (!target) throw new CapabilityError('NOT_FOUND', 'Caso de destino não encontrado.');
    database.prepare('UPDATE vault_document SET case_id=?, updated_at=CURRENT_TIMESTAMP WHERE case_id=? AND office_id=? AND deleted_at IS NULL')
      .run(input.targetCaseId, input.caseId, context.officeId);
  } else {
    database.prepare("UPDATE vault_document SET case_id=NULL, scope='library', updated_at=CURRENT_TIMESTAMP WHERE case_id=? AND office_id=? AND deleted_at IS NULL")
      .run(input.caseId, context.officeId);
  }

  // The case's own folder tree goes with it; the documents were already reassigned above.
  database.prepare('UPDATE vault_folder SET deleted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE case_id=? AND office_id=? AND deleted_at IS NULL').run(input.caseId, context.officeId);
  database.prepare('UPDATE vault_document SET folder_id=NULL WHERE case_id=? AND office_id=?').run(input.caseId, context.officeId);
  database.prepare('UPDATE vault_case SET deleted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=?').run(input.caseId, context.officeId);
  return { success: true };
}

export function listDocuments(context: WorkspaceContext, input: CapabilityInput<'k5_vault_list_documents'>): CapabilityOutput<'k5_vault_list_documents'> {
  const filters = { scope: input.scope ?? null, caseId: input.caseId ?? null, ...(input.folderId === undefined ? {} : { folderId: input.folderId }) };
  // Tombstones are excluded in SQL and the page is taken in SQL: no per-row liveness query, and
  // no loading the whole office to slice twenty rows off the front of it.
  const documents = listVaultDocuments(context.officeId, { ...filters, limit: input.limit ?? 20 });
  return { documents, total: countVaultDocuments(context.officeId, filters) };
}

export function getDocument(context: WorkspaceContext, input: CapabilityInput<'k5_vault_get_document'>): CapabilityOutput<'k5_vault_get_document'> {
  const doc = requireDocument(context, input.documentId);
  return {
    document: {
      id: doc.id, name: doc.name, caseId: doc.caseId, caseName: doc.caseName, folderId: doc.folderId, scope: doc.scope,
      status: doc.status, progress: doc.progress, errorMessage: doc.errorMessage,
      sourceCount: doc.sourceCount, createdAt: doc.createdAt,
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
      // Out of every case means out of every folder of that case.
      database.prepare("UPDATE vault_document SET case_id=NULL, folder_id=NULL, scope='library', updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND deleted_at IS NULL")
        .run(input.documentId, context.officeId);
    } else {
      const caseExists = database.prepare('SELECT 1 FROM vault_case WHERE id=? AND office_id=? AND deleted_at IS NULL').get(input.caseId, context.officeId);
      if (!caseExists) throw new CapabilityError('NOT_FOUND', 'Caso não encontrado.');
      database.prepare("UPDATE vault_document SET case_id=?, folder_id=NULL, scope='case', updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND deleted_at IS NULL")
        .run(input.caseId, input.documentId, context.officeId);
    }
  }

  if (input.folderId !== undefined) {
    const current = requireDocument(context, input.documentId);
    if (input.folderId === null) {
      database.prepare('UPDATE vault_document SET folder_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND deleted_at IS NULL')
        .run(input.documentId, context.officeId);
    } else {
      // The folder has to belong to the case this document is in, so a move cannot relocate it
      // into another case's tree while leaving case_id behind.
      const folder = findVaultFolder(context.officeId, input.folderId);
      if (!folder || folder.caseId !== current.caseId) throw new CapabilityError('NOT_FOUND', 'Pasta não encontrada neste caso.');
      database.prepare('UPDATE vault_document SET folder_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND deleted_at IS NULL')
        .run(input.folderId, input.documentId, context.officeId);
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
    'Remoção de documento no Cofre exige aprovação explícita.',
  );

  const versions = database.prepare('SELECT stored_name AS storedName FROM vault_document_version WHERE document_id=? AND office_id=?')
    .all(input.documentId, context.officeId) as Array<{ storedName: string }>;
  const current = database.prepare('SELECT stored_name AS storedName FROM vault_document WHERE id=? AND office_id=?')
    .get(input.documentId, context.officeId) as { storedName: string } | undefined;

  database.exec('BEGIN IMMEDIATE');
  try {
    // The tombstone and the loss of searchability are immediate and transactional. Bytes in object
    // storage and rows in a remote index are chased afterwards through the deletion queue, which
    // can retry without ever making the document visible again.
    database.prepare("UPDATE vault_document SET deleted_at=CURRENT_TIMESTAMP, status='failed', error_message='Documento excluído.', updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=?")
      .run(input.documentId, context.officeId);
    database.prepare("UPDATE knowledge_index_job SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE document_id=? AND office_id=? AND status IN ('queued','running')")
      .run(input.documentId, context.officeId);
    database.prepare('DELETE FROM vault_document_chunk WHERE document_id=? AND office_id=?').run(input.documentId, context.officeId);
    database.exec('COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }

  enqueueDeletion(context.officeId, 'vector_document', input.documentId);
  for (const key of new Set([...versions.map((row) => row.storedName), current?.storedName].filter(Boolean) as string[])) {
    enqueueDeletion(context.officeId, 'object', key);
  }

  return { success: true };
}

/**
 * Adds an immutable version from an upload the server already stored. The previous version stays
 * addressable, so a citation made against it still resolves to the text it quoted.
 */
export function addDocumentVersion(context: WorkspaceContext, input: CapabilityInput<'k5_vault_add_document_version'>): CapabilityOutput<'k5_vault_add_document_version'> {
  const doc = requireDocument(context, input.documentId);
  const upload = consumeUploadRef(context, input.uploadRef);

  const currentMax = database.prepare('SELECT max(version) AS maxVersion FROM vault_document_version WHERE document_id=?')
    .get(input.documentId) as { maxVersion: number | null } | undefined;
  const nextVersion = (currentMax?.maxVersion ?? 0) + 1;

  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare('UPDATE vault_document_version SET is_active=0 WHERE document_id=? AND office_id=?').run(doc.id, context.officeId);
    database.prepare(`
      INSERT INTO vault_document_version (id, office_id, document_id, version, original_name, stored_name, mime_type, byte_size, sha256, created_by, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(randomUUID(), context.officeId, doc.id, nextVersion, upload.originalName, upload.storageKey, upload.mimeType, upload.byteSize, upload.sha256, context.userId);
    // The active version becomes the document's content, so it is re-extracted and re-indexed.
    database.prepare(`
      UPDATE vault_document SET original_name=?, stored_name=?, mime_type=?, byte_size=?, sha256=?,
        status='queued', progress=0, error_message=NULL, lease_owner=NULL, lease_expires_at=NULL, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND office_id=? AND deleted_at IS NULL
    `).run(upload.originalName, upload.storageKey, upload.mimeType, upload.byteSize, upload.sha256, doc.id, context.officeId);
    database.exec('COMMIT');
  } catch (error) {
    // Same reasoning as ingestUpload: the rollback undid everything, so the reference is unspent.
    database.exec('ROLLBACK');
    releaseUploadRef(context, input.uploadRef);
    throw error;
  }

  return { document: getDocument(context, { documentId: input.documentId }).document, version: nextVersion };
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
  return getDocument(context, { documentId: input.documentId });
}

/**
 * Turns a server-issued upload reference into a Vault document. The reference is single-use and
 * bound to this person and office; the storage key travels with it and is never taken from input.
 */
export function ingestUpload(context: WorkspaceContext, input: CapabilityInput<'k5_vault_ingest_upload'>): CapabilityOutput<'k5_vault_ingest_upload'> {
  if (input.scope === 'case' && !input.caseId) throw new CapabilityError('INVALID', 'Escolha um caso para o documento.');
  const upload = consumeUploadRef(context, input.uploadRef);
  try {
    const document = createVaultDocument(context.officeId, context.userId, upload, { scope: input.scope, caseId: input.caseId ?? null, folderId: input.folderId ?? null });
    return getDocument(context, { documentId: document.id });
  } catch (error) {
    // createVaultDocument is transactional, so a throw means no document and no version exist.
    // Handing the reference back is what keeps a rejected destination from costing the upload.
    releaseUploadRef(context, input.uploadRef);
    throw asCapabilityError(error);
  }
}

export async function searchKnowledge(context: WorkspaceContext, input: CapabilityInput<'k5_knowledge_search'>): Promise<CapabilityOutput<'k5_knowledge_search'>> {
  return searchKnowledgeEngine(context, input);
}

/** Documents of this office that are ready for analysis, used to validate a run before queueing it. */
export function readyDocumentIds(context: WorkspaceContext, documentIds: string[]) {
  if (!documentIds.length) return [];
  const marks = documentIds.map(() => '?').join(',');
  return (database.prepare(`SELECT id FROM vault_document WHERE office_id=? AND status='ready' AND deleted_at IS NULL AND id IN (${marks})`)
    .all(context.officeId, ...documentIds) as Array<{ id: string }>).map((row) => String(row.id));
}

/** The cleanup worker is the only caller that may look at a tombstoned row. */
export function findDeletedDocument(officeId: string, documentId: string) {
  return findVaultDocumentIncludingDeleted(officeId, documentId);
}
