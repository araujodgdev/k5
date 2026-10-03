import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { ownedChatAttachment } from '@/lib/chat-attachments';
import { objectStorage, storageKey } from '@/lib/storage';
import {
  assertVaultDocumentMove, countVaultDocuments, createVaultDocument, createVaultCase, createVaultFolder, deleteVaultFolder, findVaultCase,
  findVaultDocument, findVaultDocumentIncludingDeleted, findVaultFolder, listVaultCases, listVaultDocuments,
  listVaultFolders, retryVaultDocument, updateVaultCase, updateVaultFolderAccess, vaultFolderPath, VaultHttpError, type VaultOriginKind,
} from '@/lib/vault';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';
import type { WorkspaceContext } from './context';
import { requireAgentApproval, requireAndConsumeApproval } from './approvals-service';
import { consumeUploadRef, releaseUploadRef, validatedFileName } from './uploads-service';
import { ownedArtifact } from '@/lib/ai-store';
import { artifactVaultFile, DOCX_FILE_MIME, PDF_MIME } from '@/lib/artifact-file';
import { DocumentPdfError } from '@/lib/document-pdf-contract';
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

/** `findVaultDocument` already excludes tombstones and hidden folders, so one lookup settles office, liveness and access. */
async function requireDocument(context: WorkspaceContext, documentId: string) {
  const document = await findVaultDocument(context.officeId, documentId, context.userId);
  if (!document || (context.caseScope && document.caseId !== context.caseScope.caseId)) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado no Cofre deste escritório.');
  return document;
}

export async function listCases(context: WorkspaceContext): Promise<CapabilityOutput<'k5_vault_list_cases'>> {
  const cases = await listVaultCases(context.officeId, context.userId);
  const shared = await database.prepare(`SELECT c.id,c.office_id FROM case_participant p JOIN vault_case c ON c.id=p.case_id AND c.office_id=p.office_id
    WHERE p.user_id=? AND p.revoked_at IS NULL AND c.deleted_at IS NULL AND c.office_id<>? ORDER BY c.updated_at DESC`).all<{ id: string; office_id: string }>(context.userId, context.officeId);
  for (const item of shared) { const record = await findVaultCase(item.office_id, item.id, context.userId); if (record) cases.push(record); }
  return { cases };
}

export async function createCase(context: WorkspaceContext, input: CapabilityInput<'k5_vault_create_case'>): Promise<CapabilityOutput<'k5_vault_create_case'>> {
  // Idempotent by natural key: a retried tool call must not leave two identical cases behind.
  const existing = (await listVaultCases(context.officeId, context.userId)).find((item) => item.name.toLowerCase() === input.name.toLowerCase());
  if (existing) return { case: existing, created: false };
  try {
    return { case: await createVaultCase(context.officeId, context.userId, input.name, { description: input.description, client: input.client }), created: true };
  } catch (error) { throw asCapabilityError(error); }
}

export async function updateCase(context: WorkspaceContext, input: CapabilityInput<'k5_vault_update_case'>): Promise<CapabilityOutput<'k5_vault_update_case'>> {
  if (!await findVaultCase(context.officeId, input.caseId, context.userId)) throw new CapabilityError('NOT_FOUND', 'Caso não encontrado.');
  try {
    return { case: await updateVaultCase(context.officeId, input.caseId, context.userId, { name: input.name, description: input.description, client: input.client }) };
  } catch (error) { throw asCapabilityError(error); }
}

export async function listFolders(context: WorkspaceContext, input: CapabilityInput<'k5_vault_list_folders'>): Promise<CapabilityOutput<'k5_vault_list_folders'>> {
  if (!await findVaultCase(context.officeId, input.caseId, context.userId)) throw new CapabilityError('NOT_FOUND', 'Caso não encontrado.');
  const parentId = input.parentId ?? null;
  if (parentId) {
    const parent = await findVaultFolder(context.officeId, parentId, context.userId);
    if (!parent || parent.caseId !== input.caseId) throw new CapabilityError('NOT_FOUND', 'Pasta não encontrada.');
  }
  return {
    folders: await listVaultFolders(context.officeId, context.userId, input.caseId, parentId),
    path: parentId ? await vaultFolderPath(context.officeId, parentId, context.userId) : [],
  };
}

