import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { database } from "@/lib/database";
import { ensureOfficeForUser, type OfficeMembership } from "@/lib/offices";

export type VaultStatus = "queued" | "processing" | "ready" | "failed";
export type VaultScope = "library" | "case";
export type VaultDocument = {
  id: string; name: string; caseId: string | null; caseName: string | null; scope: VaultScope;
  mimeType: string; byteSize: number; status: VaultStatus; progress: number; errorMessage: string | null;
  extractedCharacters: number; sourceCount: number; createdAt: string;
};
export type DocumentChunk = { id: string; documentId: string; stableReference: string; sourceLabel: string; content: string; ordinal: number };
type DocumentRow = VaultDocument & { storedName: string; officeId: string; leaseOwner: string | null; leaseExpiresAt: string | null };

const ALLOWED_EXTENSIONS: Record<string, string> = {
  ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".eml": "message/rfc822", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv", ".txt": "text/plain",
};
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const UPLOAD_DIRECTORY = resolve(process.cwd(), ".data", "uploads");

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
  };
}

const documentSelect = `
  SELECT d.id, d.original_name AS name, d.case_id AS caseId, c.name AS caseName, d.scope,
    d.mime_type AS mimeType, d.byte_size AS byteSize, d.status, d.progress,
    d.error_message AS errorMessage, d.extracted_characters AS extractedCharacters,
    d.source_count AS sourceCount, d.created_at AS createdAt, d.stored_name AS storedName,
    d.office_id AS officeId, d.lease_owner AS leaseOwner, d.lease_expires_at AS leaseExpiresAt
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
function publicDocument(row: DocumentRow): VaultDocument {
  return {
    id: row.id, name: row.name, caseId: row.caseId, caseName: row.caseName, scope: row.scope,
    mimeType: row.mimeType, byteSize: row.byteSize, status: row.status, progress: row.progress,
    errorMessage: row.errorMessage, extractedCharacters: row.extractedCharacters,
    sourceCount: row.sourceCount, createdAt: row.createdAt,
  };
}

export function listVaultDocuments(officeId: string, filters: { scope?: string | null; caseId?: string | null } = {}): VaultDocument[] {
  const where = ["d.office_id = ?"];
  const values: (string | null)[] = [officeId];
  if (filters.scope === "library" || filters.scope === "case") { where.push("d.scope = ?"); values.push(filters.scope); }
  if (filters.caseId) { where.push("d.case_id = ?"); values.push(filters.caseId); }
  return database.prepare(`${documentSelect} WHERE ${where.join(" AND ")} ORDER BY d.created_at DESC`).all(...values).map((row) => publicDocument(mapDocument(row)));
}

export function findVaultDocument(officeId: string, documentId: string): DocumentRow | undefined {
  const row = database.prepare(`${documentSelect} WHERE d.office_id = ? AND d.id = ?`).get(officeId, documentId) as Record<string, unknown> | undefined;
  return row ? mapDocument(row) : undefined;
}

function validatedFileName(fileName: string) {
  const file = basename(fileName).replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").trim();
  const extension = extname(file).toLowerCase();
  if (extension === ".msg") throw new VaultHttpError(400, "Arquivos .msg ainda não são compatíveis. Exporte o e-mail como .eml.");
  const mimeType = ALLOWED_EXTENSIONS[extension];
  if (!mimeType) throw new VaultHttpError(400, "Envie PDF, DOCX, EML, XLSX, CSV ou TXT.");
  if (!file) throw new VaultHttpError(400, "O arquivo precisa ter um nome válido.");
  return { file, extension, mimeType };
}

export async function createVaultDocument(officeId: string, userId: string, options: { file: File; scope: string; caseId?: string | null }) {
  const { file, extension, mimeType } = validatedFileName(options.file.name);
  if (options.file.size <= 0) throw new VaultHttpError(400, "O arquivo está vazio.");
  if (options.file.size > MAX_UPLOAD_BYTES) throw new VaultHttpError(400, "O arquivo excede o limite de 50 MB.");
  const scope: VaultScope = options.scope === "case" ? "case" : options.scope === "library" ? "library" : (() => { throw new VaultHttpError(400, "Escolha o destino do documento."); })();
  const caseId = scope === "case" ? options.caseId?.trim() : null;
  if (scope === "case" && !caseId) throw new VaultHttpError(400, "Escolha um caso para o documento.");
  if (caseId && !database.prepare("SELECT 1 FROM vault_case WHERE id = ? AND office_id = ?").get(caseId, officeId)) throw new VaultHttpError(404, "Caso não encontrado.");
  const data = Buffer.from(await options.file.arrayBuffer());
  const id = randomUUID();
  const storedName = `${id}${extension}`;
  await mkdir(UPLOAD_DIRECTORY, { recursive: true });
  await writeFile(resolve(UPLOAD_DIRECTORY, storedName), data, { flag: "wx", mode: 0o600 });
  try {
    database.prepare(`INSERT INTO vault_document
      (id, office_id, case_id, scope, original_name, stored_name, mime_type, byte_size, sha256, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, officeId, caseId ?? null, scope, file, storedName, mimeType, data.byteLength, createHash("sha256").update(data).digest("hex"), userId);
  } catch (error) {
    await unlink(resolve(UPLOAD_DIRECTORY, storedName)).catch(() => undefined);
    throw error;
  }
  return findVaultDocument(officeId, id)!;
}

export async function readVaultOriginal(document: Pick<DocumentRow, "storedName">) {
  return readFile(resolve(UPLOAD_DIRECTORY, document.storedName));
}

/** Server-only original-file access for the export workflow. Office ownership is checked first. */
export async function readVaultDocumentFile(officeId: string, documentId: string) {
  const document = findVaultDocument(officeId, documentId);
  if (!document) throw new VaultHttpError(404, "Documento não encontrado.");
  return { buffer: await readVaultOriginal(document), name: document.name, mimeType: document.mimeType };
}

export function retryVaultDocument(officeId: string, documentId: string) {
  const result = database.prepare(`UPDATE vault_document
    SET status = 'queued', progress = 0, error_message = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE office_id = ? AND id = ? AND status = 'failed'`).run(officeId, documentId);
  if (!result.changes) throw new VaultHttpError(409, "Somente documentos com falha podem ser reenviados.");
}

export function getDocumentChunks(officeId: string, documentIds: string[], query?: string): DocumentChunk[] {
  const ids = [...new Set(documentIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
  if (!ids.length) return [];
  const marks = ids.map(() => "?").join(", ");
  const allowed = database.prepare(`SELECT id, original_name AS name, status FROM vault_document WHERE office_id = ? AND id IN (${marks})`).all(officeId, ...ids) as Array<{ id: string; name: string; status: VaultStatus }>;
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
    const row = database.prepare(`${documentSelect} WHERE (d.status = 'queued' OR (d.status = 'processing' AND d.lease_expires_at < CURRENT_TIMESTAMP)) ORDER BY d.created_at LIMIT 1`).get() as Record<string, unknown> | undefined;
    if (!row) { database.exec("COMMIT"); return undefined; }
    const document = mapDocument(row);
    const changes = database.prepare(`UPDATE vault_document SET status = 'processing', progress = CASE WHEN progress > 0 THEN progress ELSE 1 END,
      lease_owner = ?, lease_expires_at = datetime('now', '+5 minutes'), error_message = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND (status = 'queued' OR (status = 'processing' AND lease_expires_at < CURRENT_TIMESTAMP))`).run(owner, document.id);
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
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
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
