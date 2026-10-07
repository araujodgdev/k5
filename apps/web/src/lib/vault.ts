import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { database, withTransaction, type Transaction } from "@/lib/database";
import { aclReadTransaction, aclTransaction } from "@/lib/acl-transaction";
import { assertCapabilityAllowed, type WorkspaceContext } from '@/lib/application/context';
import { documentTransaction } from "@/lib/documents/service";
import { assertPolicyAccess, parsePolicy, type ContentPolicy } from "@/lib/content-policy";
import { caseAccess } from "@/lib/collaboration/access";
import { chargeOcrPage } from "@/lib/billing/credits";
import { type OfficeMembership } from "@/lib/offices";

/**
 * Every read of a case's contents names its viewer. Folders inside a case can be private or
 * restricted, so "same office" is not enough to see a document: the folder path has to admit the
 * person too. `null` is reserved for server work that acts on behalf of no one (extraction,
 * indexing, cleanup), never for a request made by a person.
 */
export type Viewer = string | null;
const visibleTo = (column: string, viewer: Viewer) => viewer === null ? { sql: "TRUE", values: [] as string[] }
  : { sql: `vault_folder_visible(${column}, ?)`, values: [viewer] };
import { assertStorageKey, objectStorage, StorageError } from "@/lib/storage";
import { isTrustedOrigin } from "@/lib/trusted-origins";
import type { UploadRef } from "@/lib/application/uploads-service";
import type { CapabilityErrorCode } from "@/lib/capabilities/errors";
import { captureOperationalError } from "@/lib/observability/report";

export type VaultStatus = "queued" | "processing" | "ready" | "failed";
export type VaultScope = "library" | "case";

export type VaultOriginKind = "chat_attachment" | "artifact_pdf" | "artifact_docx";
export type VaultDocument = {
  id: string; name: string; caseId: string | null; caseName: string | null; folderId: string | null; scope: VaultScope;
  mimeType: string; byteSize: number; status: VaultStatus; progress: number; errorMessage: string | null;
  extractedCharacters: number; sourceCount: number; createdAt: string;
};

export type VaultCase = {
  id: string; name: string; description: string | null; createdAt: string; updatedAt: string;
  client: { name: string | null; document: string | null; email: string | null; phone: string | null; notes: string | null };
  documentCount: number;
};
export type FolderVisibility = "public" | "private" | "restricted";
/**
 * `owned` is whether the viewer created the folder, which is what lets them change its access.
 * `memberIds` is only filled for its creator: who else may see a folder is the creator's business.
 */
export type VaultFolder = {
  id: string; caseId: string; parentId: string | null; name: string; createdAt: string; documentCount: number; folderCount: number;
  visibility: FolderVisibility; owned: boolean; memberIds: string[];
};
export type DocumentChunk = { id: string; documentId: string; stableReference: string; sourceLabel: string; content: string; ordinal: number };
type DocumentRow = VaultDocument & { storedName: string; officeId: string; leaseOwner: string | null; leaseExpiresAt: string | null; deletedAt: string | null };

export class VaultHttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: CapabilityErrorCode) { super(message); }
}

export class VaultStorageUnavailableError extends VaultHttpError {
  constructor(cause: unknown) {
    super(503, 'Armazenamento de documentos indisponível.');
    this.cause = cause;
  }
}

function mapDocument(row: Record<string, unknown>): DocumentRow {
  return {
    id: String(row.id), name: String(row.name), caseId: row.caseId as string | null, caseName: row.caseName as string | null,
    folderId: row.folderId as string | null, scope: row.scope as VaultScope, mimeType: String(row.mimeType), byteSize: Number(row.byteSize), status: row.status as VaultStatus,
    progress: Number(row.progress), errorMessage: row.errorMessage as string | null, extractedCharacters: Number(row.extractedCharacters),
    sourceCount: Number(row.sourceCount), createdAt: String(row.createdAt), storedName: String(row.storedName), officeId: String(row.officeId),
    leaseOwner: row.leaseOwner as string | null, leaseExpiresAt: row.leaseExpiresAt as string | null,
    deletedAt: row.deletedAt as string | null,
  };
}

const documentSelect = `
  SELECT d.id, d.original_name AS name, d.case_id AS caseId, c.name AS caseName, d.folder_id AS folderId, d.scope,
    d.mime_type AS mimeType, d.byte_size AS byteSize, d.status, d.progress,
    d.error_message AS errorMessage, d.extracted_characters AS extractedCharacters,
    d.source_count AS sourceCount, d.created_at AS createdAt, d.stored_name AS storedName,
    d.office_id AS officeId, d.lease_owner AS leaseOwner, d.lease_expires_at AS leaseExpiresAt,
    d.deleted_at AS deletedAt
  FROM vault_document d LEFT JOIN vault_case c ON c.id = d.case_id AND c.office_id = d.office_id`;

export async function requireVaultWorkspace(): Promise<{ user: { id: string }; office: OfficeMembership }> {

  const { getSession, requireWorkspace } = await import("@/lib/session");
  const session = await getSession();
  if (!session) throw new VaultHttpError(401, "Sua sessão expirou.");
  return requireWorkspace();
}

export function assertSameOrigin(request: Request) {

  if (!isTrustedOrigin(request.headers.get("origin"))) throw new VaultHttpError(403, "Origem da requisição não autorizada.");
}

export type CaseDetails = {
  description?: string | null;
  client?: { name?: string | null; document?: string | null; email?: string | null; phone?: string | null; notes?: string | null } | null;
};

function caseSelect(viewer: Viewer) {
  const visible = viewer === null ? { sql: "TRUE", values: [] } : { sql: "lume_vault_visible(d.id, ?)", values: [viewer] };
  return { values: visible.values, sql: `
  SELECT k.id, k.name, k.description, k.created_at AS createdAt, k.updated_at AS updatedAt,
    k.client_name AS clientName, k.client_document AS clientDocument, k.client_email AS clientEmail,
    k.client_phone AS clientPhone, k.client_notes AS clientNotes,
    (SELECT count(*) FROM vault_document d WHERE d.case_id = k.id AND d.office_id = k.office_id AND d.deleted_at IS NULL AND ${visible.sql}) AS documentCount
  FROM vault_case k` };
}

