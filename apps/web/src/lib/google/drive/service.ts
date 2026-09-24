import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import type { CapabilityInput as Input } from '@/lib/capabilities/contracts';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { WorkspaceContext } from '@/lib/application/context';
import { findVaultDocument, readVaultOriginal } from '@/lib/vault';
import { googleJson, googleRequest, requireConnection, type ConnectionRow } from '../connections';
import { GoogleApiError } from '../transport';
import { runGoogleOperation, checkpointOperation, type Reconciler, type RunningOperation } from '../operations';
import type { GoogleAction } from '../policy';
import { fileKind, importFormatFor, isGoogleNative, MAX_IMPORT_BYTES, GOOGLE_DOC_MIME } from './formats';
import { documentText, editRequests, editsVisible, resolveEdits, type GoogleDocument } from './docs';
import { queueDriveImport, listOwnImports } from './import';

type Capabilities = { canRename?: boolean; canShare?: boolean; canEdit?: boolean; canModifyContent?: boolean; canDownload?: boolean };
export type DriveMetadata = { id: string; name: string; mimeType: string; size?: string; driveId?: string; version?: string; headRevisionId?: string; md5Checksum?: string; modifiedTime?: string; webViewLink?: string; capabilities?: Capabilities; trashed?: boolean };
export type FileRow = { id: string; office_id: string; user_id: string; connection_id: string; google_file_id: string; name: string; mime_type: string; size_bytes: number | null; drive_id: string | null; version: string | null; head_revision_id: string | null; modified_time: string | null; capabilities_json: string; web_view_link: string | null; state: 'available' | 'not_found' | 'permission_lost' };
type Permission = { id: string; type: string; role: string; emailAddress?: string; displayName?: string; permissionDetails?: { inherited?: boolean }[] };
const FILE_FIELDS = 'id,name,mimeType,size,driveId,version,headRevisionId,md5Checksum,modifiedTime,webViewLink,capabilities(canRename,canShare,canEdit,canModifyContent,canDownload),trashed';
const pathId = (id: string) => encodeURIComponent(id);
const absent = () => new CapabilityError('NOT_FOUND', 'Arquivo não encontrado entre os itens escolhidos da sua conta Google.');
function dto(row: FileRow) {
  const c = JSON.parse(row.capabilities_json || '{}') as Capabilities;
  return { id: row.id, name: row.name, mimeType: row.mime_type, kind: fileKind(row.mime_type), sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    modifiedTime: row.modified_time ? new Date(row.modified_time).toISOString() : null, version: row.version, sharedDrive: !!row.drive_id,
    capabilities: { canRename: !!c.canRename, canShare: !!c.canShare, canEdit: !!c.canEdit, canModifyContent: !!c.canModifyContent, canDownload: !!c.canDownload },
    state: row.state, webViewLink: row.web_view_link, importFormat: importFormatFor(row.mime_type)?.label ?? null };
}
export async function ownFile(context: WorkspaceContext, fileId: string, connection: ConnectionRow) {
  const row = await database.prepare('SELECT * FROM google_drive_file WHERE id=? AND office_id=? AND user_id=? AND connection_id=?')
    .get<FileRow>(fileId, context.officeId, context.userId, connection.id);
  if (!row) throw absent();
  return row;
}
export async function fetchMetadata(connection: ConnectionRow, googleFileId: string) {
  if (!/^[\w-]{10,200}$/.test(googleFileId)) throw new CapabilityError('INVALID', 'Identificador de arquivo inválido.');
  const meta = await googleJson<DriveMetadata>(connection, { service: 'drive', path: `/files/${pathId(googleFileId)}`, query: { fields: FILE_FIELDS, supportsAllDrives: true } });
  if (meta.id !== googleFileId || !meta.name || !meta.mimeType || meta.trashed) throw absent();
  return meta;
}
async function save(context: WorkspaceContext, connection: ConnectionRow, m: DriveMetadata) {
  const row = await database.prepare(`INSERT INTO google_drive_file(id,office_id,user_id,connection_id,google_file_id,name,mime_type,size_bytes,drive_id,version,head_revision_id,modified_time,capabilities_json,web_view_link,state)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'available') ON CONFLICT(connection_id,google_file_id) DO UPDATE SET
    name=excluded.name,mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,drive_id=excluded.drive_id,version=excluded.version,
    head_revision_id=excluded.head_revision_id,modified_time=excluded.modified_time,capabilities_json=excluded.capabilities_json,
    web_view_link=excluded.web_view_link,state='available',verified_at=CURRENT_TIMESTAMP RETURNING *`)
    .get<FileRow>(randomUUID(), context.officeId, context.userId, connection.id, m.id, m.name, m.mimeType,
      m.size === undefined ? null : Number(m.size), m.driveId ?? null, m.version ?? null, m.headRevisionId ?? null, m.modifiedTime ?? null,
      JSON.stringify(m.capabilities ?? {}), m.webViewLink ?? null);
  return row!;
}
export async function registerFiles(c: WorkspaceContext, i: Input<'k5_drive_register_files'>) {
  const conn = await requireConnection(c, 'drive');
  const files = [];
  for (const id of new Set(i.googleFileIds)) files.push(dto(await save(c, conn, await fetchMetadata(conn, id))));
  return { files };
}
export async function listFiles(c: WorkspaceContext, i: Input<'k5_drive_list_files'>) {
  const conn = await requireConnection(c, 'drive');
  const rows = await database.prepare('SELECT * FROM google_drive_file WHERE office_id=? AND user_id=? AND connection_id=? ORDER BY verified_at DESC LIMIT ? OFFSET ?')
    .all<FileRow>(c.officeId, c.userId, conn.id, i.limit, i.offset);
  const count = await database.prepare('SELECT count(*) AS n FROM google_drive_file WHERE office_id=? AND user_id=? AND connection_id=?')
    .get<{ n: number }>(c.officeId, c.userId, conn.id);
  return { files: rows.map(dto), total: Number(count?.n ?? 0) };
}
export async function refreshFile(c: WorkspaceContext, i: Input<'k5_drive_refresh_file'>) {
  const conn = await requireConnection(c, 'drive');
  const file = await ownFile(c, i.fileId, conn);
  let meta: DriveMetadata;
  try { meta = await fetchMetadata(conn, file.google_file_id); }
  catch (e) {
    const state = e instanceof GoogleApiError
      ? e.status === 404 ? 'not_found' : e.status === 403 ? 'permission_lost' : null
      : e instanceof CapabilityError && e.code === 'NOT_FOUND' ? 'not_found' : null;
    if (!state) throw e;
    await database.prepare('UPDATE google_drive_file SET state=?,verified_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND user_id=?')
      .run(state, file.id, c.officeId, c.userId);
    return { file: dto({ ...file, state }) };
  }
  return { file: dto(await save(c, conn, meta)) };
}
export async function importFile(c: WorkspaceContext, i: Input<'k5_drive_import_file'>) { return { import: await queueDriveImport(c, i) }; }
export async function listImports(c: WorkspaceContext, i: Input<'k5_drive_list_imports'>) { return { imports: await listOwnImports(c, i) }; }
function need(m: DriveMetadata, capability: keyof Capabilities) {
  if (!m.capabilities?.[capability]) throw new CapabilityError('FORBIDDEN', 'A conta Google não tem permissão para esta ação.');
}
async function selected(c: WorkspaceContext, module: 'drive' | 'docs', id: string) {
  const conn = await requireConnection(c, module);
  const file = await ownFile(c, id, conn);
  return { conn, file, meta: await fetchMetadata(conn, file.google_file_id) };
}
const core = (f: FileRow) => ({ googleFileId: f.google_file_id, fileId: f.id });
const resultFile = async (c: WorkspaceContext, conn: ConnectionRow, m: DriveMetadata) => dto(await save(c, conn, m));
async function vaultSnapshot(officeId: string, documentId: string) {
  const row = await database.prepare(`SELECT d.sha256,d.byte_size,v.version FROM vault_document d
    LEFT JOIN vault_document_version v ON v.document_id=d.id AND v.office_id=d.office_id AND v.is_active=1
    WHERE d.id=? AND d.office_id=? AND d.deleted_at IS NULL`).get<{ sha256: string; byte_size: number; version: number | null }>(documentId, officeId);
  if (!row) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado no Cofre.');
  return { sha256: row.sha256, byteSize: Number(row.byte_size), version: row.version };
}
export async function renameFile(c: WorkspaceContext, i: Input<'k5_drive_rename_file'>) {
  const { file, meta } = await selected(c, 'drive', i.fileId);
  need(meta, 'canRename');
  const outcome = await runGoogleOperation(c, { module: 'drive', actions: ['drive.rename'], capabilityName: 'k5_drive_rename_file', effectKey: `drive:${file.google_file_id}`,
    input: { ...i, ...core(file) }, bound: { version: meta.version, review: [{ label: 'Arquivo', value: meta.name }, { label: 'Novo nome', value: i.name }] },
    targetResourceId: file.id, describe: `Renomear “${meta.name}” para “${i.name}” no Google Drive`,
    execute: async op => { await checkpointOperation(op, { googleFileId: file.google_file_id, oldName: meta.name, newName: i.name });
      const m = await googleJson<DriveMetadata>(op.connection, { service: 'drive', method: 'PATCH', path: `/files/${pathId(file.google_file_id)}`,
      query: { supportsAllDrives: true, fields: FILE_FIELDS }, json: { name: i.name } });
      return { externalRef: file.google_file_id, result: await resultFile(c, op.connection, m) }; },
    reconcile: async op => { const m = await fetchMetadata(op.connection, file.google_file_id); return m.name === i.name
      ? { state: 'found', externalRef: file.google_file_id, result: await resultFile(c, op.connection, m) } : { state: 'unknown' }; },
  });
  return { file: outcome.result, operation: outcome.operation };
}
export async function uploadVersion(c: WorkspaceContext, i: Input<'k5_drive_upload_version'>) {
  const { file, meta } = await selected(c, 'drive', i.fileId);
  if (isGoogleNative(meta.mimeType)) throw new CapabilityError('INVALID', 'Arquivos nativos do Google devem ser editados no Google.');
  need(meta, 'canModifyContent');
  const doc = await findVaultDocument(c.officeId, i.documentId);
  if (!doc) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado no Cofre.');
  if (doc.byteSize > MAX_IMPORT_BYTES) throw new CapabilityError('INVALID', 'Documento acima de 50 MB.');
  const vault = await vaultSnapshot(c.officeId, doc.id);
  const bound = { driveVersion: meta.version, documentSha256: vault.sha256, documentVersion: vault.version, documentByteSize: vault.byteSize,
    review: [{ label: 'Arquivo Google', value: meta.name }, { label: 'Versão Google', value: meta.version ?? 'não informada' },
      { label: 'Documento do Cofre', value: doc.name }, { label: 'Versão Cofre', value: vault.version === null ? 'não informada' : String(vault.version) },
      { label: 'Tamanho', value: `${vault.byteSize} bytes` }, { label: 'SHA-256 Cofre', value: vault.sha256 }] };
  const outcome = await runGoogleOperation(c, { module: 'drive', actions: ['drive.replace'], capabilityName: 'k5_drive_upload_version', effectKey: `drive:${file.google_file_id}`,
    input: { ...i, ...core(file) }, bound, targetResourceId: file.id, metrics: { attachmentBytes: vault.byteSize },
    describe: `Enviar “${doc.name}” como versão de “${meta.name}”`,
    execute: async op => {
      const current = await fetchMetadata(op.connection, file.google_file_id);
      if (current.version !== bound.driveVersion) throw new CapabilityError('CONFLICT', 'O arquivo mudou no Google. Atualize antes de substituir.');
      need(current, 'canModifyContent');
      const fresh = await findVaultDocument(c.officeId, doc.id);
      if (!fresh) throw new CapabilityError('CONFLICT', 'O documento do Cofre foi removido.');
      const currentVault = await vaultSnapshot(c.officeId, doc.id);
      if (currentVault.sha256 !== bound.documentSha256 || currentVault.version !== bound.documentVersion ||
        currentVault.byteSize !== bound.documentByteSize) throw new CapabilityError('CONFLICT', 'O documento do Cofre mudou.');
      const bytes = await readVaultOriginal(fresh);
      if (bytes.length !== bound.documentByteSize || createHash('sha256').update(bytes).digest('hex') !== bound.documentSha256)
        throw new CapabilityError('CONFLICT', 'Os bytes do documento do Cofre não correspondem à versão revisada.');
      await checkpointOperation(op, { googleFileId: file.google_file_id, beforeVersion: bound.driveVersion,
        md5Checksum: createHash('md5').update(bytes).digest('hex') });
      const m = await googleJson<DriveMetadata>(op.connection, { service: 'upload', method: 'PATCH', path: `/files/${pathId(file.google_file_id)}`,
        query: { uploadType: 'media', supportsAllDrives: true, fields: FILE_FIELDS }, body: bytes,
        contentType: fresh.mimeType, maxBytes: 1_000_000, timeoutMs: 120_000 });
      return { externalRef: file.google_file_id, result: await resultFile(c, op.connection, m) };
    },
    reconcile: reconcileReplace,
  });
  return { file: outcome.result, operation: outcome.operation };
}
function permissionDto(p: Permission, canShare: boolean) {
  const inherited = !!p.permissionDetails?.length && p.permissionDetails.every(d => d.inherited === true);
  return { id: p.id, type: p.type, role: p.role, emailAddress: p.emailAddress ?? null, displayName: p.displayName ?? null,
    inherited, removable: canShare && !inherited && !['owner', 'organizer'].includes(p.role) };
}
async function permissions(conn: ConnectionRow, file: FileRow, canShare: boolean) {
  const result: ReturnType<typeof permissionDto>[] = [];
  let token: string | undefined;
  do {
    const page = await googleJson<{ permissions?: Permission[]; nextPageToken?: string }>(conn, { service: 'drive',
      path: `/files/${pathId(file.google_file_id)}/permissions`,
      query: { supportsAllDrives: true, fields: 'nextPageToken,permissions(id,type,role,emailAddress,displayName,permissionDetails(inherited,inheritedFrom,permissionType,role))', pageSize: 100, pageToken: token } });
    result.push(...(page.permissions ?? []).map(p => permissionDto(p, canShare)));
    token = page.nextPageToken;
  } while (token && result.length < 1000);
  return result;
}
export async function listPermissions(c: WorkspaceContext, i: Input<'k5_drive_list_permissions'>) {
  const { conn, file, meta } = await selected(c, 'drive', i.fileId);
  return { permissions: await permissions(conn, file, !!meta.capabilities?.canShare) };
}
export async function shareFile(c: WorkspaceContext, i: Input<'k5_drive_share_file'>) {
  const { file, meta } = await selected(c, 'drive', i.fileId);
  need(meta, 'canShare');
  const email = i.email.toLowerCase();
  const outcome = await runGoogleOperation(c, { module: 'drive', actions: ['drive.share'], capabilityName: 'k5_drive_share_file', effectKey: `drive:${file.google_file_id}`,
    input: { ...i, email, ...core(file) }, bound: { version: meta.version, review: [{ label: 'Arquivo', value: meta.name }, { label: 'Pessoa', value: email },
      { label: 'Permissão', value: { reader: 'Leitor', commenter: 'Comentarista', writer: 'Editor' }[i.role] },
      { label: 'Notificação por e-mail', value: i.notify ? 'Sim' : 'Não' }, { label: 'Mensagem', value: i.message ?? '' }] },
    targetResourceId: file.id, metrics: { recipients: 1 },
    describe: `Compartilhar “${meta.name}” com ${email} como ${i.role}`,
    execute: async op => {
      need(await fetchMetadata(op.connection, file.google_file_id), 'canShare');
      await checkpointOperation(op, { googleFileId: file.google_file_id, email, role: i.role });
      const p = await googleJson<Permission>(op.connection, { service: 'drive', method: 'POST',
        path: `/files/${pathId(file.google_file_id)}/permissions`,
        query: { supportsAllDrives: true, sendNotificationEmail: i.notify, ...(i.message ? { emailMessage: i.message } : {}), fields: 'id,type,role,emailAddress,displayName,permissionDetails' },
        json: { type: 'user', role: i.role, emailAddress: email } });
      return { externalRef: p.id, result: permissionDto(p, true) };
    },
    reconcile: async op => { const p = (await permissions(op.connection, file, true)).find(p => p.type === 'user' && p.emailAddress?.toLowerCase() === email && p.role === i.role);
      return p ? { state: 'found', externalRef: p.id, result: p } : { state: 'absent' }; },
  });
  return { permission: outcome.result, operation: outcome.operation };
}
export async function revokePermission(c: WorkspaceContext, i: Input<'k5_drive_revoke_permission'>) {
  const { conn, file, meta } = await selected(c, 'drive', i.fileId);
  need(meta, 'canShare');
  const target = (await permissions(conn, file, true)).find(p => p.id === i.permissionId);
  if (!target?.removable) throw new CapabilityError('FORBIDDEN', 'Este acesso é herdado, protegido ou não existe.');
  const outcome = await runGoogleOperation(c, { module: 'drive', actions: ['drive.share'], capabilityName: 'k5_drive_revoke_permission', effectKey: `drive:${file.google_file_id}`,
    input: { ...i, ...core(file) }, bound: { target, review: [{ label: 'Arquivo', value: meta.name }, { label: 'Remover acesso', value: target.emailAddress ?? target.displayName ?? target.id }] }, targetResourceId: file.id,
    describe: `Remover acesso de ${target.emailAddress ?? target.displayName ?? target.id} a “${meta.name}”`,
    execute: async op => {
      const now = (await permissions(op.connection, file, true)).find(p => p.id === target.id);
      if (!now?.removable) throw new CapabilityError('CONFLICT', 'A permissão mudou. Atualize a lista.');
      await checkpointOperation(op, { googleFileId: file.google_file_id, permissionId: target.id });
      await googleRequest(op.connection, { service: 'drive', method: 'DELETE', path: `/files/${pathId(file.google_file_id)}/permissions/${pathId(target.id)}`,
        query: { supportsAllDrives: true } });
      return { externalRef: target.id, result: true };
    },
    reconcile: async op => (await permissions(op.connection, file, true)).some(p => p.id === target.id)
      ? { state: 'unknown' } : { state: 'found', externalRef: target.id, result: true },
  });
  return { operation: outcome.operation };
}
async function googleDoc(conn: ConnectionRow, file: FileRow) {
  return googleJson<GoogleDocument>(conn, { service: 'docs', path: `/documents/${pathId(file.google_file_id)}`, query: { includeTabsContent: true }, maxBytes: 8_000_000 });
}
export async function readDoc(c: WorkspaceContext, i: Input<'k5_docs_read'>) {
  const { conn, file, meta } = await selected(c, 'docs', i.fileId);
  if (meta.mimeType !== GOOGLE_DOC_MIME) throw new CapabilityError('INVALID', 'Escolha um documento nativo do Google Docs.');
  const doc = await googleDoc(conn, file);
  if (!doc.revisionId) throw new CapabilityError('NOT_READY', 'O Google não informou a revisão.');
  return { document: { fileId: file.id, title: doc.title ?? meta.name, revisionId: doc.revisionId, text: documentText(doc).text }, untrustedContent: true as const };
}
export async function editDoc(c: WorkspaceContext, i: Input<'k5_docs_edit'>) {
  const { file, meta } = await selected(c, 'docs', i.fileId);
  if (meta.mimeType !== GOOGLE_DOC_MIME) throw new CapabilityError('INVALID', 'Escolha um documento nativo do Google Docs.');
  need(meta, 'canEdit');
  const conn = await requireConnection(c, 'docs');
  const doc = await googleDoc(conn, file);
  if (!doc.revisionId) throw new CapabilityError('NOT_READY', 'O Google não informou a revisão.');
  const resolved = resolveEdits(documentText(doc), i.edits, doc.revisionId !== i.revisionId);
  if (doc.revisionId !== i.revisionId && !i.approvalId)
    throw new CapabilityError('CONFLICT', 'O documento mudou. Leia a revisão atual e confirme novamente os trechos propostos.');
  const bound = { originalRevision: i.revisionId, currentRevision: doc.revisionId, resolved,
    review: [{ label: 'Documento', value: meta.name }, { label: 'Revisão', value: doc.revisionId },
      ...i.edits.flatMap((e, n) => [{ label: `Trecho ${n + 1}`, value: e.find }, { label: `Substituir por ${n + 1}`, value: e.replace }])] };
  const outcome = await runGoogleOperation(c, { module: 'docs', actions: ['docs.edit'], capabilityName: 'k5_docs_edit', effectKey: `drive:${file.google_file_id}`,
    input: { ...i, ...core(file) }, bound, targetResourceId: file.id,
    describe: `Editar ${i.edits.length} trecho(s) de “${meta.name}”, revisão ${doc.revisionId}`,
    execute: async op => {
      if ((await googleDoc(op.connection, file)).revisionId !== bound.currentRevision) throw new CapabilityError('CONFLICT', 'O documento mudou. Leia e aprove novamente.');
      await checkpointOperation(op, { googleFileId: file.google_file_id, revisionId: bound.currentRevision });
      const updated = await googleJson<{ writeControl?: { requiredRevisionId?: string } }>(op.connection,
        { service: 'docs', method: 'POST', path: `/documents/${pathId(file.google_file_id)}:batchUpdate`,
          json: { requests: editRequests(resolved), writeControl: { requiredRevisionId: bound.currentRevision } }, maxBytes: 1_000_000 });
      return { externalRef: file.google_file_id, result: { revisionId: updated.writeControl?.requiredRevisionId ?? null, applied: i.edits.length } };
    },
    reconcile: async op => { const current = await googleDoc(op.connection, file); return editsVisible(documentText(current).text, i.edits)
      ? { state: 'found', externalRef: file.google_file_id, result: { revisionId: current.revisionId ?? null, applied: i.edits.length } } : { state: 'unknown' }; },
  });
  return { revisionId: outcome.result?.revisionId ?? null, applied: outcome.result?.applied ?? 0, operation: outcome.operation };
}
function opFile(op: RunningOperation) {
  const id = op.args.fileId;
  if (typeof id !== 'string') throw new CapabilityError('INVALID', 'Operação sem arquivo.');
  return ownFile({ officeId: op.connection.office_id, userId: op.connection.user_id, role: 'lawyer' }, id, op.connection);
}
function opContext(op: RunningOperation): WorkspaceContext {
  return { officeId: op.connection.office_id, userId: op.connection.user_id, role: 'lawyer' };
}
const reconcileRename: Reconciler = async op => {
  const file = await opFile(op);
  const current = await fetchMetadata(op.connection, file.google_file_id);
  return current.name === op.args.name
    ? { state: 'found', externalRef: file.google_file_id, result: await resultFile(opContext(op), op.connection, current) }
    : { state: 'unknown' };
};
const reconcileReplace: Reconciler = async op => {
  const file = await opFile(op);
  const current = await fetchMetadata(op.connection, file.google_file_id);
  const expected = op.checkpoint?.md5Checksum;
  if (typeof expected === 'string' && current.version !== op.checkpoint?.beforeVersion && current.md5Checksum === expected)
    return { state: 'found', externalRef: file.google_file_id, result: await resultFile(opContext(op), op.connection, current) };
  return current.version === op.checkpoint?.beforeVersion ? { state: 'absent' } : { state: 'unknown' };
};
const reconcileShare: Reconciler = async op => {
  const file = await opFile(op);
  const listed = await permissions(op.connection, file, true);
  if (typeof op.args.permissionId === 'string') {
    const revoked = !listed.some(p => p.id === op.args.permissionId);
    return revoked ? { state: 'found', externalRef: op.args.permissionId, result: true } : { state: 'unknown' };
  }
  const found = listed.find(p => p.type === 'user' && p.emailAddress?.toLowerCase() === String(op.args.email).toLowerCase() && p.role === op.args.role);
  return found ? { state: 'found', externalRef: found.id, result: found } : { state: 'absent' };
};
const reconcileDocs: Reconciler = async op => {
  const file = await opFile(op);
  const current = await googleDoc(op.connection, file);
  const edits = op.args.edits as { find: string; replace: string }[];
  return Array.isArray(edits) && editsVisible(documentText(current).text, edits)
    ? { state: 'found', externalRef: file.google_file_id, result: { revisionId: current.revisionId ?? null, applied: edits.length } }
    : { state: 'unknown' };
};
export const driveReconcilers: Partial<Record<GoogleAction, Reconciler>> = {
  'drive.rename': reconcileRename, 'drive.replace': reconcileReplace, 'drive.share': reconcileShare, 'docs.edit': reconcileDocs,
};
