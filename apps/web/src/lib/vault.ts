import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { database } from "@/lib/database";
import { ensureOfficeForUser, type OfficeMembership } from "@/lib/offices";
import { assertStorageKey, objectStorage, StorageError } from "@/lib/storage";
import type { UploadRef } from "@/lib/application/uploads-service";

export type VaultStatus = "queued" | "processing" | "ready" | "failed";
export type VaultScope = "library" | "case";
export type VaultDocument = {
  id: string; name: string; caseId: string | null; caseName: string | null; scope: VaultScope;
  mimeType: string; byteSize: number; status: VaultStatus; progress: number; errorMessage: string | null;
  extractedCharacters: number; sourceCount: number; createdAt: string;
};
export type DocumentChunk = { id: string; documentId: string; stableReference: string; sourceLabel: string; content: string; ordinal: number };
type DocumentRow = VaultDocument & { storedName: string; officeId: string; leaseOwner: string | null; leaseExpiresAt: string | null; deletedAt: string | null };

export class VaultHttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function mapDocument(row: Record<string, unknown>): DocumentRow {
  return {
    id: String(row.id), name: String(row.name), caseId: row.caseId as string | null, caseName: row.caseName as string | null,
    scope: row.scope as VaultScope, mimeType: String(row.mimeType), byteSize: Number(row.byteSize), status: row.status as VaultStatus,
    progress: Number(row.progress), errorMessage: row.errorMessage as string | null, extractedCharacters: Number(row.extractedCharacters),
    sourceCount: Number(row.sourceCount), createdAt: String(row.createdAt), storedName: String(row.storedName), officeId: String(row.officeId),
    leaseOwner: row.leaseOwner as string | null, leaseExpiresAt: row.leaseExpiresAt as string | null,
    deletedAt: row.deletedAt as string | null,
  };
}

