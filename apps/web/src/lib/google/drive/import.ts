import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { database, withTransaction, type Database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityInput as Input } from '@/lib/capabilities/contracts';
import type { WorkspaceContext } from '@/lib/application/context';
import { objectStorage, storageKey } from '@/lib/storage';
import { validatedFileName } from '@/lib/application/uploads-service';
import { requireConnection, googleJson, googleRequest } from '../connections';
import type { GoogleJob } from '../jobs';
import { findVaultCase, findVaultFolder } from '@/lib/vault';
import { GoogleApiError } from '../transport';
import { fetchMetadata, ownFile, type FileRow } from './service';
import { importFormatFor, importFileName, MAX_IMPORT_BYTES, GOOGLE_EXPORT_LIMIT_BYTES } from './formats';

type ImportRow = {
  id: string; office_id: string; user_id: string; source_kind: 'drive' | 'gmail_attachment'; drive_file_id: string | null;
  source_account_email: string; google_file_id: string | null; gmail_message_id: string | null; gmail_attachment_part: string | null;
  source_name: string; source_mime_type: string; source_version: string | null; source_modified_time: string | null;
  export_mime_type: string | null; scope: 'case' | 'library'; case_id: string | null; folder_id: string | null; vault_document_id: string | null; vault_version: number | null;
  sha256: string | null; byte_size: number | null; status: 'queued' | 'running' | 'completed' | 'failed';
  error_message: string | null; job_id: string | null; idempotency_key: string; created_at: string; completed_at: string | null;
};
const dto = (r: ImportRow) => ({ id: r.id, fileName: r.source_name, sourceKind: r.source_kind, sourceAccount: r.source_account_email,
  caseId: r.case_id, scope: r.scope, vaultDocumentId: r.vault_document_id, vaultVersion: r.vault_version, sourceVersion: r.source_version,
  sha256: r.sha256, status: r.status, errorMessage: r.error_message, createdAt: r.created_at, completedAt: r.completed_at });
