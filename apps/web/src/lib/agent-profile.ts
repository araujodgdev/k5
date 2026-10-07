import 'server-only';
import { documentTransaction } from './documents/service';
import { database } from './database';
import { observeVaultFile } from './content-policy';
import { contentResult, mapContentResult } from './content-result';
import { CapabilityError } from './capabilities/errors';
import type { WorkspaceContext } from './application/context';

/**
 * The Word template generated documents are exported with when they have none of their own: the
 * person's, else the legacy office setting. Choosing or removing the model replaces both
 * settings, so a hidden legacy model cannot reappear. The Cofre document keeps owning the bytes.
 */

export type TemplateScope = 'office' | 'personal';
export type TemplateView = { documentId: string; name: string; status: string; updatedAt: string };
type Owner = Pick<WorkspaceContext, 'officeId' | 'userId' | 'contentTransaction'>;

const OFFICE = '';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const isDocx = (name: string, mimeType: string) => mimeType === DOCX_MIME || name.toLowerCase().endsWith('.docx');

const select = `SELECT t.user_id AS "scopeUser", t.document_id AS "documentId", d.original_name AS name, d.status,
  d.mime_type AS "mimeType", t.updated_at AS "updatedAt"
  FROM agent_document_template t JOIN vault_document d ON d.id = t.document_id AND d.office_id = t.office_id
  WHERE t.office_id = ? AND t.user_id IN (?, ?) AND d.deleted_at IS NULL AND lume_vault_visible(d.id, ?)`;
type Row = { scopeUser: string; documentId: string; name: string; status: string; mimeType: string; updatedAt: string };

async function rows(owner: Owner) {
  return (await ((owner as WorkspaceContext).contentTransaction ?? database).prepare(select).all(owner.officeId, OFFICE, owner.userId, owner.userId) as Row[])
    .filter(row => isDocx(row.name, row.mimeType));
}
const view = (row: Row | undefined): TemplateView | null =>
  row ? { documentId: row.documentId, name: row.name, status: row.status, updatedAt: row.updatedAt } : null;

export async function documentTemplates(owner: Owner) {
  const found = await rows(owner);
  const selected = await Promise.all([OFFICE, owner.userId].map(async scope => {
    const row = found.find(row => row.scopeUser === scope);
    if (!row) return null;
    const file = await observeVaultFile(owner.userId, row.documentId, owner.contentTransaction ?? database);
    return contentResult(view(row)!, [file.policy], [{ kind: 'document', id: row.documentId, version: file.version, digest: file.sha256 }]);
  }));
  return mapContentResult({ office: selected[0], personal: selected[1] }, ...selected);
}

/** Personal settings take precedence over an existing legacy office template. */
export async function resolveDocumentTemplateId(owner: Owner): Promise<string | undefined> {
  const row = await database.prepare('SELECT document_id FROM agent_document_template WHERE office_id=? AND user_id IN (?,?) ORDER BY (user_id=?) DESC LIMIT 1')
    .get<{ document_id: string }>(owner.officeId, owner.userId, OFFICE, owner.userId);
  return row?.document_id;
}

export async function setDocumentTemplate(context: WorkspaceContext, scope: TemplateScope, documentId: string | null) {
  return documentTransaction(context, async tx => {
  const userId = scope === 'office' ? OFFICE : context.userId;
  if (!documentId) {
    await tx.prepare('DELETE FROM agent_document_template WHERE office_id = ? AND user_id IN (?, ?)').run(context.officeId, OFFICE, context.userId);
    return documentTemplates({ ...context, contentTransaction: tx });
  }

  const document = await tx.prepare(`SELECT original_name AS name, mime_type AS "mimeType" FROM vault_document
    WHERE id = ? AND office_id = ? AND deleted_at IS NULL AND lume_vault_visible(id, ?)`).get(documentId, context.officeId, context.userId) as { name: string; mimeType: string } | undefined;
  if (!document) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado no Cofre.');
  if (!isDocx(document.name, document.mimeType)) throw new CapabilityError('INVALID', 'Envie o modelo em Word (.docx).');
  await tx.prepare('DELETE FROM agent_document_template WHERE office_id=? AND user_id IN (?,?)').run(context.officeId, OFFICE, context.userId);
  await tx.prepare('INSERT INTO agent_document_template(office_id,user_id,document_id,updated_by) VALUES(?,?,?,?)').run(context.officeId, userId, documentId, context.userId);
  return documentTemplates({ ...context, contentTransaction: tx });
  });
}

export type TemplateCandidate = { id: string; name: string; status: string; caseName: string | null };

/** Word files in the Cofre that can become a template, newest first. */
export async function templateCandidates(owner: Owner): Promise<TemplateCandidate[]> {
  return await database.prepare(`SELECT d.id, d.original_name AS name, d.status, c.name AS "caseName"
    FROM vault_document d LEFT JOIN vault_case c ON c.id = d.case_id AND c.office_id = d.office_id
    WHERE d.office_id = ? AND d.deleted_at IS NULL AND lume_vault_visible(d.id, ?) AND (d.mime_type = ? OR lower(d.original_name) LIKE '%.docx')
    ORDER BY d.created_at DESC LIMIT 100`).all(owner.officeId, owner.userId, DOCX_MIME) as TemplateCandidate[];
}
