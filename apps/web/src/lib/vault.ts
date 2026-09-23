import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { database } from "@/lib/database";
import { ensureOfficeForUser, type OfficeMembership } from "@/lib/offices";
import { assertStorageKey, objectStorage, StorageError } from "@/lib/storage";
import { isTrustedOrigin } from "@/lib/trusted-origins";
import type { UploadRef } from "@/lib/application/uploads-service";
import { captureOperationalError } from "@/lib/observability/report";

export type VaultStatus = "queued" | "processing" | "ready" | "failed";
export type VaultScope = "library" | "case";
export type VaultDocument = {
  id: string; name: string; caseId: string | null; caseName: string | null; folderId: string | null; scope: VaultScope;
  mimeType: string; byteSize: number; status: VaultStatus; progress: number; errorMessage: string | null;
  extractedCharacters: number; sourceCount: number; createdAt: string;
};
/** A case is a folder in the office drive: a title, a description and, optionally, who it is for. */
export type VaultCase = {
  id: string; name: string; description: string | null; createdAt: string; updatedAt: string;
  client: { name: string | null; document: string | null; email: string | null; phone: string | null; notes: string | null };
  documentCount: number;
};
export type VaultFolder = { id: string; caseId: string; parentId: string | null; name: string; createdAt: string; documentCount: number; folderCount: number };
export type DocumentChunk = { id: string; documentId: string; stableReference: string; sourceLabel: string; content: string; ordinal: number };
type DocumentRow = VaultDocument & { storedName: string; officeId: string; leaseOwner: string | null; leaseExpiresAt: string | null; deletedAt: string | null };

export class VaultHttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
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
  // Lazy: the worker imports this module outside Next, where the session module cannot load.
  const { getSession } = await import("@/lib/session");
  const session = await getSession();
  if (!session) throw new VaultHttpError(401, "Sua sessão expirou.");
  return { user: session.user, office: await ensureOfficeForUser(database, session.user) };
}

export function requireVaultWriteRole(role: OfficeMembership["role"]) {
  if (role === "reviewer") throw new VaultHttpError(403, "Seu papel permite apenas consultar o Cofre.");
}

export function assertSameOrigin(request: Request) {
  // Same list, same reading as the rest of the app: see src/lib/trusted-origins.ts.
  if (!isTrustedOrigin(request.headers.get("origin"))) throw new VaultHttpError(403, "Origem da requisição não autorizada.");
}

export type CaseDetails = {
  description?: string | null;
  client?: { name?: string | null; document?: string | null; email?: string | null; phone?: string | null; notes?: string | null } | null;
};

const caseSelect = `
  SELECT k.id, k.name, k.description, k.created_at AS createdAt, k.updated_at AS updatedAt,
    k.client_name AS clientName, k.client_document AS clientDocument, k.client_email AS clientEmail,
    k.client_phone AS clientPhone, k.client_notes AS clientNotes,
    (SELECT count(*) FROM vault_document d WHERE d.case_id = k.id AND d.office_id = k.office_id AND d.deleted_at IS NULL) AS documentCount
  FROM vault_case k`;

// node:sqlite rows have a null prototype, which cannot cross into Client Components.
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

export async function listVaultCases(officeId: string): Promise<VaultCase[]> {
  return (await database.prepare(`${caseSelect} WHERE k.office_id = ? AND k.deleted_at IS NULL ORDER BY k.updated_at DESC, k.created_at DESC`)
    .all(officeId)).map((row) => mapCase(row as Record<string, unknown>));
}

export async function findVaultCase(officeId: string, caseId: string): Promise<VaultCase | undefined> {
  const row = await database.prepare(`${caseSelect} WHERE k.office_id = ? AND k.id = ? AND k.deleted_at IS NULL`).get(officeId, caseId) as Record<string, unknown> | undefined;
  return row ? mapCase(row) : undefined;
}

function cleanText(value: unknown, max: number, label: string): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) throw new VaultHttpError(400, `${label} excede ${max} caracteres.`);
  return text;
}