async function destination(c: WorkspaceContext, scope: 'case' | 'library', caseId: string | null, folderId: string | null) {
  if (scope === 'library') {
    if (caseId || folderId) throw new CapabilityError('INVALID', 'A Biblioteca não aceita caso ou pasta como destino.');
    return;
  }
  if (!caseId) throw new CapabilityError('INVALID', 'Escolha um caso para a importação.');
  if (!await findVaultCase(c.officeId, caseId)) throw new CapabilityError('NOT_FOUND', 'Caso não encontrado no Cofre deste escritório.');
  if (folderId) {
    const folder = await findVaultFolder(c.officeId, folderId);
    if (!folder || folder.caseId !== caseId) throw new CapabilityError('NOT_FOUND', 'Pasta não encontrada neste caso.');
  }
}
async function queue(c: WorkspaceContext, input: {
  sourceKind: 'drive' | 'gmail_attachment'; connectionId: string; email: string; driveFileId?: string | null;
  googleFileId?: string | null; messageId?: string | null; partId?: string | null; name: string; mimeType: string;
  version?: string | null; modifiedTime?: string | null; exportMimeType?: string | null;
  scope: 'case' | 'library'; caseId: string | null; folderId?: string | null; idempotencyKey?: string;
}) {
  const folderId = input.folderId ?? null;
  await destination(c, input.scope, input.caseId, folderId);
  const key = input.idempotencyKey ?? randomUUID();
  const sameRequest = (row: ImportRow) => row.source_kind === input.sourceKind && row.scope === input.scope &&
    row.case_id === input.caseId && row.folder_id === folderId && row.drive_file_id === (input.driveFileId ?? null) &&
    row.gmail_message_id === (input.messageId ?? null) && row.gmail_attachment_part === (input.partId ?? null);
  const existing = await database.prepare('SELECT * FROM google_drive_import WHERE office_id=? AND user_id=? AND idempotency_key=?')
    .get<ImportRow>(c.officeId, c.userId, key);
  if (existing) {
    if (!sameRequest(existing)) throw new CapabilityError('CONFLICT', 'Esta chave de idempotência já foi usada para outra importação.');
    return dto(existing);
  }
  const id = randomUUID();
  const jobId = randomUUID();
  const row = await withTransaction(async tx => {
    const inserted = await tx.prepare(`INSERT INTO google_drive_import
      (id,office_id,user_id,source_kind,drive_file_id,source_account_email,google_file_id,gmail_message_id,gmail_attachment_part,
       source_name,source_mime_type,source_version,source_modified_time,export_mime_type,scope,case_id,folder_id,status,job_id,idempotency_key)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'queued',?,?) ON CONFLICT(office_id,user_id,idempotency_key) DO NOTHING RETURNING *`)
      .get<ImportRow>(id, c.officeId, c.userId, input.sourceKind, input.driveFileId ?? null, input.email, input.googleFileId ?? null,
        input.messageId ?? null, input.partId ?? null, input.name, input.mimeType, input.version ?? null, input.modifiedTime ?? null,
        input.exportMimeType ?? null, input.scope, input.caseId, folderId, jobId, key);
    if (!inserted) {
      const concurrent = await tx.prepare('SELECT * FROM google_drive_import WHERE office_id=? AND user_id=? AND idempotency_key=?')
        .get<ImportRow>(c.officeId, c.userId, key);
      if (!concurrent || !sameRequest(concurrent)) throw new CapabilityError('CONFLICT', 'Esta chave de idempotência já foi usada para outra importação.');
      return concurrent;
    }
    await tx.prepare(`INSERT INTO google_job(id,office_id,user_id,connection_id,kind,runtime,subject_id,dedupe_key,status,run_after)
      VALUES(?,?,?,?,'drive_import','node',?,?,'queued',CURRENT_TIMESTAMP)`)
      .run(jobId, c.officeId, c.userId, input.connectionId, id, `drive-import:${id}`);
    return inserted;
  });
  return dto(row);
}
export async function queueDriveImport(c: WorkspaceContext, i: Input<'k5_drive_import_file'>) {
  if (c.role === 'reviewer') throw new CapabilityError('FORBIDDEN', 'Seu papel permite apenas consultas.');
  const connection = await requireConnection(c, 'drive');
  const file = await ownFile(c, i.fileId, connection);
  const meta = await fetchMetadata(connection, file.google_file_id);
  if (!meta.capabilities?.canDownload) throw new CapabilityError('FORBIDDEN', 'A conta Google não pode baixar este arquivo.');
  const format = importFormatFor(meta.mimeType);
  if (!format) throw new CapabilityError('INVALID', 'Este formato ainda não pode ser copiado para o Cofre.');
  if (meta.size && Number(meta.size) > MAX_IMPORT_BYTES) throw new CapabilityError('INVALID', 'O arquivo excede o limite de 50 MB do Cofre.');
  return queue(c, { sourceKind: 'drive', connectionId: connection.id, email: connection.email, driveFileId: file.id,
    googleFileId: meta.id, name: importFileName(meta.name, format), mimeType: meta.mimeType, version: meta.version ?? null,
    modifiedTime: meta.modifiedTime ?? null, exportMimeType: format.exportMimeType, scope: i.scope ?? 'case', caseId: i.caseId ?? null,
    folderId: i.folderId, idempotencyKey: i.idempotencyKey });
}
/** Gmail passes metadata verified against the actual message part, not user-supplied labels. */
export async function queueGmailAttachmentImport(c: WorkspaceContext, i: {
  messageId: string; partId: string; caseId: string; folderId?: string | null; idempotencyKey?: string;
  sourceName: string; sourceMimeType: string; sourceVersion?: string | null;
}) {
  if (c.role === 'reviewer') throw new CapabilityError('FORBIDDEN', 'Seu papel permite apenas consultas.');
  const connection = await requireConnection(c, 'gmail');
  const format = importFormatFor(i.sourceMimeType);
  if (!format) throw new CapabilityError('INVALID', 'Este formato de anexo não pode ser copiado para o Cofre.');
  return { import: await queue(c, { sourceKind: 'gmail_attachment', connectionId: connection.id, email: connection.email,
    messageId: i.messageId, partId: i.partId, name: importFileName(i.sourceName, format), mimeType: i.sourceMimeType,
    version: i.sourceVersion ?? null, scope: 'case', caseId: i.caseId, folderId: i.folderId, idempotencyKey: i.idempotencyKey }) };
}
export async function listOwnImports(c: WorkspaceContext, i: Input<'k5_drive_list_imports'>) {
  await requireConnection(c, 'drive');
  const rows = await database.prepare(`SELECT * FROM google_drive_import WHERE office_id=? AND user_id=? AND source_kind='drive'
    ${i.scope ? 'AND scope=?' : ''} ${i.caseId ? 'AND case_id=?' : ''}
    ${i.folderId !== undefined ? 'AND folder_id IS NOT DISTINCT FROM ?' : ''} ORDER BY created_at DESC LIMIT ?`)
    .all<ImportRow>(c.officeId, c.userId, ...(i.scope ? [i.scope] : []), ...(i.caseId ? [i.caseId] : []),
      ...(i.folderId !== undefined ? [i.folderId] : []), i.limit);
  return rows.map(dto);
}
function fileBytes(bytes: Uint8Array, limit: number) {
  if (bytes.byteLength > limit) throw new CapabilityError('INVALID', limit === GOOGLE_EXPORT_LIMIT_BYTES
    ? 'A exportação excede o limite de 10 MB do Google.' : 'O arquivo excede o limite de 50 MB do Cofre.');
  if (!bytes.byteLength) throw new CapabilityError('INVALID', 'O arquivo está vazio.');
  return Buffer.from(bytes);
}
async function driveBytes(job: GoogleJob, row: ImportRow, file: FileRow) {
  const connection = { id: job.connection_id } as Parameters<typeof fetchMetadata>[0];
  const meta = await fetchMetadata(connection, file.google_file_id);
  const sameTime = (a?: string | null, b?: string | null) => !a && !b || !!a && !!b && Date.parse(a) === Date.parse(b);
  if (meta.version !== row.source_version || !sameTime(meta.modifiedTime, row.source_modified_time))
    throw new CapabilityError('CONFLICT', 'O arquivo mudou no Google depois da seleção. Importe novamente.');
  if (!meta.capabilities?.canDownload) throw new CapabilityError('FORBIDDEN', 'A conta Google perdeu a permissão de baixar este arquivo.');
  const format = importFormatFor(meta.mimeType);
  if (!format || format.exportMimeType !== row.export_mime_type) throw new CapabilityError('CONFLICT', 'O formato do arquivo mudou.');
  const limit = format.exportMimeType ? GOOGLE_EXPORT_LIMIT_BYTES : MAX_IMPORT_BYTES;
  if (meta.size && Number(meta.size) > MAX_IMPORT_BYTES) throw new CapabilityError('INVALID', 'O arquivo excede 50 MB.');
  let response;
  try {
    response = await googleRequest(connection, { service: 'drive', path: format.exportMimeType
      ? `/files/${encodeURIComponent(file.google_file_id)}/export` : `/files/${encodeURIComponent(file.google_file_id)}`,
      query: format.exportMimeType ? { mimeType: format.exportMimeType } : { alt: 'media', supportsAllDrives: true },
      maxBytes: limit, timeoutMs: 120_000 });
  } catch (e) {
    if (e instanceof GoogleApiError && (e.reason === 'exportSizeLimitExceeded' || e.status === 413))
      throw new CapabilityError('INVALID', 'A exportação excede o limite de 10 MB do Google.');
    throw e;
  }
  const after = await fetchMetadata(connection, file.google_file_id);
  if (after.version !== row.source_version || !sameTime(after.modifiedTime, row.source_modified_time))
    throw new CapabilityError('CONFLICT', 'O arquivo mudou durante a importação. Importe novamente.');
  return fileBytes(response.body, limit);
}
async function gmailBytes(job: GoogleJob, row: ImportRow) {
  if (!row.gmail_message_id || !row.gmail_attachment_part) throw new CapabilityError('INVALID', 'Anexo sem referência.');
  const conn = { id: job.connection_id };
  const message = await googleJson<{ payload?: { partId?: string; filename?: string; mimeType?: string; body?: { attachmentId?: string; size?: number }; parts?: unknown[] } }>(conn,
    { service: 'gmail', path: `/users/me/messages/${encodeURIComponent(row.gmail_message_id)}`, query: { format: 'full' }, maxBytes: 4_000_000 });
  type Part = { partId?: string; filename?: string; mimeType?: string; body?: { attachmentId?: string; size?: number }; parts?: Part[] };
  const walk = (p?: Part): Part | undefined => p?.partId === row.gmail_attachment_part ? p : p?.parts?.map(walk).find(Boolean);
  const part = walk(message.payload as Part);
  if (!part?.body?.attachmentId || part.mimeType !== row.source_mime_type || importFileName(part.filename ?? '', importFormatFor(row.source_mime_type)!) !== row.source_name)
    throw new CapabilityError('CONFLICT', 'O anexo do e-mail mudou ou não existe.');
  if (part.body.size && part.body.size > MAX_IMPORT_BYTES) throw new CapabilityError('INVALID', 'O anexo excede 50 MB.');
  const data = await googleJson<{ data?: string; size?: number }>(conn,
    { service: 'gmail', path: `/users/me/messages/${encodeURIComponent(row.gmail_message_id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`,
      maxBytes: Math.ceil(MAX_IMPORT_BYTES * 4 / 3) + 4096, timeoutMs: 120_000 });
  if (!data.data || (data.size && data.size > MAX_IMPORT_BYTES)) throw new CapabilityError('INVALID', 'O anexo está vazio ou excede 50 MB.');
  return fileBytes(Buffer.from(data.data, 'base64url'), MAX_IMPORT_BYTES);
}
/** The import row and Vault version commit atomically. Retried jobs see completed before downloading again. */
export async function processDriveImport(job: GoogleJob, db: Database = database): Promise<void> {
  if (!job.subject_id) throw new CapabilityError('INVALID', 'Importação sem referência.');
  const row = await db.prepare('SELECT * FROM google_drive_import WHERE id=? AND office_id=? AND user_id=? AND job_id=?')
    .get<ImportRow>(job.subject_id, job.office_id, job.user_id, job.id);
  if (!row || row.status === 'completed') return;
  if (row.status === 'failed') return;
  const lease = await db.prepare(`UPDATE google_drive_import SET status='running' WHERE id=? AND status IN ('queued','running')
    AND EXISTS(SELECT 1 FROM google_job WHERE id=? AND lease_token=? AND status='running')
    RETURNING id`).get<{ id: string }>(row.id, job.id, job.lease_token);
  if (!lease) throw new CapabilityError('CONFLICT', 'A importação já está em execução.');
  try {
    const c: WorkspaceContext = { officeId: row.office_id, userId: row.user_id, role: 'lawyer' };
    await destination(c, row.scope, row.case_id, row.folder_id);
    const connection = await requireConnection(c, row.source_kind === 'drive' ? 'drive' : 'gmail', db);
    if (connection.id !== job.connection_id) throw new CapabilityError('FORBIDDEN', 'A conexão Google mudou.');
    const file = row.source_kind === 'drive'
      ? await db.prepare('SELECT * FROM google_drive_file WHERE id=? AND office_id=? AND user_id=? AND connection_id=?')
        .get<FileRow>(row.drive_file_id, row.office_id, row.user_id, connection.id) : null;
    if (row.source_kind === 'drive' && !file) throw new CapabilityError('NOT_FOUND', 'Arquivo selecionado não encontrado.');
    const bytes = file ? await driveBytes(job, row, file) : await gmailBytes(job, row);
    const format = importFormatFor(row.source_mime_type)!;
    const name = validatedFileName(row.source_name).file;
    const hash = createHash('sha256').update(bytes).digest('hex');
    const key = storageKey(row.office_id, row.id, format.extension);
    const storage = await objectStorage();
    await storage.put(key, bytes);
    let committed = false;
    try {
      await withTransaction(async tx => {
        // Serialize imports of the same source into the same case before choosing its Vault
        // document. The object key is tied to the import id, so a concurrent first import
        // cannot force us to choose a document id before this lock.
        const sourceLock = [row.office_id, row.user_id, row.source_kind, row.scope, row.case_id ?? '', row.folder_id ?? '',
          row.google_file_id ?? '', row.gmail_message_id ?? '', row.gmail_attachment_part ?? ''].join(':');
        await tx.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(sourceLock);
        const locked = await tx.prepare('SELECT * FROM google_drive_import WHERE id=? FOR UPDATE').get<ImportRow>(row.id);
        if (!locked || locked.status === 'completed') return;
        const activeJob = await tx.prepare("SELECT 1 FROM google_job WHERE id=? AND lease_token=? AND status='running' AND lease_until>CURRENT_TIMESTAMP")
          .get(job.id, job.lease_token);
        if (!activeJob) throw new Error('A licença da fila expirou; outra execução assumiu.');
        const currentConnection = await requireConnection(c, row.source_kind === 'drive' ? 'drive' : 'gmail', tx);
        if (!await tx.prepare("SELECT 1 FROM office_member WHERE office_id=? AND user_id=? AND role IN ('administrator','lawyer')").get(row.office_id,row.user_id))
          throw new CapabilityError('FORBIDDEN', 'Seu acesso de escrita ao Cofre foi removido.');
        if (currentConnection.id !== job.connection_id) throw new CapabilityError('FORBIDDEN', 'A conexão Google mudou durante a importação.');
        if (row.source_kind === 'drive' && !await tx.prepare('SELECT 1 FROM google_drive_file WHERE id=? AND office_id=? AND user_id=? AND connection_id=?')
          .get(row.drive_file_id, row.office_id, row.user_id, currentConnection.id))
          throw new CapabilityError('NOT_FOUND', 'O arquivo escolhido foi removido da seleção.');
        if (row.scope === 'case' && !await tx.prepare('SELECT 1 FROM vault_case WHERE office_id=? AND id=? AND deleted_at IS NULL').get(row.office_id, row.case_id))
          throw new CapabilityError('NOT_FOUND', 'O caso foi removido.');
        if (row.folder_id && !await tx.prepare('SELECT 1 FROM vault_folder WHERE office_id=? AND case_id=? AND id=? AND deleted_at IS NULL')
          .get(row.office_id, row.case_id, row.folder_id)) throw new CapabilityError('NOT_FOUND', 'A pasta foi removida.');
        const prior = await tx.prepare(`SELECT i.vault_document_id FROM google_drive_import i
          JOIN vault_document d ON d.id=i.vault_document_id AND d.office_id=i.office_id AND d.deleted_at IS NULL
            AND d.scope=i.scope AND d.case_id IS NOT DISTINCT FROM i.case_id
            AND d.folder_id IS NOT DISTINCT FROM i.folder_id
          WHERE i.office_id=? AND i.user_id=? AND i.source_kind=? AND
          i.scope=? AND i.case_id IS NOT DISTINCT FROM ? AND i.folder_id IS NOT DISTINCT FROM ? AND
          i.google_file_id IS NOT DISTINCT FROM ? AND i.gmail_message_id IS NOT DISTINCT FROM ? AND
          i.gmail_attachment_part IS NOT DISTINCT FROM ? AND i.status='completed'
          ORDER BY i.completed_at LIMIT 1`).get<{ vault_document_id: string }>(row.office_id, row.user_id, row.source_kind,
            row.scope, row.case_id, row.folder_id, row.google_file_id, row.gmail_message_id, row.gmail_attachment_part);
        const docId = prior?.vault_document_id ?? row.id;
        const existing = await tx.prepare('SELECT * FROM vault_document WHERE id=? AND office_id=? AND deleted_at IS NULL FOR UPDATE')
          .get<{ id: string; case_id: string | null; folder_id: string | null; scope: string }>(docId, row.office_id);
        if (!existing) {
          await tx.prepare(`INSERT INTO vault_document(id,office_id,case_id,folder_id,scope,original_name,stored_name,mime_type,byte_size,sha256,created_by)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(docId, row.office_id, row.case_id, row.folder_id, row.scope, name, key, format.mimeType, bytes.length, hash, row.user_id);
        } else if (existing.case_id !== row.case_id || existing.folder_id !== row.folder_id || existing.scope !== row.scope)
          throw new CapabilityError('CONFLICT', 'A cópia anterior está em outro destino.');
        const max = await tx.prepare('SELECT coalesce(max(version),0) AS n FROM vault_document_version WHERE document_id=?').get<{ n: number }>(docId);
        const version = Number(max?.n ?? 0) + 1;
        await tx.prepare('UPDATE vault_document_version SET is_active=0 WHERE office_id=? AND document_id=?').run(row.office_id, docId);
        await tx.prepare(`INSERT INTO vault_document_version(id,office_id,document_id,version,original_name,stored_name,mime_type,byte_size,sha256,created_by,is_active)
          VALUES(?,?,?,?,?,?,?,?,?,?,1)`).run(randomUUID(), row.office_id, docId, version, name, key, format.mimeType, bytes.length, hash, row.user_id);
        if (existing) await tx.prepare(`UPDATE vault_document SET original_name=?,stored_name=?,mime_type=?,byte_size=?,sha256=?,status='queued',
          progress=0,error_message=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND office_id=? AND deleted_at IS NULL`).run(name, key, format.mimeType, bytes.length, hash, docId, row.office_id);
        await tx.prepare(`UPDATE google_drive_import SET status='completed',vault_document_id=?,vault_version=?,sha256=?,byte_size=?,
          completed_at=CURRENT_TIMESTAMP,error_code=NULL,error_message=NULL WHERE id=?`).run(docId, version, hash, bytes.length, row.id);
        committed = true;
      });
      if (!committed) await storage.delete(key).catch(() => undefined);
    } catch (error) { await storage.delete(key).catch(() => undefined); throw error; }
  } catch (error) {
    if (error instanceof CapabilityError && ['FORBIDDEN', 'SCOPE_REQUIRED', 'NOT_FOUND', 'INVALID', 'CONFLICT'].includes(error.code)) {
      await db.prepare("UPDATE google_drive_import SET status='failed',error_code=?,error_message=? WHERE id=? AND status<>'completed'")
        .run(error.code, error.message, row.id);
      return;
    }
    throw error;
  }
}
