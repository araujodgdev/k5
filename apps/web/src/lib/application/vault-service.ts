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
import { requireAgentApproval, requireAndConsumeApproval } from './approvals-service';
import { consumeUploadRef, releaseUploadRef } from './uploads-service';
import { enqueueDeletion } from '@/lib/knowledge/indexing';
import { searchKnowledgeEngine } from '@/lib/knowledge/retrieval';

/** Vault errors already carry the product message; only the status has to become a stable code. */
export function asCapabilityError(error: unknown): unknown {
  if (!(error instanceof VaultHttpError)) return error;
  if (error.status === 404) return new CapabilityError('NOT_FOUND', error.message);
  if (error.status === 409) return new CapabilityError(error.code ?? 'CONFLICT', error.message);
  if (error.status === 403) return new CapabilityError('FORBIDDEN', error.message);
  if (error.status === 503) return new CapabilityError('NOT_READY', error.message);
  return new CapabilityError('INVALID', error.message);
}

/** `findVaultDocument` already excludes tombstones, so one lookup settles both office and liveness. */
async function requireDocument(context: WorkspaceContext, documentId: string) {
  const document = await findVaultDocument(context.officeId, documentId);
  if (!document) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado no Cofre deste escritório.');
  return document;
}

export async function listCases(context: WorkspaceContext): Promise<CapabilityOutput<'k5_vault_list_cases'>> {
  return { cases: await listVaultCases(context.officeId) };
}

export async function createCase(context: WorkspaceContext, input: CapabilityInput<'k5_vault_create_case'>): Promise<CapabilityOutput<'k5_vault_create_case'>> {
  // Idempotent by natural key: a retried tool call must not leave two identical cases behind.
  const existing = (await listCases(context)).cases.find((item) => item.name.toLowerCase() === input.name.toLowerCase());
  if (existing) return { case: existing, created: false };
  try {
    return { case: await createVaultCase(context.officeId, context.userId, input.name, { description: input.description, client: input.client }), created: true };
  } catch (error) { throw asCapabilityError(error); }
}

export async function updateCase(context: WorkspaceContext, input: CapabilityInput<'k5_vault_update_case'>): Promise<CapabilityOutput<'k5_vault_update_case'>> {
  if (!await findVaultCase(context.officeId, input.caseId)) throw new CapabilityError('NOT_FOUND', 'Caso não encontrado.');
  try {
    return { case: await updateVaultCase(context.officeId, input.caseId, { name: input.name, description: input.description, client: input.client }) };
  } catch (error) { throw asCapabilityError(error); }
}

export async function listFolders(context: WorkspaceContext, input: CapabilityInput<'k5_vault_list_folders'>): Promise<CapabilityOutput<'k5_vault_list_folders'>> {
  if (!await findVaultCase(context.officeId, input.caseId)) throw new CapabilityError('NOT_FOUND', 'Caso não encontrado.');
  const parentId = input.parentId ?? null;
  if (parentId) {
    const parent = await findVaultFolder(context.officeId, parentId);
    if (!parent || parent.caseId !== input.caseId) throw new CapabilityError('NOT_FOUND', 'Pasta não encontrada.');
  }
  return {
    folders: await listVaultFolders(context.officeId, input.caseId, parentId),
    path: parentId ? await vaultFolderPath(context.officeId, parentId) : [],
  };
}

export async function createFolder(context: WorkspaceContext, input: CapabilityInput<'k5_vault_create_folder'>): Promise<CapabilityOutput<'k5_vault_create_folder'>> {
  try {
    return { folder: await createVaultFolder(context.officeId, context.userId, input.caseId, input.name, input.parentId ?? null) };
  } catch (error) { throw asCapabilityError(error); }
}

export async function deleteFolder(context: WorkspaceContext, input: CapabilityInput<'k5_vault_delete_folder'>): Promise<CapabilityOutput<'k5_vault_delete_folder'>> {
  if (!await findVaultFolder(context.officeId, input.folderId)) throw new CapabilityError('NOT_FOUND', 'Pasta não encontrada.');
  await requireAgentApproval(context, 'k5_vault_delete_folder', input.approvalId, { folderId: input.folderId }, input.folderId, 'Remover uma pasta pede confirmação.');
  try { await deleteVaultFolder(context.officeId, input.folderId); }
  catch (error) { throw asCapabilityError(error); }
  return { success: true };
}