export async function createVaultCase(officeId: string, userId: string, name: string, details: CaseDetails = {}) {
  const clean = name.trim();
  if (clean.length < 2 || clean.length > 180) throw new VaultHttpError(400, "Informe um nome de caso entre 2 e 180 caracteres.");
  const id = randomUUID();
  const client = details.client ?? {};
  await database.prepare(`INSERT INTO vault_case (id, office_id, name, description, client_name, client_document, client_email, client_phone, client_notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, officeId, clean, cleanText(details.description, 4000, "A descrição"), cleanText(client.name, 180, "O nome do cliente"),
      cleanText(client.document, 40, "O documento do cliente"), cleanText(client.email, 200, "O e-mail do cliente"),
      cleanText(client.phone, 40, "O telefone do cliente"), cleanText(client.notes, 4000, "As observações"), userId);
  return (await findVaultCase(officeId, id))!;
}

/** Partial update: a field left out keeps its stored value, and an empty string clears it. */
export async function updateVaultCase(officeId: string, caseId: string, patch: { name?: string } & CaseDetails) {
  const current = await findVaultCase(officeId, caseId);
  if (!current) throw new VaultHttpError(404, "Caso não encontrado.");
  const name = patch.name === undefined ? current.name : patch.name.trim();
  if (name.length < 2 || name.length > 180) throw new VaultHttpError(400, "Informe um nome de caso entre 2 e 180 caracteres.");
  const pick = <K extends keyof VaultCase["client"]>(key: K, max: number, label: string) =>
    patch.client === undefined || patch.client === null || patch.client[key] === undefined
      ? current.client[key]
      : cleanText(patch.client[key], max, label);
  await database.prepare(`UPDATE vault_case SET name = ?, description = ?, client_name = ?, client_document = ?, client_email = ?, client_phone = ?, client_notes = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ? AND office_id = ? AND deleted_at IS NULL`)
    .run(name, patch.description === undefined ? current.description : cleanText(patch.description, 4000, "A descrição"),
      pick("name", 180, "O nome do cliente"), pick("document", 40, "O documento do cliente"), pick("email", 200, "O e-mail do cliente"),
      pick("phone", 40, "O telefone do cliente"), pick("notes", 4000, "As observações"), caseId, officeId);
  return (await findVaultCase(officeId, caseId))!;
}

const folderSelect = `
  SELECT f.id, f.case_id AS caseId, f.parent_id AS parentId, f.name, f.created_at AS createdAt,
    (SELECT count(*) FROM vault_document d WHERE d.folder_id = f.id AND d.office_id = f.office_id AND d.deleted_at IS NULL) AS documentCount,
    (SELECT count(*) FROM vault_folder c WHERE c.parent_id = f.id AND c.deleted_at IS NULL) AS folderCount
  FROM vault_folder f`;

function mapFolder(row: Record<string, unknown>): VaultFolder {
  return {
    id: String(row.id), caseId: String(row.caseId), parentId: row.parentId === null || row.parentId === undefined ? null : String(row.parentId),
    name: String(row.name), createdAt: String(row.createdAt),
    documentCount: Number(row.documentCount ?? 0), folderCount: Number(row.folderCount ?? 0),
  };
}

/** Direct children of a level. `parentId` null is the case root. */
export async function listVaultFolders(officeId: string, caseId: string, parentId: string | null = null): Promise<VaultFolder[]> {
  const clause = parentId ? "f.parent_id = ?" : "f.parent_id IS NULL";
  const values = parentId ? [officeId, caseId, parentId] : [officeId, caseId];
  return (await database.prepare(`${folderSelect} WHERE f.office_id = ? AND f.case_id = ? AND ${clause} AND f.deleted_at IS NULL ORDER BY lower(f.name)`)
    .all(...values)).map((row) => mapFolder(row as Record<string, unknown>));
}

export async function findVaultFolder(officeId: string, folderId: string): Promise<VaultFolder | undefined> {
  const row = await database.prepare(`${folderSelect} WHERE f.office_id = ? AND f.id = ? AND f.deleted_at IS NULL`).get(officeId, folderId) as Record<string, unknown> | undefined;
  return row ? mapFolder(row) : undefined;
}

/** Root-to-folder path, for breadcrumbs. Depth is bounded so a cycle cannot loop the request. */
export async function vaultFolderPath(officeId: string, folderId: string): Promise<VaultFolder[]> {
  const path: VaultFolder[] = [];
  let current: string | null = folderId;
  for (let depth = 0; current && depth < 12; depth += 1) {
    const folder: VaultFolder | undefined = await findVaultFolder(officeId, current);
    if (!folder) break;
    path.unshift(folder);
    current = folder.parentId;
  }
  return path;
}

export async function createVaultFolder(officeId: string, userId: string, caseId: string, name: string, parentId: string | null = null) {
  const clean = name.trim();
  if (clean.length < 1 || clean.length > 120) throw new VaultHttpError(400, "Informe um nome de pasta de até 120 caracteres.");
  if (!await findVaultCase(officeId, caseId)) throw new VaultHttpError(404, "Caso não encontrado.");
  // The parent has to belong to the same case of the same office; otherwise a valid id from
  // elsewhere would graft a subtree across cases.
  if (parentId) {
    const parent = await findVaultFolder(officeId, parentId);
    if (!parent || parent.caseId !== caseId) throw new VaultHttpError(404, "Pasta de destino não encontrada.");
    if ((await vaultFolderPath(officeId, parentId)).length >= 8) throw new VaultHttpError(409, "Limite de subpastas atingido neste caminho.");
  }
  const id = randomUUID();
  try {
    await database.prepare("INSERT INTO vault_folder (id, office_id, case_id, parent_id, name, created_by) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, officeId, caseId, parentId, clean, userId);
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') throw new VaultHttpError(409, "Já existe uma pasta com esse nome neste nível.");
    throw error;
  }
  return (await findVaultFolder(officeId, id))!;
}

/** Soft-deletes a folder. Its documents move up to the parent level instead of disappearing. */
export async function deleteVaultFolder(officeId: string, folderId: string) {
  const folder = await findVaultFolder(officeId, folderId);
  if (!folder) throw new VaultHttpError(404, "Pasta não encontrada.");
  // One batch: reparenting the children and tombstoning the folder land together, so no document
  // is left pointing at a folder that no longer exists.
  await database.batch([
    database.prepare("UPDATE vault_document SET folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE folder_id = ? AND office_id = ?").bind(folder.parentId, folderId, officeId),
    database.prepare("UPDATE vault_folder SET parent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE parent_id = ? AND office_id = ? AND deleted_at IS NULL").bind(folder.parentId, folderId, officeId),
    database.prepare("UPDATE vault_folder SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND office_id = ?").bind(folderId, officeId),
  ]);
}

// Stored name, office and lease data stay on the server.
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
  filters: { scope?: string | null; caseId?: string | null; folderId?: string | null; limit?: number; offset?: number } = {},
): Promise<VaultDocument[]> {
  // A tombstoned document is invisible here, not merely marked: this list feeds the UI, the
  // agent catalog and the run scope, and each of them would otherwise keep offering deleted files.
  const where = ["d.office_id = ?", "d.deleted_at IS NULL"];
  const values: (string | number | null)[] = [officeId];
  if (filters.scope === "library" || filters.scope === "case") { where.push("d.scope = ?"); values.push(filters.scope); }
  if (filters.caseId) { where.push("d.case_id = ?"); values.push(filters.caseId); }
  // `null` means the case root, which is a different question from "any folder".
  if (filters.folderId === null) where.push("d.folder_id IS NULL");
  else if (filters.folderId) { where.push("d.folder_id = ?"); values.push(filters.folderId); }
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  return (await database.prepare(`${documentSelect} WHERE ${where.join(" AND ")} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`)
    .all(...values, limit, offset)).map((row) => publicDocument(mapDocument(row)));
}

export async function countVaultDocuments(officeId: string, filters: { scope?: string | null; caseId?: string | null; folderId?: string | null } = {}): Promise<number> {
  const where = ["office_id = ?", "deleted_at IS NULL"];
  const values: (string | null)[] = [officeId];
  if (filters.scope === "library" || filters.scope === "case") { where.push("scope = ?"); values.push(filters.scope); }
  if (filters.caseId) { where.push("case_id = ?"); values.push(filters.caseId); }
  if (filters.folderId === null) where.push("folder_id IS NULL");
  else if (filters.folderId) { where.push("folder_id = ?"); values.push(filters.folderId); }
  return Number(await (await database.prepare(`SELECT count(*) AS n FROM vault_document WHERE ${where.join(" AND ")}`).get(...values))?.n ?? 0);
}

/**
 * Live documents only. Deletion has to stop every read path at once, so the default lookup
 * excludes tombstones and the cleanup worker asks for them explicitly.
 */
export async function findVaultDocument(officeId: string, documentId: string): Promise<DocumentRow | undefined> {
  const row = await database.prepare(`${documentSelect} WHERE d.office_id = ? AND d.id = ? AND d.deleted_at IS NULL`)
    .get(officeId, documentId) as Record<string, unknown> | undefined;
  return row ? mapDocument(row) : undefined;
}

export async function findVaultDocumentIncludingDeleted(officeId: string, documentId: string): Promise<DocumentRow | undefined> {
  const row = await database.prepare(`${documentSelect} WHERE d.office_id = ? AND d.id = ?`).get(officeId, documentId) as Record<string, unknown> | undefined;
  return row ? mapDocument(row) : undefined;
}

/**
 * Creates the document row for an upload the server already stored and validated. The storage key
 * comes from the upload reference, never from the caller, so there is no caller-controlled path.
 */
export async function createVaultDocument(
  officeId: string,
  userId: string,
  upload: UploadRef,
  options: { scope: string; caseId?: string | null; folderId?: string | null },
) {
  const scope: VaultScope = options.scope === "case" ? "case" : options.scope === "library" ? "library" : (() => { throw new VaultHttpError(400, "Escolha o destino do documento."); })();
  const caseId = scope === "case" ? options.caseId?.trim() : null;
  if (scope === "case" && !caseId) throw new VaultHttpError(400, "Escolha um caso para o documento.");
  if (caseId && !await database.prepare("SELECT 1 FROM vault_case WHERE id = ? AND office_id = ? AND deleted_at IS NULL").get(caseId, officeId)) {
    throw new VaultHttpError(404, "Caso não encontrado.");
  }
  // A folder only exists inside a case, and only inside this one.
  const folderId = caseId ? options.folderId?.trim() || null : null;
  if (folderId) {
    const folder = await findVaultFolder(officeId, folderId);
    if (!folder || folder.caseId !== caseId) throw new VaultHttpError(404, "Pasta não encontrada.");
  }
  const id = randomUUID();
  // The document and its first version are written together: a document with no active version
  // cannot be downloaded, and a version pointing at no document cannot be reached at all.
  await database.batch([
    database.prepare(`INSERT INTO vault_document
      (id, office_id, case_id, folder_id, scope, original_name, stored_name, mime_type, byte_size, sha256, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, officeId, caseId ?? null, folderId, scope, upload.originalName, upload.storageKey, upload.mimeType, upload.byteSize, upload.sha256, userId),
    database.prepare(`INSERT INTO vault_document_version
      (id, office_id, document_id, version, original_name, stored_name, mime_type, byte_size, sha256, created_by, is_active)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 1)`)
      .bind(randomUUID(), officeId, id, upload.originalName, upload.storageKey, upload.mimeType, upload.byteSize, upload.sha256, userId),
  ]);
  return (await findVaultDocument(officeId, id))!;
}