const documentSelect = `
  SELECT d.id, d.original_name AS name, d.case_id AS caseId, c.name AS caseName, d.scope,
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
  return { user: session.user, office: ensureOfficeForUser(database, session.user) };
}

export function requireVaultWriteRole(role: OfficeMembership["role"]) {
  if (role === "reviewer") throw new VaultHttpError(403, "Seu papel permite apenas consultar o Cofre.");
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const trusted = [process.env.BETTER_AUTH_URL ?? "http://localhost:3000", ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",") ?? [])]
    .map((value) => value.trim()).filter(Boolean);
  if (!origin || !trusted.some((value) => {
    try { return new URL(value).origin === origin; } catch { return false; }
  })) throw new VaultHttpError(403, "Origem da requisição não autorizada.");
}

export function listVaultCases(officeId: string) {
  return database.prepare("SELECT id, name, created_at AS createdAt FROM vault_case WHERE office_id = ? ORDER BY created_at DESC").all(officeId)
    // node:sqlite rows have a null prototype, which cannot cross into Client Components.
    .map((row) => ({ id: String(row.id), name: String(row.name), createdAt: String(row.createdAt) }));
}

export function createVaultCase(officeId: string, userId: string, name: string) {
  const clean = name.trim();
  if (clean.length < 2 || clean.length > 180) throw new VaultHttpError(400, "Informe um nome de caso entre 2 e 180 caracteres.");
  const id = randomUUID();
  database.prepare("INSERT INTO vault_case (id, office_id, name, created_by) VALUES (?, ?, ?, ?)").run(id, officeId, clean, userId);
  return { id, name: clean };
}

// Stored name, office and lease data stay on the server.
export function publicDocument(row: DocumentRow): VaultDocument {
  return {
    id: row.id, name: row.name, caseId: row.caseId, caseName: row.caseName, scope: row.scope,
    mimeType: row.mimeType, byteSize: row.byteSize, status: row.status, progress: row.progress,
    errorMessage: row.errorMessage, extractedCharacters: row.extractedCharacters,
    sourceCount: row.sourceCount, createdAt: row.createdAt,
  };
}

export function listVaultDocuments(
  officeId: string,
  filters: { scope?: string | null; caseId?: string | null; limit?: number; offset?: number } = {},
): VaultDocument[] {
  // A tombstoned document is invisible here, not merely marked: this list feeds the UI, the
  // agent catalog and the run scope, and each of them would otherwise keep offering deleted files.
  const where = ["d.office_id = ?", "d.deleted_at IS NULL"];
  const values: (string | number | null)[] = [officeId];
  if (filters.scope === "library" || filters.scope === "case") { where.push("d.scope = ?"); values.push(filters.scope); }
  if (filters.caseId) { where.push("d.case_id = ?"); values.push(filters.caseId); }
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  return database.prepare(`${documentSelect} WHERE ${where.join(" AND ")} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`)
    .all(...values, limit, offset).map((row) => publicDocument(mapDocument(row)));
}

export function countVaultDocuments(officeId: string, filters: { scope?: string | null; caseId?: string | null } = {}): number {
  const where = ["office_id = ?", "deleted_at IS NULL"];
  const values: (string | null)[] = [officeId];
  if (filters.scope === "library" || filters.scope === "case") { where.push("scope = ?"); values.push(filters.scope); }
  if (filters.caseId) { where.push("case_id = ?"); values.push(filters.caseId); }
  return Number(database.prepare(`SELECT count(*) AS n FROM vault_document WHERE ${where.join(" AND ")}`).get(...values)?.n ?? 0);
}

/**
 * Live documents only. Deletion has to stop every read path at once, so the default lookup
 * excludes tombstones and the cleanup worker asks for them explicitly.
 */
export function findVaultDocument(officeId: string, documentId: string): DocumentRow | undefined {
  const row = database.prepare(`${documentSelect} WHERE d.office_id = ? AND d.id = ? AND d.deleted_at IS NULL`)
    .get(officeId, documentId) as Record<string, unknown> | undefined;
  return row ? mapDocument(row) : undefined;
}

export function findVaultDocumentIncludingDeleted(officeId: string, documentId: string): DocumentRow | undefined {
  const row = database.prepare(`${documentSelect} WHERE d.office_id = ? AND d.id = ?`).get(officeId, documentId) as Record<string, unknown> | undefined;
  return row ? mapDocument(row) : undefined;
}

/**
 * Creates the document row for an upload the server already stored and validated. The storage key
 * comes from the upload reference, never from the caller, so there is no caller-controlled path.
 */
export function createVaultDocument(
  officeId: string,
  userId: string,
  upload: UploadRef,
  options: { scope: string; caseId?: string | null },
) {
  const scope: VaultScope = options.scope === "case" ? "case" : options.scope === "library" ? "library" : (() => { throw new VaultHttpError(400, "Escolha o destino do documento."); })();
  const caseId = scope === "case" ? options.caseId?.trim() : null;
  if (scope === "case" && !caseId) throw new VaultHttpError(400, "Escolha um caso para o documento.");
  if (caseId && !database.prepare("SELECT 1 FROM vault_case WHERE id = ? AND office_id = ? AND deleted_at IS NULL").get(caseId, officeId)) {
    throw new VaultHttpError(404, "Caso não encontrado.");
  }
  const id = randomUUID();
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(`INSERT INTO vault_document
      (id, office_id, case_id, scope, original_name, stored_name, mime_type, byte_size, sha256, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, officeId, caseId ?? null, scope, upload.originalName, upload.storageKey, upload.mimeType, upload.byteSize, upload.sha256, userId);
    database.prepare(`INSERT INTO vault_document_version
      (id, office_id, document_id, version, original_name, stored_name, mime_type, byte_size, sha256, created_by, is_active)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 1)`)
      .run(randomUUID(), officeId, id, upload.originalName, upload.storageKey, upload.mimeType, upload.byteSize, upload.sha256, userId);
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
  return findVaultDocument(officeId, id)!;
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
    return await objectStorage().get(key);
  } catch (error) {
    if (error instanceof StorageError && error.code === "not_found") throw new VaultHttpError(404, "Arquivo original não encontrado.");
    throw new VaultHttpError(503, "Armazenamento de documentos indisponível.");
  }
}