export async function deleteCase(context: WorkspaceContext, input: CapabilityInput<'k5_vault_delete_case'>): Promise<CapabilityOutput<'k5_vault_delete_case'>> {
  const existing = await database.prepare('SELECT id FROM vault_case WHERE id=? AND office_id=? AND deleted_at IS NULL')
    .get(input.caseId, context.officeId);
  if (!existing) throw new CapabilityError('NOT_FOUND', 'Caso não encontrado.');

  await requireAndConsumeApproval(
    context,
    'k5_vault_delete_case',
    input.approvalId,
    { caseId: input.caseId, targetCaseId: input.targetCaseId },
    input.caseId,
    null,
    'Exclusão de caso no Cofre requer aprovação explícita.',
    { allowConsumedRetry: true },
  );

  if (input.targetCaseId) {
    const target = await database.prepare('SELECT id FROM vault_case WHERE id=? AND office_id=? AND deleted_at IS NULL')
      .get(input.targetCaseId, context.officeId);
    if (!target) throw new CapabilityError('NOT_FOUND', 'Caso de destino não encontrado.');
  }

  // Deleting a case deletes what is filed in it. `targetCaseId` is the way to keep the documents:
  // it moves them to another case first, and then nothing is left for the cascade to take.
  const doomed = input.targetCaseId ? [] : await database.prepare(
    'SELECT id FROM vault_document WHERE case_id=? AND office_id=? AND deleted_at IS NULL',
  ).all(input.caseId, context.officeId) as Array<{ id: string }>;
  // Read before the batch: the tombstone does not move these rows, but the storage keys have to
  // be in hand to be queued, and a version's bytes outlive the row that points at them.
  const keys = doomed.length ? await storedNamesForCase(context.officeId, input.caseId) : [];

  const documentWrites = input.targetCaseId
    ? [database.prepare("UPDATE vault_document SET case_id=?, folder_id=NULL, scope='case', updated_at=CURRENT_TIMESTAMP WHERE case_id=? AND office_id=? AND deleted_at IS NULL")
      .bind(input.targetCaseId, input.caseId, context.officeId)]
    : [
      database.prepare("UPDATE vault_document SET deleted_at=CURRENT_TIMESTAMP, status='failed', error_message='Caso excluído.', updated_at=CURRENT_TIMESTAMP WHERE case_id=? AND office_id=? AND deleted_at IS NULL")
        .bind(input.caseId, context.officeId),
      // The subqueries still match after the tombstone above: it sets `deleted_at`, not `case_id`.
      database.prepare("UPDATE knowledge_index_job SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE office_id=? AND status IN ('queued','running') AND document_id IN (SELECT id FROM vault_document WHERE case_id=? AND office_id=?)")
        .bind(context.officeId, input.caseId, context.officeId),
      database.prepare('DELETE FROM vault_document_chunk WHERE office_id=? AND document_id IN (SELECT id FROM vault_document WHERE case_id=? AND office_id=?)')
        .bind(context.officeId, input.caseId, context.officeId),
    ];

  // A retry may arrive after the approval was consumed. These idempotent writes land together, so
  // it observes either the live case or the completed deletion, never a partially emptied case.
  await database.batch([
    ...documentWrites,
    database.prepare('UPDATE vault_folder SET deleted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE case_id=? AND office_id=? AND deleted_at IS NULL')
      .bind(input.caseId, context.officeId),
    database.prepare('UPDATE vault_case SET deleted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND deleted_at IS NULL')
      .bind(input.caseId, context.officeId),
  ]);

  // Same order as deleteDocument: the tombstone lands first and is what the interface and the
  // search obey. Bytes and vectors are chased afterwards, by a queue that can retry.
  for (const document of doomed) await enqueueDeletion(context.officeId, 'vector_document', document.id);
  for (const key of keys) await enqueueDeletion(context.officeId, 'object', key);
  return { success: true };
}

/** Every object key a case's live documents hold, current and historical, without duplicates. */
async function storedNamesForCase(officeId: string, caseId: string) {
  const rows = await database.prepare(`SELECT stored_name AS storedName FROM vault_document WHERE case_id=? AND office_id=? AND deleted_at IS NULL
    UNION SELECT v.stored_name FROM vault_document_version v JOIN vault_document d ON d.id = v.document_id AND d.office_id = v.office_id
    WHERE d.case_id=? AND d.office_id=? AND d.deleted_at IS NULL`).all(caseId, officeId, caseId, officeId) as Array<{ storedName: string }>;
  return [...new Set(rows.map((row) => row.storedName).filter(Boolean))];
}

export async function listDocuments(context: WorkspaceContext, input: CapabilityInput<'k5_vault_list_documents'>): Promise<CapabilityOutput<'k5_vault_list_documents'>> {
  const filters = { scope: input.scope ?? null, caseId: input.caseId ?? null, ...(input.folderId === undefined ? {} : { folderId: input.folderId }) };
  // Tombstones are excluded in SQL and the page is taken in SQL: no per-row liveness query, and
  // no loading the whole office to slice twenty rows off the front of it.
  const documents = await listVaultDocuments(context.officeId, { ...filters, limit: input.limit ?? 20 });
  return { documents, total: await countVaultDocuments(context.officeId, filters) };
}