const LEGACY_UPLOAD_DIRECTORY = resolve(process.cwd(), ".data", "uploads");
const EXTRACTOR_VERSION = "k5-extract-1";

/**
 * Reads the original through the storage adapter. Rows written before the adapter existed hold a
 * flat file name instead of a key; those are read from the legacy directory by base name only,
 * which is also what keeps an old row from pointing outside it.
 */
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
    throw new VaultHttpError(503, "Armazenamento de documentos indisponível.");
  }
}

/** Server-only original-file access for the export workflow. Office ownership is checked first. */
export async function readVaultDocumentFile(officeId: string, documentId: string) {
  const document = await findVaultDocument(officeId, documentId);
  if (!document) throw new VaultHttpError(404, "Documento não encontrado.");
  return { buffer: await readVaultOriginal(document), name: document.name, mimeType: document.mimeType };
}

export async function retryVaultDocument(officeId: string, documentId: string) {
  // `queued` alongside `failed`: a document whose ingestion never started is stuck in exactly the
  // same way as one that threw, and on Workers it stays that way until a request drains it. The
  // row is already in the target state, so this is a no-op that lets the caller kick it.
  //
  // `deleted_at IS NULL` is the point of the rest: deletion parks the row in `failed`, which is
  // a state this transition accepts, so without it a tombstone could be reprocessed back into view.
  const result = await database.prepare(`UPDATE vault_document
    SET status = 'queued', progress = 0, error_message = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE office_id = ? AND id = ? AND status IN ('failed', 'queued') AND deleted_at IS NULL`).run(officeId, documentId);
  if (!result.changes) throw new VaultHttpError(409, "Somente documentos com falha ou na fila podem ser reenviados.");
}