function mapCase(row: Record<string, unknown>): VaultCase {
  const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
  return {
    id: String(row.id), name: String(row.name), description: text(row.description),
    createdAt: String(row.createdAt), updatedAt: String(row.updatedAt ?? row.createdAt),
    client: {
      name: text(row.clientName), document: text(row.clientDocument), email: text(row.clientEmail),
      phone: text(row.clientPhone), notes: text(row.clientNotes),
    },
    documentCount: Number(row.documentCount ?? 0),
  };
}

export async function listVaultCases(officeId: string, viewer: Viewer): Promise<VaultCase[]> {
  const select = caseSelect(viewer);
  return (await database.prepare(`${select.sql} WHERE k.office_id = ? AND k.deleted_at IS NULL ORDER BY k.updated_at DESC, k.created_at DESC`)
    .all(...select.values, officeId)).map((row) => mapCase(row as Record<string, unknown>));
}

export async function findVaultCase(officeId: string, caseId: string, viewer: Viewer, db: Transaction = database): Promise<VaultCase | undefined> {
  const select = caseSelect(viewer);
  const row = await db.prepare(`${select.sql} WHERE k.office_id = ? AND k.id = ? AND k.deleted_at IS NULL`).get(...select.values, officeId, caseId) as Record<string, unknown> | undefined;
  return row ? mapCase(row) : undefined;
}

function cleanText(value: unknown, max: number, label: string): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) throw new VaultHttpError(400, `${label} excede ${max} caracteres.`);
  return text;
}