export async function getDocument(context: WorkspaceContext, input: CapabilityInput<'k5_vault_get_document'>): Promise<CapabilityOutput<'k5_vault_get_document'>> {
  const doc = await requireDocument(context, input.documentId);
  return {
    document: {
      id: doc.id, name: doc.name, caseId: doc.caseId, caseName: doc.caseName, folderId: doc.folderId, scope: doc.scope,
      status: doc.status, progress: doc.progress, errorMessage: doc.errorMessage,
      sourceCount: doc.sourceCount, createdAt: doc.createdAt,
    },
  };
}

export async function updateDocument(context: WorkspaceContext, input: CapabilityInput<'k5_vault_update_document'>): Promise<CapabilityOutput<'k5_vault_update_document'>> {
  await requireDocument(context, input.documentId);

  if (input.name !== undefined) {
    await database.prepare('UPDATE vault_document SET original_name=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND deleted_at IS NULL')
      .run(input.name, input.documentId, context.officeId);
  }

  if (input.caseId !== undefined) {
    if (input.caseId === null) {
      // Out of every case means out of every folder of that case.
      await database.prepare("UPDATE vault_document SET case_id=NULL, folder_id=NULL, scope='library', updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND deleted_at IS NULL")
        .run(input.documentId, context.officeId);
    } else {
      const caseExists = await database.prepare('SELECT 1 FROM vault_case WHERE id=? AND office_id=? AND deleted_at IS NULL').get(input.caseId, context.officeId);
      if (!caseExists) throw new CapabilityError('NOT_FOUND', 'Caso não encontrado.');
      await database.prepare("UPDATE vault_document SET case_id=?, folder_id=NULL, scope='case', updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND deleted_at IS NULL")
        .run(input.caseId, input.documentId, context.officeId);
    }
  }

  if (input.folderId !== undefined) {
    const current = await requireDocument(context, input.documentId);
    if (input.folderId === null) {
      await database.prepare('UPDATE vault_document SET folder_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND deleted_at IS NULL')
        .run(input.documentId, context.officeId);
    } else {
      // The folder has to belong to the case this document is in, so a move cannot relocate it
      // into another case's tree while leaving case_id behind.
      const folder = await findVaultFolder(context.officeId, input.folderId);
      if (!folder || folder.caseId !== current.caseId) throw new CapabilityError('NOT_FOUND', 'Pasta não encontrada neste caso.');
      await database.prepare('UPDATE vault_document SET folder_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND deleted_at IS NULL')
        .run(input.folderId, input.documentId, context.officeId);
    }
  }

  return getDocument(context, { documentId: input.documentId });
}

export async function deleteDocument(context: WorkspaceContext, input: CapabilityInput<'k5_vault_delete_document'>): Promise<CapabilityOutput<'k5_vault_delete_document'>> {
  await requireDocument(context, input.documentId);

  await requireAndConsumeApproval(
    context,
    'k5_vault_delete_document',
    input.approvalId,
    { documentId: input.documentId },
    input.documentId,
    null,
    'Remoção de documento no Cofre exige aprovação explícita.',
  );

  const versions = await database.prepare('SELECT stored_name AS storedName FROM vault_document_version WHERE document_id=? AND office_id=?')
    .all(input.documentId, context.officeId) as Array<{ storedName: string }>;
  const current = await database.prepare('SELECT stored_name AS storedName FROM vault_document WHERE id=? AND office_id=?')
    .get(input.documentId, context.officeId) as { storedName: string } | undefined;

  // The tombstone and the loss of searchability land in one batch. Bytes in object storage and
  // rows in a remote index are chased afterwards through the deletion queue, which can retry
  // without ever making the document visible again.
  await database.batch([
    database.prepare("UPDATE vault_document SET deleted_at=CURRENT_TIMESTAMP, status='failed', error_message='Documento excluído.', updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=?")
      .bind(input.documentId, context.officeId),
    database.prepare("UPDATE knowledge_index_job SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE document_id=? AND office_id=? AND status IN ('queued','running')")
      .bind(input.documentId, context.officeId),
    database.prepare('DELETE FROM vault_document_chunk WHERE document_id=? AND office_id=?').bind(input.documentId, context.officeId),
  ]);

  await enqueueDeletion(context.officeId, 'vector_document', input.documentId);
  for (const key of new Set([...versions.map((row) => row.storedName), current?.storedName].filter(Boolean) as string[])) {
    await enqueueDeletion(context.officeId, 'object', key);
  }

  return { success: true };
}

/**
 * Adds an immutable version from an upload the server already stored. The previous version stays
 * addressable, so a citation made against it still resolves to the text it quoted.
 */