/** Server-only original-file access for the export workflow. Office ownership is checked first. */
export async function readVaultDocumentFile(officeId: string, documentId: string) {
  const document = findVaultDocument(officeId, documentId);
  if (!document) throw new VaultHttpError(404, "Documento não encontrado.");
  return { buffer: await readVaultOriginal(document), name: document.name, mimeType: document.mimeType };
}

export function retryVaultDocument(officeId: string, documentId: string) {
  // `deleted_at IS NULL` is the point: deletion parks the row in `failed`, which is exactly the
  // state this transition accepts, so without it a tombstone could be reprocessed back into view.
  const result = database.prepare(`UPDATE vault_document
    SET status = 'queued', progress = 0, error_message = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE office_id = ? AND id = ? AND status = 'failed' AND deleted_at IS NULL`).run(officeId, documentId);
  if (!result.changes) throw new VaultHttpError(409, "Somente documentos com falha podem ser reenviados.");
}

export function getDocumentChunks(officeId: string, documentIds: string[], query?: string): DocumentChunk[] {
  const ids = [...new Set(documentIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
  if (!ids.length) return [];
  const marks = ids.map(() => "?").join(", ");
  const allowed = database.prepare(`SELECT id, original_name AS name, status FROM vault_document WHERE office_id = ? AND deleted_at IS NULL AND id IN (${marks})`).all(officeId, ...ids) as Array<{ id: string; name: string; status: VaultStatus }>;
  if (allowed.length !== ids.length) throw new VaultHttpError(404, "Um dos documentos selecionados não está disponível neste escritório.");
  const unavailable = allowed.find((document) => document.status !== "ready");
  if (unavailable) throw new VaultHttpError(409, `O documento “${unavailable.name}” ainda não está pronto para uso.`);
  if (!query?.trim()) return database.prepare(`SELECT c.id, c.document_id AS documentId, c.stable_reference AS stableReference,
    d.original_name || ' — ' || c.stable_reference AS sourceLabel, c.content, c.ordinal
    FROM vault_document_chunk c JOIN vault_document d ON d.id = c.document_id AND d.office_id = c.office_id
    WHERE c.office_id = ? AND c.document_id IN (${marks}) ORDER BY c.document_id, c.ordinal`).all(officeId, ...ids) as DocumentChunk[];
  const terms = query.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 12) ?? [];
  if (!terms.length) return [];
  const ftsQuery = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
  return database.prepare(`SELECT c.id, c.document_id AS documentId, c.stable_reference AS stableReference,
    d.original_name || ' — ' || c.stable_reference AS sourceLabel, c.content, c.ordinal
    FROM vault_document_chunk_fts f JOIN vault_document_chunk c ON c.rowid = f.rowid
    JOIN vault_document d ON d.id = c.document_id AND d.office_id = c.office_id
    WHERE f.vault_document_chunk_fts MATCH ? AND c.office_id = ? AND c.document_id IN (${marks})
    ORDER BY bm25(vault_document_chunk_fts) LIMIT 100`).all(ftsQuery, officeId, ...ids) as DocumentChunk[];
}

export function claimQueuedDocument() {
  const owner = randomUUID();
  database.exec("BEGIN IMMEDIATE");
  try {
    const row = database.prepare(`${documentSelect} WHERE d.deleted_at IS NULL AND (d.status = 'queued' OR (d.status = 'processing' AND d.lease_expires_at < CURRENT_TIMESTAMP)) ORDER BY d.created_at LIMIT 1`).get() as Record<string, unknown> | undefined;
    if (!row) { database.exec("COMMIT"); return undefined; }
    const document = mapDocument(row);
    const changes = database.prepare(`UPDATE vault_document SET status = 'processing', progress = CASE WHEN progress > 0 THEN progress ELSE 1 END,
      lease_owner = ?, lease_expires_at = datetime('now', '+5 minutes'), error_message = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND deleted_at IS NULL AND (status = 'queued' OR (status = 'processing' AND lease_expires_at < CURRENT_TIMESTAMP))`).run(owner, document.id);
    if (!changes.changes) { database.exec("ROLLBACK"); return undefined; }
    database.exec("COMMIT");
    return { document: findVaultDocument(document.officeId, document.id)!, owner };
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

export function checkpointVaultDocument(documentId: string, owner: string, progress: number) {
  database.prepare(`UPDATE vault_document SET progress = ?, lease_expires_at = datetime('now', '+5 minutes'), updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'processing' AND lease_owner = ?`).run(Math.max(1, Math.min(99, Math.round(progress))), documentId, owner);
}

export async function processDocument(documentId: string, officeId: string, leaseOwner?: string) {
  const document = findVaultDocument(officeId, documentId);
  if (!document) throw new VaultHttpError(404, "Documento não encontrado.");
  const owner = leaseOwner ?? randomUUID();
  if (!leaseOwner) database.prepare(`UPDATE vault_document SET status = 'processing', progress = 1, lease_owner = ?, lease_expires_at = datetime('now', '+5 minutes'), error_message = NULL WHERE id = ? AND office_id = ?`).run(owner, documentId, officeId);
  const heartbeat = setInterval(() => checkpointVaultDocument(documentId, owner, document.progress || 1), 60_000);
  heartbeat.unref();
  try {
    const { extractDocumentSections } = await import("@/lib/document-extraction");
    const sections = await extractDocumentSections(await readVaultOriginal(document), document.mimeType, document.name, document.id);
    const insert = database.prepare("INSERT INTO vault_document_chunk (id, document_id, office_id, ordinal, stable_reference, content) VALUES (?, ?, ?, ?, ?, ?)");
    let ordinal = 0;
    let characters = 0;
    database.exec("BEGIN");
    try {
      const lease = database.prepare("SELECT 1 FROM vault_document WHERE id = ? AND office_id = ? AND status = 'processing' AND lease_owner = ? AND lease_expires_at >= CURRENT_TIMESTAMP").get(documentId, officeId, owner);
      if (!lease) throw new Error("A tarefa de processamento perdeu sua concessão.");
      database.prepare("DELETE FROM vault_document_chunk WHERE document_id = ? AND office_id = ?").run(documentId, officeId);
      for (const section of sections) {
        const parts = splitSection(section.content);
        for (let part = 0; part < parts.length; part++) {
          const content = parts[part];
          const stableReference = `${section.reference}${parts.length > 1 ? `#parte:${part + 1}` : ""}`;
          const chunkId = createHash("sha256").update(`${documentId}\u0000${ordinal}\u0000${stableReference}\u0000${content}`).digest("hex");
          insert.run(chunkId, documentId, officeId, ordinal++, stableReference, content);
          characters += content.length;
        }
      }
      database.prepare(`UPDATE vault_document SET status = 'ready', progress = 100, error_message = NULL, extracted_characters = ?, source_count = ?,
        lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND office_id = ? AND lease_owner = ?`).run(characters, ordinal, documentId, officeId, owner);
      // What the extractor saw, per run: unit counts and the extractor version, so a later
      // reindex can tell a coverage gap from a retrieval miss.
      database.prepare(`INSERT INTO vault_extraction_manifest (id, office_id, document_id, extractor_version, total_units, completed_units, failed_units, details)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)`)
        .run(randomUUID(), officeId, documentId, EXTRACTOR_VERSION, sections.length, sections.length, JSON.stringify({ chunks: ordinal, characters }));
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    // Lexical search is already available at this point. Semantic indexing is durable work that
    // continues in the worker, and its absence degrades the search instead of blocking extraction.
    try {
      const { enqueueIndexJob } = await import("@/lib/knowledge/indexing");
      enqueueIndexJob(officeId, documentId);
    } catch {
      // No embedding profile configured, or the index is unavailable: search stays lexical.
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Não foi possível processar este documento.";
    database.prepare(`UPDATE vault_document SET status = 'failed', error_message = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND office_id = ? AND lease_owner = ?`).run(message, documentId, officeId, owner);
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
  const claimed = claimQueuedDocument();
  if (!claimed) return false;
  await processDocument(claimed.document.id, claimed.document.officeId, claimed.owner);
  return true;
}
