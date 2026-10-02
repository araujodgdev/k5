import 'server-only';
import { database } from './database';
import { CapabilityError } from './capabilities/errors';
import type { WorkspaceContext } from './application/context';

/**
 * The Word template generated documents are exported with when they have none of their own: the
 * person's, else the legacy office setting. Choosing or removing the model replaces both
 * settings, so a hidden legacy model cannot reappear. The Cofre document keeps owning the bytes.
 */

export type TemplateScope = 'office' | 'personal';
export type TemplateView = { documentId: string; name: string; status: string; updatedAt: string };
type Owner = Pick<WorkspaceContext, 'officeId' | 'userId'>;

const OFFICE = '';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const isDocx = (name: string, mimeType: string) => mimeType === DOCX_MIME || name.toLowerCase().endsWith('.docx');

// Deleted and foreign documents never come back from here: the join carries both conditions.
const select = `SELECT t.user_id AS "scopeUser", t.document_id AS "documentId", d.original_name AS name, d.status,
  d.mime_type AS "mimeType", t.updated_at AS "updatedAt"
  FROM agent_document_template t JOIN vault_document d ON d.id = t.document_id AND d.office_id = t.office_id
  WHERE t.office_id = ? AND t.user_id IN (?, ?) AND d.deleted_at IS NULL AND vault_folder_visible(d.folder_id, ?)`;
type Row = { scopeUser: string; documentId: string; name: string; status: string; mimeType: string; updatedAt: string };

async function rows(owner: Owner) {
  return (await database.prepare(select).all(owner.officeId, OFFICE, owner.userId, owner.userId) as Row[])
    .filter(row => isDocx(row.name, row.mimeType));
}
const view = (row: Row | undefined): TemplateView | null =>
  row ? { documentId: row.documentId, name: row.name, status: row.status, updatedAt: row.updatedAt } : null;

export async function documentTemplates(owner: Owner) {
  const found = await rows(owner);
  return { office: view(found.find(row => row.scopeUser === OFFICE)), personal: view(found.find(row => row.scopeUser === owner.userId)) };
}

/** Personal settings take precedence over an existing legacy office template. */
export async function resolveDocumentTemplateId(owner: Owner): Promise<string | undefined> {
  const { office, personal } = await documentTemplates(owner);
  return (personal ?? office)?.documentId;
}


export async function setDocumentTemplate(context: WorkspaceContext, scope: TemplateScope, documentId: string | null) {
  const userId = scope === 'office' ? OFFICE : context.userId;
  if (!documentId) {
    await database.prepare('DELETE FROM agent_document_template WHERE office_id = ? AND user_id IN (?, ?)').run(context.officeId, OFFICE, context.userId);
    return documentTemplates(context);
  }
  // The office id comes from the session; a document id from another office simply is not found.
  const document = await database.prepare(`SELECT original_name AS name, mime_type AS "mimeType" FROM vault_document
    WHERE id = ? AND office_id = ? AND deleted_at IS NULL AND vault_folder_visible(folder_id, ?)`).get(documentId, context.officeId, context.userId) as { name: string; mimeType: string } | undefined;
  if (!document) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado no Cofre.');
  if (!isDocx(document.name, document.mimeType)) throw new CapabilityError('INVALID', 'Envie o modelo em Word (.docx).');
  await database.batch([
    database.prepare('DELETE FROM agent_document_template WHERE office_id = ? AND user_id IN (?, ?)').bind(context.officeId, OFFICE, context.userId),
    database.prepare(`INSERT INTO agent_document_template (office_id, user_id, document_id, updated_by, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`).bind(context.officeId, userId, documentId, context.userId),
  ]);
  return documentTemplates(context);
}

export type TemplateCandidate = { id: string; name: string; status: string; caseName: string | null };

/** Word files in the Cofre that can become a template, newest first. */
export async function templateCandidates(owner: Owner): Promise<TemplateCandidate[]> {
  return await database.prepare(`SELECT d.id, d.original_name AS name, d.status, c.name AS "caseName"
    FROM vault_document d LEFT JOIN vault_case c ON c.id = d.case_id AND c.office_id = d.office_id
    WHERE d.office_id = ? AND d.deleted_at IS NULL AND vault_folder_visible(d.folder_id, ?) AND (d.mime_type = ? OR lower(d.original_name) LIKE '%.docx')
    ORDER BY d.created_at DESC LIMIT 100`).all(owner.officeId, owner.userId, DOCX_MIME) as TemplateCandidate[];
}