export async function addDocumentVersion(context: WorkspaceContext, input: CapabilityInput<'k5_vault_add_document_version'>): Promise<CapabilityOutput<'k5_vault_add_document_version'>> {
  const doc = await requireDocument(context, input.documentId);
  const upload = await consumeUploadRef(context, input.uploadRef);

  const currentMax = await database.prepare('SELECT max(version) AS maxVersion FROM vault_document_version WHERE document_id=?')
    .get(input.documentId) as { maxVersion: number | null } | undefined;
  const nextVersion = (currentMax?.maxVersion ?? 0) + 1;

  try {
    await database.batch([
      database.prepare('UPDATE vault_document_version SET is_active=0 WHERE document_id=? AND office_id=?').bind(doc.id, context.officeId),
      database.prepare(`
        INSERT INTO vault_document_version (id, office_id, document_id, version, original_name, stored_name, mime_type, byte_size, sha256, created_by, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).bind(randomUUID(), context.officeId, doc.id, nextVersion, upload.originalName, upload.storageKey, upload.mimeType, upload.byteSize, upload.sha256, context.userId),
      // The active version becomes the document's content, so it is re-extracted and re-indexed.
      database.prepare(`
        UPDATE vault_document SET original_name=?, stored_name=?, mime_type=?, byte_size=?, sha256=?,
          status='queued', progress=0, error_message=NULL, lease_owner=NULL, lease_expires_at=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND office_id=? AND deleted_at IS NULL
      `).bind(upload.originalName, upload.storageKey, upload.mimeType, upload.byteSize, upload.sha256, doc.id, context.officeId),
    ]);
  } catch (error) {
    // Same reasoning as ingestUpload: the batch is atomic, so a throw left nothing written and
    // the reference is unspent.
    await releaseUploadRef(context, input.uploadRef);
    throw error;
  }

  return { document: (await getDocument(context, { documentId: input.documentId })).document, version: nextVersion };
}

export async function downloadDocument(context: WorkspaceContext, input: CapabilityInput<'k5_vault_download_document'>): Promise<CapabilityOutput<'k5_vault_download_document'>> {
  const doc = await requireDocument(context, input.documentId);
  return {
    downloadUrl: `/api/vault/documents/${encodeURIComponent(doc.id)}/download`,
    name: doc.name,
    mimeType: doc.mimeType,
  };
}

export async function retryIngestion(context: WorkspaceContext, input: CapabilityInput<'k5_vault_retry_ingestion'>): Promise<CapabilityOutput<'k5_vault_retry_ingestion'>> {
  await requireDocument(context, input.documentId);
  try { await retryVaultDocument(context.officeId, input.documentId); }
  catch (error) { throw asCapabilityError(error); }
  return getDocument(context, { documentId: input.documentId });
}

/**
 * Turns a server-issued upload reference into a Vault document. The reference is single-use and
 * bound to this person and office; the storage key travels with it and is never taken from input.
 */
export async function ingestUpload(context: WorkspaceContext, input: CapabilityInput<'k5_vault_ingest_upload'>): Promise<CapabilityOutput<'k5_vault_ingest_upload'>> {
  if (input.scope === 'case' && !input.caseId) throw new CapabilityError('INVALID', 'Escolha um caso para o documento.');
  const upload = await consumeUploadRef(context, input.uploadRef);
  try {
    const document = await createVaultDocument(context.officeId, context.userId, upload, { scope: input.scope, caseId: input.caseId ?? null, folderId: input.folderId ?? null });
    return getDocument(context, { documentId: document.id });
  } catch (error) {
    // createVaultDocument writes in one batch, so a throw means no document and no version exist.
    // Handing the reference back is what keeps a rejected destination from costing the upload.
    await releaseUploadRef(context, input.uploadRef);
    throw asCapabilityError(error);
  }
}

export async function searchKnowledge(context: WorkspaceContext, input: CapabilityInput<'k5_knowledge_search'>): Promise<CapabilityOutput<'k5_knowledge_search'>> {
  return searchKnowledgeEngine(context, input);
}

/** Documents of this office that are ready for analysis, used to validate a run before queueing it. */
export async function readyDocumentIds(context: WorkspaceContext, documentIds: string[]) {
  if (!documentIds.length) return [];
  const marks = documentIds.map(() => '?').join(',');
  return (await database.prepare(`SELECT id FROM vault_document WHERE office_id=? AND status='ready' AND deleted_at IS NULL AND id IN (${marks})`)
    .all(context.officeId, ...documentIds) as Array<{ id: string }>).map((row) => String(row.id));
}

/** The cleanup worker is the only caller that may look at a tombstoned row. */
export function findDeletedDocument(officeId: string, documentId: string) {
  return findVaultDocumentIncludingDeleted(officeId, documentId);
}