export async function createFolder(context: WorkspaceContext, input: CapabilityInput<'k5_vault_create_folder'>): Promise<CapabilityOutput<'k5_vault_create_folder'>> {
  try {
    return { folder: await createVaultFolder(context.officeId, context.userId, input.caseId, input.name, input.parentId ?? null,
      { visibility: input.visibility ?? 'public', memberIds: input.memberIds }) };
  } catch (error) { throw asCapabilityError(error); }
}

export async function updateFolderAccess(context: WorkspaceContext, input: CapabilityInput<'k5_vault_update_folder_access'>): Promise<CapabilityOutput<'k5_vault_update_folder_access'>> {
  try {
    return { folder: await updateVaultFolderAccess(context.officeId, input.folderId, context.userId, { visibility: input.visibility, memberIds: input.memberIds }) };
  } catch (error) { throw asCapabilityError(error); }
}

export async function deleteFolder(context: WorkspaceContext, input: CapabilityInput<'k5_vault_delete_folder'>): Promise<CapabilityOutput<'k5_vault_delete_folder'>> {
  if (!await findVaultFolder(context.officeId, input.folderId, context.userId)) throw new CapabilityError('NOT_FOUND', 'Pasta não encontrada.');
  await requireAgentApproval(context, 'k5_vault_delete_folder', input.approvalId, { folderId: input.folderId }, input.folderId, 'Remover uma pasta pede confirmação.');
  try { await deleteVaultFolder(context.officeId, input.folderId, context.userId); }
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
    if (input.targetCaseId === input.caseId) throw new CapabilityError('INVALID', 'Escolha outro caso como destino.');
    const target = await database.prepare('SELECT id FROM vault_case WHERE id=? AND office_id=? AND deleted_at IS NULL')
      .get(input.targetCaseId, context.officeId);
    if (!target) throw new CapabilityError('NOT_FOUND', 'Caso de destino não encontrado.');
    if (await database.prepare("SELECT 1 FROM vault_folder WHERE case_id=? AND office_id=? AND deleted_at IS NULL AND visibility<>'public'").get(input.caseId, context.officeId))
      throw new CapabilityError('CONFLICT', 'Este caso contém pastas com acesso reservado. Preserve ou remova essas pastas antes de mover o conteúdo para outro caso.');
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
  if (context.caseScope) input = { ...input, caseId: context.caseScope.caseId, scope: 'case' };
  const filters = { scope: input.scope ?? null, caseId: input.caseId ?? null, ...(input.folderId === undefined ? {} : { folderId: input.folderId }) };
  // Tombstones are excluded in SQL and the page is taken in SQL: no per-row liveness query, and
  // no loading the whole office to slice twenty rows off the front of it.
  const documents = await listVaultDocuments(context.officeId, context.userId, { ...filters, limit: input.limit ?? 20, offset: input.offset ?? 0 });
  return { documents, total: await countVaultDocuments(context.officeId, context.userId, filters) };
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
  const current = await requireDocument(context, input.documentId);
  const caseId = input.caseId === undefined ? current.caseId : input.caseId;
  const folderId = input.folderId === undefined ? (input.caseId === undefined ? current.folderId : null) : input.folderId;
  if (caseId && !await database.prepare('SELECT 1 FROM vault_case WHERE id=? AND office_id=? AND deleted_at IS NULL').get(caseId, context.officeId))
    throw new CapabilityError('NOT_FOUND', 'Caso não encontrado.');
  if (folderId) {
    const folder = await findVaultFolder(context.officeId, folderId, context.userId);
    if (!folder || folder.caseId !== caseId) throw new CapabilityError('NOT_FOUND', 'Pasta não encontrada neste caso.');
  }
  try { await assertVaultDocumentMove(context.officeId, context.userId, current.folderId, folderId); }
  catch (error) { throw asCapabilityError(error); }
  const changes: string[] = [];
  const values: (string | null)[] = [];
  if (input.name !== undefined) { changes.push('original_name=?'); values.push(input.name); }
  if (input.caseId !== undefined) {
    changes.push('case_id=?', 'scope=?'); values.push(caseId, caseId ? 'case' : 'library');
  }
  if (input.caseId !== undefined || input.folderId !== undefined) { changes.push('folder_id=?'); values.push(folderId); }
  if (changes.length) await database.prepare(`UPDATE vault_document SET ${changes.join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND deleted_at IS NULL`)
    .run(...values, input.documentId, context.officeId);
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
  const uploadContext = context.caseScope ? { ...context, officeId: context.caseScope.homeOfficeId } : context;
  const upload = await consumeUploadRef(uploadContext, input.uploadRef);

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
    await releaseUploadRef(uploadContext, input.uploadRef);
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
  const uploadContext = context.caseScope ? { ...context, officeId: context.caseScope.homeOfficeId } : context;
  const upload = await consumeUploadRef(uploadContext, input.uploadRef);
  try {
    const document = await createVaultDocument(context.officeId, context.userId, upload, { scope: input.scope, caseId: input.caseId ?? null, folderId: input.folderId ?? null });
    return getDocument(context, { documentId: document.id });
  } catch (error) {
    // createVaultDocument writes in one batch, so a throw means no document and no version exist.
    // Handing the reference back is what keeps a rejected destination from costing the upload.
    await releaseUploadRef(uploadContext, input.uploadRef);
    throw asCapabilityError(error);
  }
}