export async function getDocumentChunks(officeId: string, documentIds: string[], query?: string): Promise<DocumentChunk[]> {
  const ids = [...new Set(documentIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
  if (!ids.length) return [];
  const marks = ids.map(() => "?").join(", ");
  const allowed = await database.prepare(`SELECT id, original_name AS name, status FROM vault_document WHERE office_id = ? AND deleted_at IS NULL AND id IN (${marks})`).all(officeId, ...ids) as Array<{ id: string; name: string; status: VaultStatus }>;
  if (allowed.length !== ids.length) throw new VaultHttpError(404, "Um dos documentos selecionados não está disponível neste escritório.");
  const unavailable = allowed.find((document) => document.status !== "ready");
  if (unavailable) throw new VaultHttpError(409, `O documento “${unavailable.name}” ainda não está pronto para uso.`);
  if (!query?.trim()) return await database.prepare(`SELECT c.id, c.document_id AS documentId, c.stable_reference AS stableReference,
    d.original_name || ' — ' || c.stable_reference AS sourceLabel, c.content, c.ordinal
    FROM vault_document_chunk c JOIN vault_document d ON d.id = c.document_id AND d.office_id = c.office_id
    WHERE c.office_id = ? AND c.document_id IN (${marks}) ORDER BY c.document_id, c.ordinal`).all(officeId, ...ids) as DocumentChunk[];
  const terms = query.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 12) ?? [];
  if (!terms.length) return [];
  const ftsQuery = terms.map((term) => `'${term.replaceAll("'", "''")}'`).join(' | ');
  return await database.prepare(`SELECT c.id, c.document_id AS documentId, c.stable_reference AS stableReference,
    d.original_name || ' — ' || c.stable_reference AS sourceLabel, c.content, c.ordinal
    FROM vault_document_chunk c CROSS JOIN to_tsquery('portuguese', ?) q
    JOIN vault_document d ON d.id = c.document_id AND d.office_id = c.office_id
    WHERE c.search_vector @@ q AND c.office_id = ? AND c.document_id IN (${marks})
    ORDER BY ts_rank_cd(c.search_vector,q) DESC,c.id LIMIT 100`).all(ftsQuery, officeId, ...ids) as DocumentChunk[];
}

const CLAIMABLE = "deleted_at IS NULL AND (status = 'queued' OR (status = 'processing' AND lease_expires_at < CURRENT_TIMESTAMP))";

/**
 * Takes the lease on the oldest claimable document, or returns nothing when there is none.
 *
 * One conditional `UPDATE ... RETURNING` rather than a read followed by a write: the sub-select
 * picks the row and the outer WHERE re-checks the same condition, both inside a single statement.
 * Two workers racing here cannot both come away holding the lease — the loser updates no rows and
 * returns nothing — and that holds without an interactive transaction, which D1 does not have.
 */
export async function claimQueuedDocument() {
  const owner = randomUUID();
  const claimed = await database.prepare(`UPDATE vault_document
      SET status = 'processing', progress = CASE WHEN progress > 0 THEN progress ELSE 1 END,
        lease_owner = ?, lease_expires_at = (CURRENT_TIMESTAMP + INTERVAL '5 minutes'), error_message = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = (SELECT id FROM vault_document WHERE ${CLAIMABLE} ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
        AND ${CLAIMABLE}
      RETURNING id, office_id AS officeId`).get<{ id: string; officeId: string }>(owner);
  if (!claimed) return undefined;
  return { document: (await findVaultDocument(claimed.officeId, claimed.id))!, owner };
}

export async function checkpointVaultDocument(documentId: string, owner: string, progress: number) {
  await database.prepare(`UPDATE vault_document SET progress = ?, lease_expires_at = (CURRENT_TIMESTAMP + INTERVAL '5 minutes'), updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'processing' AND lease_owner = ?`).run(Math.max(1, Math.min(99, Math.round(progress))), documentId, owner);
}

export async function processDocument(documentId: string, officeId: string, leaseOwner?: string) {
  const document = await findVaultDocument(officeId, documentId);
  if (!document) throw new VaultHttpError(404, "Documento não encontrado.");
  const notificationOwner = await database.prepare('SELECT created_by FROM vault_document WHERE id=? AND office_id=?')
    .get<{ created_by: string }>(documentId, officeId);
  const owner = leaseOwner ?? randomUUID();
  if (!leaseOwner) await database.prepare(`UPDATE vault_document SET status = 'processing', progress = 1, lease_owner = ?, lease_expires_at = (CURRENT_TIMESTAMP + INTERVAL '5 minutes'), error_message = NULL WHERE id = ? AND office_id = ?`).run(owner, documentId, officeId);
  const heartbeat = setInterval(() => { void checkpointVaultDocument(documentId, owner, document.progress || 1); }, 60_000);
  heartbeat.unref();
  try {
    const { extractDocumentSections } = await import("@/lib/document-extraction");
    const sections = await extractDocumentSections(await readVaultOriginal(document), document.mimeType, document.name, document.id);
    const insert = database.prepare("INSERT INTO vault_document_chunk (id, document_id, office_id, ordinal, stable_reference, content) VALUES (?, ?, ?, ?, ?, ?)");
    let ordinal = 0;
    let characters = 0;

    // The lease is checked before the batch rather than inside it, because a batch cannot decide
    // to stop partway. What still holds is the part that matters: the final UPDATE is guarded on
    // `lease_owner`, so a run whose lease was stolen mid-extraction cannot mark the document ready
    // over the new owner's work, and the new owner's own DELETE clears whatever it wrote.
    const lease = await database.prepare("SELECT 1 FROM vault_document WHERE id = ? AND office_id = ? AND status = 'processing' AND lease_owner = ? AND lease_expires_at >= CURRENT_TIMESTAMP").get(documentId, officeId, owner);
    if (!lease) throw new Error("A tarefa de processamento perdeu sua concessão.");

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
      lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND office_id = ? AND lease_owner = ?`)
      .bind(characters, ordinal, documentId, officeId, owner));
    // What the extractor saw, per run: unit counts and the extractor version, so a later
    // reindex can tell a coverage gap from a retrieval miss.
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
    await database.batch(writes);
    // Lexical search is already available at this point. Semantic indexing is durable work that
    // continues in the worker, and its absence degrades the search instead of blocking extraction.
    try {
      const { enqueueIndexJob } = await import("@/lib/knowledge/indexing");
      await enqueueIndexJob(officeId, documentId);
    } catch {
      // No embedding profile configured, or the index is unavailable: search stays lexical.
    }
  } catch (error) {
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
      // Lexical search is already available once extraction finishes.
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