export async function createVaultCase(officeId: string, userId: string, name: string, details: CaseDetails = {}, context: WorkspaceContext = { officeId, userId: userId }) {
  return aclTransaction(async tx => {
    await assertCapabilityAllowed(context, 'k5_vault_create_case', tx);
  const clean = name.trim();
  if (clean.length < 2 || clean.length > 180) throw new VaultHttpError(400, "Informe um nome de caso entre 2 e 180 caracteres.");
  const id = randomUUID();
  const client = details.client ?? {};
  await tx.prepare(`INSERT INTO vault_case (id, office_id, name, description, client_name, client_document, client_email, client_phone, client_notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, officeId, clean, cleanText(details.description, 4000, "A descrição"), cleanText(client.name, 180, "O nome do cliente"),
      cleanText(client.document, 40, "O documento do cliente"), cleanText(client.email, 200, "O e-mail do cliente"),
      cleanText(client.phone, 40, "O telefone do cliente"), cleanText(client.notes, 4000, "As observações"), userId);
  return (await findVaultCase(officeId, id, userId, tx))!;
  });
}

/** Partial update: a field left out keeps its stored value, and an empty string clears it. */
export async function updateVaultCase(officeId: string, caseId: string, viewer: Viewer, patch: { name?: string } & CaseDetails, context: WorkspaceContext = { officeId, userId: viewer ?? '' }) {
  return aclTransaction(async tx => {
    await assertCapabilityAllowed(context, 'k5_vault_update_case', tx);
  const current = await findVaultCase(officeId, caseId, viewer, tx);
  if (!current) throw new VaultHttpError(404, "Caso não encontrado.");
  const name = patch.name === undefined ? current.name : patch.name.trim();
  if (name.length < 2 || name.length > 180) throw new VaultHttpError(400, "Informe um nome de caso entre 2 e 180 caracteres.");
  const pick = <K extends keyof VaultCase["client"]>(key: K, max: number, label: string) =>
    patch.client === undefined || patch.client === null || patch.client[key] === undefined
      ? current.client[key]
      : cleanText(patch.client[key], max, label);
  await tx.prepare(`UPDATE vault_case SET name = ?, description = ?, client_name = ?, client_document = ?, client_email = ?, client_phone = ?, client_notes = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ? AND office_id = ? AND deleted_at IS NULL`)
    .run(name, patch.description === undefined ? current.description : cleanText(patch.description, 4000, "A descrição"),
      pick("name", 180, "O nome do cliente"), pick("document", 40, "O documento do cliente"), pick("email", 200, "O e-mail do cliente"),
      pick("phone", 40, "O telefone do cliente"), pick("notes", 4000, "As observações"), caseId, officeId);
  return (await findVaultCase(officeId, caseId, viewer, tx))!;
  });
}

function folderSelect(viewer: Viewer) {
  const visible = visibleTo("c.id", viewer);
  const documents = viewer === null ? { sql: "TRUE", values: [] } : { sql: "lume_vault_visible(d.id, ?)", values: [viewer] };
  return { values: [...documents.values, ...visible.values, viewer ?? "", viewer ?? ""], sql: `
  SELECT f.id, f.case_id AS caseId, f.parent_id AS parentId, f.name, f.created_at AS createdAt, f.visibility,
    (SELECT count(*) FROM vault_document d WHERE d.folder_id = f.id AND d.office_id = f.office_id AND d.deleted_at IS NULL AND ${documents.sql}) AS documentCount,
    (SELECT count(*) FROM vault_folder c WHERE c.parent_id = f.id AND c.deleted_at IS NULL AND ${visible.sql}) AS folderCount,
    f.created_by = ? AS owned,
    CASE WHEN f.created_by = ? THEN (SELECT coalesce(array_agg(m.user_id ORDER BY m.user_id), '{}') FROM vault_folder_member m WHERE m.folder_id = f.id) ELSE '{}' END AS memberIds
  FROM vault_folder f` };
}

function mapFolder(row: Record<string, unknown>): VaultFolder {
  return {
    id: String(row.id), caseId: String(row.caseId), parentId: row.parentId === null || row.parentId === undefined ? null : String(row.parentId),
    name: String(row.name), createdAt: String(row.createdAt),
    documentCount: Number(row.documentCount ?? 0), folderCount: Number(row.folderCount ?? 0),
    visibility: row.visibility as FolderVisibility, owned: row.owned === true,
    memberIds: Array.isArray(row.memberIds) ? row.memberIds.map(String) : [],
  };
}

/** Direct children of a level that the viewer can see. `parentId` null is the case root. */
export async function listVaultFolders(officeId: string, viewer: Viewer, caseId: string, parentId: string | null = null): Promise<VaultFolder[]> {
  const select = folderSelect(viewer);
  const visible = visibleTo("f.id", viewer);
  const clause = parentId ? "f.parent_id = ?" : "f.parent_id IS NULL";
  const values = parentId ? [officeId, caseId, parentId] : [officeId, caseId];
  return (await database.prepare(`${select.sql} WHERE f.office_id = ? AND f.case_id = ? AND ${clause} AND f.deleted_at IS NULL AND ${visible.sql} ORDER BY lower(f.name)`)
    .all(...select.values, ...values, ...visible.values)).map((row) => mapFolder(row as Record<string, unknown>));
}

/** A folder the viewer cannot see is reported exactly like one that does not exist. */
export async function findVaultFolder(officeId: string, folderId: string, viewer: Viewer, db: Transaction = database): Promise<VaultFolder | undefined> {
  const select = folderSelect(viewer);
  const visible = visibleTo("f.id", viewer);
  const row = await db.prepare(`${select.sql} WHERE f.office_id = ? AND f.id = ? AND f.deleted_at IS NULL AND ${visible.sql}`)
    .get(...select.values, officeId, folderId, ...visible.values) as Record<string, unknown> | undefined;
  return row ? mapFolder(row) : undefined;
}

/** Root-to-folder path, for breadcrumbs. Depth is bounded so a cycle cannot loop the request. */
export async function vaultFolderPath(officeId: string, folderId: string, viewer: Viewer, db: Transaction = database): Promise<VaultFolder[]> {
  const path: VaultFolder[] = [];
  let current: string | null = folderId;
  for (let depth = 0; current && depth < 12; depth += 1) {
    const folder: VaultFolder | undefined = await findVaultFolder(officeId, current, viewer, db);
    if (!folder) break;
    path.unshift(folder);
    current = folder.parentId;
  }
  return path;
}

export type FolderAccess = { visibility: FolderVisibility; memberIds?: string[] };

/** The people a restricted folder can name: the case owner and its current participants. */
export async function vaultCasePeople(officeId: string, caseId: string, db: Transaction = database) {
  return db.prepare(`SELECT u.id, u.name, u.email FROM "user" u WHERE u.id IN (
      SELECT user_id FROM office_member WHERE office_id = ?
      UNION SELECT user_id FROM case_participant WHERE office_id = ? AND case_id = ? AND revoked_at IS NULL)
    ORDER BY u.name, u.id`).all<{ id: string; name: string; email: string }>(officeId, officeId, caseId);
}

async function cleanAccess(officeId: string, caseId: string, creator: string, access: FolderAccess, db: Transaction = database) {
  if (!["public", "private", "restricted"].includes(access.visibility)) throw new VaultHttpError(400, "Escolha quem pode ver a pasta.");
  if (access.visibility !== "restricted") return { visibility: access.visibility, memberIds: [] };
  const memberIds = [...new Set(access.memberIds ?? [])].filter((id) => id !== creator);
  if (!memberIds.length) throw new VaultHttpError(400, "Escolha ao menos uma pessoa do caso para ver a pasta.");
  const people = new Set((await vaultCasePeople(officeId, caseId, db)).map((person) => person.id));
  if (memberIds.some((id) => !people.has(id))) throw new VaultHttpError(400, "Escolha apenas pessoas que participam deste caso.");
  return { visibility: access.visibility, memberIds };
}

export async function createVaultFolder(officeId: string, userId: string, caseId: string, name: string, parentId: string | null = null, access: FolderAccess = { visibility: "public" }, context: WorkspaceContext = { officeId, userId }) {
  return aclTransaction(async tx => {
    await assertCapabilityAllowed(context, 'k5_vault_create_folder', tx);
  const clean = name.trim();
  if (clean.length < 1 || clean.length > 120) throw new VaultHttpError(400, "Informe um nome de pasta de até 120 caracteres.");
  if (!await findVaultCase(officeId, caseId, userId, tx)) throw new VaultHttpError(404, "Caso não encontrado.");

  if (parentId) {
    const parent = await findVaultFolder(officeId, parentId, userId, tx);
    if (!parent || parent.caseId !== caseId) throw new VaultHttpError(404, "Pasta de destino não encontrada.");
    if ((await vaultFolderPath(officeId, parentId, userId, tx)).length >= 8) throw new VaultHttpError(409, "Limite de subpastas atingido neste caminho.");
  }
  const { visibility, memberIds } = await cleanAccess(officeId, caseId, userId, access, tx);
  const id = randomUUID();
  try {
    for (const write of [
      tx.prepare("INSERT INTO vault_folder (id, office_id, case_id, parent_id, name, created_by, visibility) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(id, officeId, caseId, parentId, clean, userId, visibility),
      ...memberIds.map((memberId) => tx.prepare("INSERT INTO vault_folder_member (folder_id, user_id) VALUES (?, ?)").bind(id, memberId)),
    ]) await tx.prepare(write.sql).run(...write.params);
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') throw new VaultHttpError(409, "Você já tem uma pasta com esse nome neste nível.");
    throw error;
  }
  return (await findVaultFolder(officeId, id, userId, tx))!;
  });
}

/** Only whoever created a folder decides who sees it; nobody else, including the case owner. */
export async function updateVaultFolderAccess(officeId: string, folderId: string, userId: string, access: FolderAccess, context: WorkspaceContext = { officeId, userId }) {
  return aclTransaction(async tx => {
    await assertCapabilityAllowed(context, 'k5_vault_update_folder_access', tx);
  const folder = await findVaultFolder(officeId, folderId, userId, tx);
  if (!folder) throw new VaultHttpError(404, "Pasta não encontrada.");
  if (!folder.owned) throw new VaultHttpError(403, "Só quem criou a pasta altera quem pode vê-la.");
  const { visibility, memberIds } = await cleanAccess(officeId, folder.caseId, userId, access, tx);
  for (const write of [
    tx.prepare("UPDATE vault_folder SET visibility = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND office_id = ? AND created_by = ?").bind(visibility, folderId, officeId, userId),
    tx.prepare("DELETE FROM vault_folder_member WHERE folder_id = ?").bind(folderId),
    ...memberIds.map((memberId) => tx.prepare("INSERT INTO vault_folder_member (folder_id, user_id) VALUES (?, ?)").bind(folderId, memberId)),
  ]) await tx.prepare(write.sql).run(...write.params);
  return (await findVaultFolder(officeId, folderId, userId, tx))!;
  });
}

/**
 * Soft-deletes a folder. Its documents and subfolders move up to the parent level instead of
 * disappearing; subfolders keep their own access. Its creator or the case owner may delete it.
 */
export async function deleteVaultFolder(officeId: string, folderId: string, userId: string, context: WorkspaceContext = { officeId, userId }) {
  return aclTransaction(async tx => {
    await assertCapabilityAllowed(context, 'k5_vault_delete_folder', tx);
  const folder = await findVaultFolder(officeId, folderId, userId, tx);
  if (!folder) throw new VaultHttpError(404, "Pasta não encontrada.");
  const owner = await tx.prepare("SELECT 1 FROM office_member WHERE office_id = ? AND user_id = ?").get(officeId, userId);
  if (!folder.owned && !owner) throw new VaultHttpError(403, "Só quem criou a pasta ou o responsável pelo caso pode removê-la.");
  if (folder.visibility !== "public" && await tx.prepare(`SELECT 1 WHERE
    EXISTS(SELECT 1 FROM vault_document WHERE folder_id=? AND office_id=? AND deleted_at IS NULL)
    OR EXISTS(SELECT 1 FROM case_page WHERE folder_id=? AND office_id=?)
    OR EXISTS(SELECT 1 FROM vault_folder WHERE parent_id=? AND office_id=? AND deleted_at IS NULL)`)
    .get(folderId, officeId, folderId, officeId, folderId, officeId))
    throw new VaultHttpError(409, "Mova o conteúdo ou altere o acesso antes de remover esta pasta. Removê-la liberaria o conteúdo para outras pessoas.");

  for (const write of [
    tx.prepare("UPDATE vault_document SET folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE folder_id = ? AND office_id = ?").bind(folder.parentId, folderId, officeId),
    tx.prepare("UPDATE case_page SET folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE folder_id = ? AND office_id = ?").bind(folder.parentId, folderId, officeId),
    tx.prepare("UPDATE vault_folder SET parent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE parent_id = ? AND office_id = ? AND deleted_at IS NULL").bind(folder.parentId, folderId, officeId),
    tx.prepare("UPDATE vault_folder SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND office_id = ?").bind(folderId, officeId),
  ]) await tx.prepare(write.sql).run(...write.params);
  });
}

/** A move cannot discard another creator's access rule. Staying below that rule is safe. */
export async function assertVaultDocumentMove(officeId: string, userId: string, sourceFolderId: string | null, targetFolderId: string | null, db: Transaction = database) {
  if (!sourceFolderId || sourceFolderId === targetFolderId) return;
  const [source, target] = await Promise.all([
    vaultFolderPath(officeId, sourceFolderId, userId, db),
    targetFolderId ? vaultFolderPath(officeId, targetFolderId, userId, db) : Promise.resolve([]),
  ]);
  if (!source.length) throw new VaultHttpError(404, "Pasta de origem não encontrada.");
  const retained = new Set(target.map(folder => folder.id));
  if (source.some(folder => folder.visibility !== "public" && !folder.owned && !retained.has(folder.id)))
    throw new VaultHttpError(403, "Só quem definiu o acesso da pasta pode mover arquivos para fora dela.");
}

export function publicDocument(row: DocumentRow): VaultDocument {
  return {
    id: row.id, name: row.name, caseId: row.caseId, caseName: row.caseName, folderId: row.folderId, scope: row.scope,
    mimeType: row.mimeType, byteSize: row.byteSize, status: row.status, progress: row.progress,
    errorMessage: row.errorMessage, extractedCharacters: row.extractedCharacters,
    sourceCount: row.sourceCount, createdAt: row.createdAt,
  };
}

export async function listVaultDocuments(
  officeId: string,
  viewer: Viewer,
  filters: { scope?: string | null; caseId?: string | null; folderId?: string | null; lumeOnly?: boolean; limit?: number; offset?: number } = {},
  db: Transaction = database,
): Promise<VaultDocument[]> {

  const visible = viewer === null ? { sql: "TRUE", values: [] } : { sql: "lume_vault_visible(d.id, ?)", values: [viewer] };
  const where = ["d.office_id = ?", "d.deleted_at IS NULL", visible.sql];
  const values: (string | number | null)[] = [officeId, ...visible.values];
  if (filters.lumeOnly) where.push("(d.case_id IS NULL OR EXISTS(SELECT 1 FROM vault_case c WHERE c.id=d.case_id AND c.deleted_at IS NULL AND c.lume_enabled))");
  if (filters.scope === "library" || filters.scope === "case") { where.push("d.scope = ?"); values.push(filters.scope); }
  if (filters.caseId) { where.push("d.case_id = ?"); values.push(filters.caseId); }

  if (filters.folderId === null) where.push("d.folder_id IS NULL");
  else if (filters.folderId) { where.push("d.folder_id = ?"); values.push(filters.folderId); }
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  return (await db.prepare(`${documentSelect} WHERE ${where.join(" AND ")} ORDER BY d.created_at DESC, d.id DESC LIMIT ? OFFSET ?${db === database ? '' : ' FOR SHARE OF d'}`)
    .all(...values, limit, offset)).map((row) => publicDocument(mapDocument(row)));
}

export async function countVaultDocuments(officeId: string, viewer: Viewer, filters: { scope?: string | null; caseId?: string | null; folderId?: string | null; lumeOnly?: boolean } = {}, db: Transaction = database): Promise<number> {
  const visible = viewer === null ? { sql: "TRUE", values: [] } : { sql: "lume_vault_visible(id, ?)", values: [viewer] };
  const where = ["office_id = ?", "deleted_at IS NULL", visible.sql];
  const values: (string | null)[] = [officeId, ...visible.values];
  if (filters.lumeOnly) where.push("(case_id IS NULL OR EXISTS(SELECT 1 FROM vault_case c WHERE c.id=vault_document.case_id AND c.deleted_at IS NULL AND c.lume_enabled))");
  if (filters.scope === "library" || filters.scope === "case") { where.push("scope = ?"); values.push(filters.scope); }
  if (filters.caseId) { where.push("case_id = ?"); values.push(filters.caseId); }
  if (filters.folderId === null) where.push("folder_id IS NULL");
  else if (filters.folderId) { where.push("folder_id = ?"); values.push(filters.folderId); }
  return Number(await (await db.prepare(`SELECT count(*) AS n FROM vault_document WHERE ${where.join(" AND ")}`).get(...values))?.n ?? 0);
}

/**
 * Live documents only. Deletion has to stop every read path at once, so the default lookup
 * excludes tombstones and the cleanup worker asks for them explicitly.
 */
export async function findVaultDocument(officeId: string, documentId: string, viewer: Viewer, db: Transaction = database): Promise<DocumentRow | undefined> {
  const visible = viewer === null ? { sql: "TRUE", values: [] } : { sql: "lume_vault_visible(d.id, ?)", values: [viewer] };
  const row = await db.prepare(`${documentSelect} WHERE d.office_id = ? AND d.id = ? AND d.deleted_at IS NULL AND ${visible.sql}`)
    .get(officeId, documentId, ...visible.values) as Record<string, unknown> | undefined;
  return row ? mapDocument(row) : undefined;
}

export async function findVaultDocumentIncludingDeleted(officeId: string, documentId: string, db: Transaction = database): Promise<DocumentRow | undefined> {
  const row = await db.prepare(`${documentSelect} WHERE d.office_id = ? AND d.id = ?`).get(officeId, documentId) as Record<string, unknown> | undefined;
  return row ? mapDocument(row) : undefined;
}

/**
 * Creates the document row for an upload the server already stored and validated. The storage key
 * comes from the upload reference, never from the caller, so there is no caller-controlled path.
 */
export async function createVaultDocument(
  context: WorkspaceContext,
  upload: UploadRef,
  options: { scope: string; caseId?: string | null; folderId?: string | null; documentId?: string; origin?: { kind: VaultOriginKind; id: string; version?: number }; independentUpload?: boolean; policy: ContentPolicy },
) {
  const { officeId, userId } = context;
  const scope: VaultScope = options.scope === "case" ? "case" : options.scope === "library" ? "library" : (() => { throw new VaultHttpError(400, "Escolha o destino do documento."); })();
  const caseId = scope === "case" ? options.caseId?.trim() : null;
  if (scope === "case" && !caseId) throw new VaultHttpError(400, "Escolha um caso para o documento.");
  if (caseId && !await database.prepare("SELECT 1 FROM vault_case WHERE id = ? AND office_id = ? AND deleted_at IS NULL").get(caseId, officeId)) {
    throw new VaultHttpError(404, "Caso não encontrado.");
  }

  const folderId = caseId ? options.folderId?.trim() || null : null;
  if (folderId) {
    const folder = await findVaultFolder(officeId, folderId, userId);
    if (!folder || folder.caseId !== caseId) throw new VaultHttpError(404, "Pasta não encontrada.");
  }
  const id = options.documentId ?? randomUUID();

  await documentTransaction(context, async tx => {
    await assertCapabilityAllowed(context, 'k5_vault_ingest_upload', tx);
    if (caseId) {
      const access = await caseAccess(userId, caseId, tx);
      if (access.officeId !== officeId) throw new VaultHttpError(404, 'Caso não encontrado.');
    } else if (!await tx.prepare('SELECT 1 FROM office_member WHERE office_id=? AND user_id=?').get(officeId, userId)) throw new VaultHttpError(404, 'Biblioteca não encontrada.');
    if (folderId && !await tx.prepare('SELECT 1 FROM vault_folder WHERE id=? AND office_id=? AND case_id=? AND deleted_at IS NULL AND vault_folder_visible(id,?)').get(folderId, officeId, caseId, userId)) throw new VaultHttpError(404, 'Pasta não encontrada.');
    const policy = { ...parsePolicy(options.policy), digest: upload.sha256 };
    await assertPolicyAccess(userId, policy, tx);
    await assertCapabilityAllowed(context, 'k5_vault_ingest_upload', tx);
    await tx.prepare('INSERT INTO vault_document(id,office_id,case_id,folder_id,scope,original_name,stored_name,mime_type,byte_size,sha256,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, officeId, caseId ?? null, folderId, scope, upload.originalName, upload.storageKey, upload.mimeType, upload.byteSize, upload.sha256, userId);
    await tx.prepare('INSERT INTO vault_document_version(id,office_id,document_id,version,original_name,stored_name,mime_type,byte_size,sha256,created_by,is_active,content_policy,independent_upload_by) VALUES(?,?,?,1,?,?,?,?,?,?,1,?::jsonb,?)')
      .run(randomUUID(), officeId, id, upload.originalName, upload.storageKey, upload.mimeType, upload.byteSize, upload.sha256, userId, JSON.stringify(policy), options.independentUpload && !options.origin && !context.invocation ? userId : null);
    if (options.origin) await tx.prepare('INSERT INTO vault_agent_origin(document_id,source_kind,source_id,source_version,user_id) VALUES(?,?,?,?,?)')
      .run(id, options.origin.kind, options.origin.id, options.origin.version ?? null, userId);
  });
  return (await findVaultDocument(officeId, id, userId))!;
}

const LEGACY_UPLOAD_DIRECTORY = resolve(process.cwd(), ".data", "uploads");
const EXTRACTOR_VERSION = "k5-extract-1";

/**
 * Reads the original through the storage adapter. Rows written before the adapter existed hold a
 * flat file name instead of a key; those are read from the legacy directory by base name only,
 * which is also what keeps an old row from pointing outside it.
 */
export async function readVaultOriginalStream(document: Pick<DocumentRow, 'storedName'>) {
  try { assertStorageKey(document.storedName); }
  catch { return readVaultOriginal(document); }
  const storage = await objectStorage();
  if (!storage.getStream) return readVaultOriginal(document);
  try { return await storage.getStream(document.storedName); }
  catch (error) {
    if (error instanceof StorageError && error.code === 'not_found') throw new VaultHttpError(404, 'Arquivo original não encontrado.');
    throw new VaultStorageUnavailableError(error);
  }
}

export async function readVaultOriginal(document: Pick<DocumentRow, "storedName">) {
  const key = document.storedName;
  try {
    assertStorageKey(key);
  } catch {
    const legacy = basename(key);
    if (!legacy || legacy !== key) throw new VaultHttpError(404, "Arquivo original não encontrado.");
    try {
      return await readFile(resolve(LEGACY_UPLOAD_DIRECTORY, legacy));
    } catch { throw new VaultHttpError(404, "Arquivo original não encontrado."); }
  }
  try {
    return await (await objectStorage()).get(key);
  } catch (error) {
    if (error instanceof StorageError && error.code === "not_found") throw new VaultHttpError(404, "Arquivo original não encontrado.");
    throw new VaultStorageUnavailableError(error);
  }
}

/** Server-only original-file access for the export workflow. Office ownership and folder access are checked first. */
export async function readVaultDocumentFile(officeId: string, documentId: string, viewer: Viewer) {
  const document = await findVaultDocument(officeId, documentId, viewer);
  if (!document) throw new VaultHttpError(404, "Documento não encontrado.");
  const buffer = await readVaultOriginal(document);
  const current = await findVaultDocument(officeId, documentId, viewer);
  if (!current || current.storedName !== document.storedName) throw new VaultHttpError(404, "Documento não encontrado ou alterado. Abra-o novamente.");
  return { buffer, name: document.name, mimeType: document.mimeType };
}

export async function retryVaultDocument(officeId: string, documentId: string) {

  const result = await database.prepare(`UPDATE vault_document
    SET status = 'queued', progress = 0, error_message = NULL, lease_owner = NULL, lease_expires_at = NULL,
      ingestion_attempts = 0, retry_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE office_id = ? AND id = ? AND status IN ('failed', 'queued') AND deleted_at IS NULL`).run(officeId, documentId);
  if (!result.changes) throw new VaultHttpError(409, "Somente documentos com falha ou na fila podem ser reenviados.");
}

export async function getDocumentChunks(officeId: string, viewer: Viewer, documentIds: string[], query?: string): Promise<DocumentChunk[]> {
  return aclReadTransaction(async tx => {
  const ids = [...new Set(documentIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
  if (!ids.length) return [];
  const marks = ids.map(() => "?").join(", ");
  const visible = viewer === null ? { sql: "TRUE", values: [] } : { sql: "lume_vault_visible(id, ?)", values: [viewer] };
  const allowed = await tx.prepare(`SELECT id, original_name AS name, status, extracted_version,extracted_sha256,(SELECT version FROM vault_document_version WHERE document_id=vault_document.id AND is_active=1) AS version,(SELECT sha256 FROM vault_document_version WHERE document_id=vault_document.id AND is_active=1) AS active_sha256 FROM vault_document WHERE office_id = ? AND deleted_at IS NULL AND ${visible.sql} AND id IN (${marks})`).all(officeId, ...visible.values, ...ids) as Array<{ id: string; name: string; status: VaultStatus; extracted_version: number | null; extracted_sha256: string | null; version: number; active_sha256: string }>;
  if (allowed.length !== ids.length) throw new VaultHttpError(404, "Um dos documentos selecionados não está disponível neste escritório.");
  const unavailable = allowed.find((document) => document.status !== "ready" || document.extracted_version !== document.version || document.extracted_sha256 !== document.active_sha256);
  if (unavailable) throw new VaultHttpError(409, `O documento “${unavailable.name}” ainda não está pronto para uso.`, 'NOT_READY');
  if (!query?.trim()) return await tx.prepare(`SELECT c.id, c.document_id AS documentId, c.stable_reference AS stableReference,
    d.original_name || ' — ' || c.stable_reference AS sourceLabel, c.content, c.ordinal
    FROM vault_document_chunk c JOIN vault_document d ON d.id = c.document_id AND d.office_id = c.office_id
    WHERE c.office_id = ? AND c.document_id IN (${marks}) ORDER BY c.document_id, c.ordinal`).all(officeId, ...ids) as DocumentChunk[];
  const terms = query.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 12) ?? [];
  if (!terms.length) return [];
  const ftsQuery = terms.map((term) => `'${term.replaceAll("'", "''")}'`).join(' | ');
  return await tx.prepare(`SELECT c.id, c.document_id AS documentId, c.stable_reference AS stableReference,
    d.original_name || ' — ' || c.stable_reference AS sourceLabel, c.content, c.ordinal
    FROM vault_document_chunk c CROSS JOIN to_tsquery('portuguese', ?) q
    JOIN vault_document d ON d.id = c.document_id AND d.office_id = c.office_id
    WHERE c.search_vector @@ q AND c.office_id = ? AND c.document_id IN (${marks})
    ORDER BY ts_rank_cd(c.search_vector,q) DESC,c.id LIMIT 100`).all(ftsQuery, officeId, ...ids) as DocumentChunk[];
  });
}

const CLAIMABLE = "deleted_at IS NULL AND ((status = 'queued' AND (retry_at IS NULL OR retry_at <= CURRENT_TIMESTAMP)) OR (status = 'processing' AND lease_expires_at < CURRENT_TIMESTAMP))";

/** Storage outages are retried this many times, waiting longer each time, before a document fails. */
export const STORAGE_RETRY_DELAYS_SECONDS = [60, 300, 900] as const;

export async function claimQueuedDocument() {
  const owner = randomUUID();
  const claimed = await database.prepare(`UPDATE vault_document
      SET status = 'processing', progress = CASE WHEN progress > 0 THEN progress ELSE 1 END,
        lease_owner = ?, lease_expires_at = (CURRENT_TIMESTAMP + INTERVAL '5 minutes'), error_message = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = (SELECT id FROM vault_document WHERE ${CLAIMABLE} ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
        AND ${CLAIMABLE}
      RETURNING id, office_id AS officeId`).get<{ id: string; officeId: string }>(owner);
  if (!claimed) return undefined;
  return { document: (await findVaultDocument(claimed.officeId, claimed.id, null))!, owner };
}

export async function checkpointVaultDocument(documentId: string, owner: string, progress: number) {
  await database.prepare(`UPDATE vault_document SET progress = ?, lease_expires_at = (CURRENT_TIMESTAMP + INTERVAL '5 minutes'), updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'processing' AND lease_owner = ?`).run(Math.max(1, Math.min(99, Math.round(progress))), documentId, owner);
}

export async function processDocument(documentId: string, officeId: string, leaseOwner?: string) {
  const document = await findVaultDocument(officeId, documentId, null);
  if (!document) throw new VaultHttpError(404, "Documento não encontrado.");
  const notificationOwner = await database.prepare('SELECT created_by FROM vault_document WHERE id=? AND office_id=?')
    .get<{ created_by: string }>(documentId, officeId);
  const owner = leaseOwner ?? randomUUID();
  if (!leaseOwner) await database.prepare(`UPDATE vault_document SET status = 'processing', progress = 1, lease_owner = ?, lease_expires_at = (CURRENT_TIMESTAMP + INTERVAL '5 minutes'), error_message = NULL WHERE id = ? AND office_id = ? AND stored_name=? AND deleted_at IS NULL`).run(owner, documentId, officeId, document.storedName);
  let progress = document.progress || 1;
  const heartbeat = setInterval(() => { void checkpointVaultDocument(documentId, owner, progress); }, 60_000);
  heartbeat.unref();
  try {
    const { extractDocumentSections } = await import("@/lib/document-extraction");

    const onProgress = async (done: number) => {
      const next = Math.max(progress, Math.min(95, Math.round(done * 95)));
      if (next === progress) return;
      progress = next;
      await checkpointVaultDocument(documentId, owner, progress);
    };

    const onOcrPage = (page: string) => chargeOcrPage({ officeId, userId: notificationOwner?.created_by ?? null }, documentId, page);
    const sections = await extractDocumentSections(await readVaultOriginal(document), document.mimeType, document.name, document.id, { ocrImages: true, onProgress, onOcrPage });
    const insert = database.prepare("INSERT INTO vault_document_chunk (id, document_id, office_id, ordinal, stable_reference, content) VALUES (?, ?, ?, ?, ?, ?)");
    let ordinal = 0;
    let characters = 0;

    const writes = [database.prepare("DELETE FROM vault_document_chunk WHERE document_id = ? AND office_id = ?").bind(documentId, officeId)];
    for (const section of sections) {
      const parts = splitSection(section.content);
      for (let part = 0; part < parts.length; part++) {
        const content = parts[part];
        const stableReference = `${section.reference}${parts.length > 1 ? `#parte:${part + 1}` : ""}`;
        const chunkId = createHash("sha256").update(`${documentId}\u0000${ordinal}\u0000${stableReference}\u0000${content}`).digest("hex");
        writes.push(insert.bind(chunkId, documentId, officeId, ordinal++, stableReference, content));
        characters += content.length;
      }
    }
    writes.push(database.prepare(`UPDATE vault_document SET status = 'ready', progress = 100, error_message = NULL, extracted_characters = ?, source_count = ?,
      lease_expires_at = NULL, ingestion_attempts = 0, retry_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND office_id = ? AND lease_owner = ?`)
      .bind(characters, ordinal, documentId, officeId, owner));

    const manifestId = randomUUID();
    const notifiedAt = new Date().toISOString();
    writes.push(database.prepare(`INSERT INTO vault_extraction_manifest (id, office_id, document_id, extractor_version, total_units, completed_units, failed_units, details)
      SELECT ?, ?, ?, ?, ?, ?, 0, ? WHERE EXISTS(SELECT 1 FROM vault_document
        WHERE id=? AND office_id=? AND status='ready' AND lease_owner=?)`)
      .bind(manifestId, officeId, documentId, EXTRACTOR_VERSION, sections.length, sections.length,
        JSON.stringify({ chunks: ordinal, characters }), documentId, officeId, owner));
    if (notificationOwner) writes.push(database.prepare(`INSERT INTO notification_event(
      id,office_id,event_type,payload_version,source_kind,source_id,source_version,actor_user_id,
      intended_recipients_json,data_json,dedupe_key,historical,push_eligible,created_at,expires_at
    ) SELECT ?,?,'vault.processing.completed',1,'document',?,NULL,NULL,?,?,?,0,1,?,?
      WHERE EXISTS(SELECT 1 FROM vault_extraction_manifest WHERE id=? AND office_id=? AND document_id=?)
      ON CONFLICT(office_id,dedupe_key) DO NOTHING`).bind(
        randomUUID(), officeId, documentId, JSON.stringify([notificationOwner.created_by]),
        JSON.stringify({ stage: 'extraction' }), `vault:${documentId}:extraction:${manifestId}`,
        notifiedAt, new Date(Date.parse(notifiedAt) + 24 * 60 * 60 * 1000).toISOString(),
        manifestId, officeId, documentId,
      ));
    writes.push(database.prepare(`UPDATE vault_document SET lease_owner=NULL WHERE id=? AND office_id=? AND status='ready' AND lease_owner=?`)
      .bind(documentId, officeId, owner));
    await withTransaction(async tx => {
      const active = await tx.prepare(`SELECT v.version,v.sha256 FROM vault_document d
        JOIN vault_document_version v ON v.document_id=d.id AND v.is_active=1
        WHERE d.id=? AND d.office_id=? AND d.deleted_at IS NULL AND d.status='processing'
          AND d.lease_owner=? AND d.lease_expires_at>clock_timestamp() AND d.stored_name=? FOR UPDATE OF d`)
        .get<{ version: number; sha256: string }>(documentId, officeId, owner, document.storedName);
      if (!active) throw new Error('A tarefa de processamento perdeu sua concessão ou a versão foi substituída.');
      for (const write of writes) await tx.prepare(write.sql).run(...write.params);
      await tx.prepare('UPDATE vault_document SET extracted_version=?,extracted_sha256=? WHERE id=?')
        .run(active.version, active.sha256, documentId);
    });

    try {
      const { enqueueIndexJob } = await import("@/lib/knowledge/indexing");
      await enqueueIndexJob(officeId, documentId);
    } catch {

    }
  } catch (error) {
    if (error instanceof VaultStorageUnavailableError) {
      const row = await database.prepare('SELECT ingestion_attempts AS attempts FROM vault_document WHERE id = ? AND office_id = ?')
        .get<{ attempts: number }>(documentId, officeId);
      const attempt = (row?.attempts ?? 0) + 1;
      captureOperationalError(error.cause ?? error, 'vault.ingestion', { stage: 'storage_read', attempt: String(attempt) });
      const delay = STORAGE_RETRY_DELAYS_SECONDS[attempt - 1];
      if (delay !== undefined) {

        const requeued = await database.prepare(`UPDATE vault_document SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL,
            ingestion_attempts = ?, retry_at = CURRENT_TIMESTAMP + (?::integer * INTERVAL '1 second'), updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND office_id = ? AND lease_owner = ? AND status = 'processing'`).run(attempt, delay, documentId, officeId, owner);
        if (requeued.changes) return;
      }
    }
    const message = error instanceof Error ? error.message.slice(0, 500) : "Não foi possível processar este documento.";
    const failedAt = new Date().toISOString();
    const writes = [database.prepare(`UPDATE vault_document SET status = 'failed', error_message = ?, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND office_id = ? AND lease_owner = ?`).bind(message, documentId, officeId, owner)];
    if (notificationOwner) writes.push(database.prepare(`INSERT INTO notification_event(
      id,office_id,event_type,payload_version,source_kind,source_id,source_version,actor_user_id,
      intended_recipients_json,data_json,dedupe_key,historical,push_eligible,created_at,expires_at
    ) SELECT ?,?,'vault.processing.failed',1,'document',?,NULL,NULL,?,?,?,0,1,?,?
      WHERE EXISTS(SELECT 1 FROM vault_document WHERE id=? AND office_id=? AND status='failed' AND lease_owner=?)
      ON CONFLICT(office_id,dedupe_key) DO NOTHING`).bind(
        randomUUID(), officeId, documentId, JSON.stringify([notificationOwner.created_by]), '{}',
        `vault:${documentId}:attempt:${owner}:failed`, failedAt,
        new Date(Date.parse(failedAt) + 24 * 60 * 60 * 1000).toISOString(), documentId, officeId, owner,
      ));
    writes.push(database.prepare(`UPDATE vault_document SET lease_owner=NULL WHERE id=? AND office_id=? AND status='failed' AND lease_owner=?`)
      .bind(documentId, officeId, owner));
    await database.batch(writes);
    throw error;
  } finally { clearInterval(heartbeat); }
}

function splitSection(content: string) {
  const clean = content.replace(/\u0000/g, "").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  for (let position = 0; position < clean.length; position += 1800) chunks.push(clean.slice(position, position + 1800));
  return chunks;
}

export async function processNextVaultDocument(): Promise<boolean> {
  const claimed = await claimQueuedDocument();
  if (!claimed) return false;
  await processDocument(claimed.document.id, claimed.document.officeId, claimed.owner);
  return true;
}

/**
 * Extracts the document this request just queued, then indexes it.
 *
 * Cloudflare delegates to the Node Container because PDF rasterization/OCR need native modules.
 * The durable queue and cron recover an unsuccessful immediate wakeup. Local Node can drain inline.
 */
export async function drainQueuedDocument(officeId: string, documentId: string) {
  try {
    if (process.env.K5_RUNTIME === 'cloudflare') {
      const { env } = await import(/* webpackIgnore: true */ 'cloudflare:workers');
      if (env.PROCESSORS_ENABLED !== 'true') return;
      const processors = env.PROCESSORS as { getByName(name: string): { run(role: 'documents'): Promise<void> } } | undefined;
      if (!processors) throw new Error('Processador de documentos não configurado.');
      await processors.getByName('documents').run('documents');
      return;
    }
    if (!await processDocumentIfQueued(officeId, documentId)) return;
    try {
      const { processNextIndexJob } = await import("@/lib/knowledge/indexing");
      await processNextIndexJob();
    } catch {

    }
  } catch (error) {
    captureOperationalError(error, 'vault.ingest.dispatch');
  }
}

/** Claims one specific queued document so an upload can be extracted without waiting for the worker. */
export async function processDocumentIfQueued(officeId: string, documentId: string): Promise<boolean> {
  const owner = randomUUID();
  const claimed = await database.prepare(`UPDATE vault_document
      SET status = 'processing', progress = CASE WHEN progress > 0 THEN progress ELSE 1 END,
        lease_owner = ?, lease_expires_at = (CURRENT_TIMESTAMP + INTERVAL '5 minutes'), error_message = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND office_id = ? AND status = 'queued' AND deleted_at IS NULL
      RETURNING id`).get<{ id: string }>(owner, documentId, officeId);
  if (!claimed) return false;
  await processDocument(documentId, officeId, owner);
  return true;
}