type VaultDestination = { scope: 'library' | 'case'; caseId?: string; folderId?: string | null };

/** The destination is checked against the person's access; a folder only exists inside its case. */
async function requireDestination(context: WorkspaceContext, input: VaultDestination) {
  if (input.scope === 'case' && (!input.caseId || !await findVaultCase(context.officeId, input.caseId, context.userId)))
    throw new CapabilityError('NOT_FOUND', 'Escolha um caso disponível para o documento.');
  if (input.scope === 'library' && (input.caseId || input.folderId)) throw new CapabilityError('INVALID', 'Uma pasta de caso não pertence à Biblioteca.');
  if (input.folderId) {
    const folder = await findVaultFolder(context.officeId, input.folderId, context.userId);
    if (!folder || folder.caseId !== input.caseId) throw new CapabilityError('NOT_FOUND', 'Pasta indisponível neste caso.');
  }
}

/**
 * Copies a file the chat holds into the Vault under its own storage key. The document id derives
 * from the source and the destination, so a repeated request returns the same copy.
 */
async function copyIntoVault(context: WorkspaceContext, input: VaultDestination, source: {
  identity: unknown[]; origin: { kind: VaultOriginKind; id: string; version?: number };
  name: string; mimeType: string; extension: string; bytes: () => Promise<Uint8Array>;
}) {
  await requireDestination(context, input);
  const identity = JSON.stringify([...source.identity, context.officeId, input.scope, input.caseId ?? null, input.folderId ?? null]);
  const digest = createHash('sha256').update(identity).digest('hex');
  const documentId = `${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
  const reuse = async (existing: NonNullable<Awaited<ReturnType<typeof findVaultDocumentIncludingDeleted>>>) => {
    if (existing.deletedAt) throw new CapabilityError('CONFLICT', 'A cópia anterior foi excluída do Cofre. Envie o arquivo novamente para criar outra cópia.');
    if (existing.scope !== input.scope || existing.caseId !== (input.caseId ?? null) || existing.folderId !== (input.folderId ?? null))
      throw new CapabilityError('CONFLICT', 'A cópia anterior foi movida. Abra o documento para ajustar o destino.');
    return getDocument(context, { documentId });
  };
  const existing = await findVaultDocumentIncludingDeleted(context.officeId, documentId);
  if (existing) return reuse(existing);
  const bytes = Buffer.from(await source.bytes());
  const storage = await objectStorage();
  const key = storageKey(context.officeId, randomUUID(), source.extension);
  await storage.put(key, bytes);
  try {
    await createVaultDocument(context.officeId, context.userId, {
      id: documentId, storageKey: key, originalName: source.name, mimeType: source.mimeType,
      byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    }, { ...input, documentId, origin: source.origin });
  } catch (error) {
    // The deterministic primary key serializes competing inserts. A retry also reconciles a
    // committed batch whose response was lost, without deleting that batch's stored original.
    const committed = await findVaultDocumentIncludingDeleted(context.officeId, documentId);
    if (committed?.storedName !== key) await storage.delete(key).catch(() => undefined);
    if (committed) return reuse(committed);
    throw asCapabilityError(error);
  }
  return getDocument(context, { documentId });
}

export async function importChatAttachment(context: WorkspaceContext, input: CapabilityInput<'k5_vault_import_chat_attachment'>): Promise<CapabilityOutput<'k5_vault_import_chat_attachment'>> {
  const sourceOffice = context.caseScope?.homeOfficeId ?? context.officeId;
  const attachment = await ownedChatAttachment({ officeId: sourceOffice, userId: context.userId }, input.attachmentId);
  if (!context.conversationId || !attachment || attachment.conversation_id !== context.conversationId || !attachment.message_id)
    throw new CapabilityError('NOT_FOUND', 'Anexo indisponível nesta conversa.');
  return copyIntoVault(context, input, {
    identity: [sourceOffice, context.userId, attachment.id], origin: { kind: 'chat_attachment', id: attachment.id },
    name: attachment.name, mimeType: attachment.media_type, extension: extname(attachment.name).toLowerCase(),
    bytes: async () => (await objectStorage()).get(attachment.storage_key),
  });
}

/**
 * Saves the current version of a Lume document to the Vault as PDF or DOCX. Each version, format
 * and destination is one copy; a later version becomes a new document, never a silent overwrite.
 */
export async function saveArtifactToVault(context: WorkspaceContext, input: CapabilityInput<'k5_vault_save_artifact'>): Promise<CapabilityOutput<'k5_vault_save_artifact'>> {
  const owner = { officeId: context.caseScope?.homeOfficeId ?? context.officeId, userId: context.userId };
  const artifact = await ownedArtifact(database, owner, input.artifactId);
  if (!artifact) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');
  if (artifact.version !== input.version) throw new CapabilityError('CONFLICT', 'O documento mudou. Leia a versão atual antes de salvar no Cofre.');
  const format = input.format ?? 'pdf';
  // A slash in a title is text, not a path: validatedFileName keeps only the last path segment.
  const file = validatedFileName(`${artifact.title.replace(/[\\/]/g, '_').trim() || 'Documento'}.${format}`).file;
  const name = file.length > 200 ? `${file.slice(0, 195)}.${format}` : file;
  return copyIntoVault(context, input, {
    identity: [owner.officeId, context.userId, 'artifact', artifact.id, artifact.version, format],
    origin: { kind: format === 'pdf' ? 'artifact_pdf' : 'artifact_docx', id: artifact.id, version: artifact.version },
    name, mimeType: format === 'pdf' ? PDF_MIME : DOCX_FILE_MIME, extension: `.${format}`,
    bytes: async () => {
      try { return (await artifactVaultFile(owner, artifact, format)).bytes; }
      catch (error) { throw error instanceof DocumentPdfError ? new CapabilityError('NOT_READY', error.message) : error; }
    },
  });
}

export async function searchKnowledge(context: WorkspaceContext, input: CapabilityInput<'k5_knowledge_search'>): Promise<CapabilityOutput<'k5_knowledge_search'>> {
  return searchKnowledgeEngine(context, input);
}

/** Documents of this office that are ready for analysis, used to validate a run before queueing it. */
export async function readyDocumentIds(context: WorkspaceContext, documentIds: string[]) {
  if (!documentIds.length) return [];
  const marks = documentIds.map(() => '?').join(',');
  return (await database.prepare(`SELECT id FROM vault_document WHERE office_id=? AND status='ready' AND deleted_at IS NULL AND vault_folder_visible(folder_id, ?) AND id IN (${marks})`)
    .all(context.officeId, context.userId, ...documentIds) as Array<{ id: string }>).map((row) => String(row.id));
}

/** The cleanup worker is the only caller that may look at a tombstoned row. */
export function findDeletedDocument(officeId: string, documentId: string) {
  return findVaultDocumentIncludingDeleted(officeId, documentId);
}
