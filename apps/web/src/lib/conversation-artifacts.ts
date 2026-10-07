import 'server-only';
import { artifactPolicy, assertPolicyAccess } from './content-policy';
import { CapabilityError } from './capabilities/errors';
import { database } from './database';
import type { Owner } from './ai-store';

/** A Vault copy made from something in this conversation. */
export type VaultCopy = {
  documentId: string; name: string; scope: 'library' | 'case'; caseId: string | null; caseName: string | null;
  folderId: string | null; status: string; format: 'pdf' | 'docx' | null; version: number | null; href: string;
};
export type ConversationDocument = { id: string; title: string; version: number; updatedAt: string; createdByAgent: boolean; copies: VaultCopy[] };
export type ConversationAttachment = { id: string; name: string; mediaType: string; byteSize: number; createdAt: string; url: string; copies: VaultCopy[] };
export type ConversationArtifacts = { documents: ConversationDocument[]; attachments: ConversationAttachment[] };

const iso = (value: unknown) => new Date(value as string).toISOString();

/**
 * What the Lume created or received in one conversation: its documents, the files sent in its
 * messages, and the Vault copies made of either. Everything is scoped to the session's person and
 * office; a copy in a shared case is listed only while the person still takes part in that case.
 */
export async function conversationArtifacts(owner: Owner, conversationId: string): Promise<ConversationArtifacts | null> {
  const found = await database.prepare('SELECT 1 FROM ai_conversation WHERE id=? AND office_id=? AND user_id=?').get(conversationId, owner.officeId, owner.userId);
  if (!found) return null;
  const [documents, attachments] = await Promise.all([
    database.prepare(`SELECT id,title,version,updated_at AS "updatedAt",created_by_agent AS "createdByAgent" FROM ai_artifact
      WHERE conversation_id=? AND office_id=? AND user_id=? AND kind='document' ORDER BY created_at, id`)
      .all<{ id: string; title: string; version: number; updatedAt: string; createdByAgent: boolean }>(conversationId, owner.officeId, owner.userId),
    database.prepare(`SELECT id,name,media_type AS "mediaType",byte_size AS "byteSize",created_at AS "createdAt" FROM ai_chat_attachment
      WHERE conversation_id=? AND office_id=? AND user_id=? AND message_id IS NOT NULL ORDER BY created_at, id`)
      .all<{ id: string; name: string; mediaType: string; byteSize: number; createdAt: string }>(conversationId, owner.officeId, owner.userId),
  ]);
  const visible = [];
  for (const row of documents) {
    try { await assertPolicyAccess(owner.userId, await artifactPolicy(owner, row.id)); visible.push(row); }
    catch (error) { if (!(error instanceof CapabilityError && error.code === 'NOT_FOUND')) throw error; }
  }
  const sources = [...visible.map(row => row.id), ...attachments.map(row => row.id)];
  const copies = new Map<string, VaultCopy[]>();
  if (sources.length) {
    const marks = sources.map(() => '?').join(',');
    const rows = await database.prepare(`SELECT o.source_id AS "sourceId", o.source_kind AS "kind", o.source_version AS "version",
        d.id AS "documentId", d.original_name AS "name", d.scope, d.case_id AS "caseId", c.name AS "caseName", d.folder_id AS "folderId", d.status
      FROM vault_agent_origin o
      JOIN vault_document d ON d.id=o.document_id AND d.deleted_at IS NULL
      LEFT JOIN vault_case c ON c.id=d.case_id AND c.office_id=d.office_id
      WHERE o.user_id=? AND o.source_id IN (${marks}) AND lume_vault_visible(d.id, ?)
        AND (d.office_id=? OR EXISTS (SELECT 1 FROM case_participant p WHERE p.case_id=d.case_id AND p.office_id=d.office_id AND p.user_id=? AND p.revoked_at IS NULL))
      ORDER BY o.created_at, d.id`)
      .all<{ sourceId: string; kind: string; version: number | null; documentId: string; name: string; scope: 'library' | 'case'; caseId: string | null; caseName: string | null; folderId: string | null; status: string }>(
        owner.userId, ...sources, owner.userId, owner.officeId, owner.userId);
    for (const row of rows) {
      const query = row.folderId ? `?folder=${encodeURIComponent(row.folderId)}` : '';
      const copy: VaultCopy = {
        documentId: row.documentId, name: row.name, scope: row.scope, caseId: row.caseId, caseName: row.caseName, folderId: row.folderId, status: row.status,
        format: row.kind === 'artifact_pdf' ? 'pdf' : row.kind === 'artifact_docx' ? 'docx' : null, version: row.version,
        href: row.caseId ? `/app/vault/cases/${encodeURIComponent(row.caseId)}${query}` : '/app/vault/library',
      };
      copies.set(row.sourceId, [...(copies.get(row.sourceId) ?? []), copy]);
    }
  }
  return {
    documents: visible.map(row => ({ ...row, updatedAt: iso(row.updatedAt), createdByAgent: Boolean(row.createdByAgent), copies: copies.get(row.id) ?? [] })),
    attachments: attachments.map(row => ({ ...row, byteSize: Number(row.byteSize), createdAt: iso(row.createdAt), url: `/api/chat/attachments/${row.id}`, copies: copies.get(row.id) ?? [] })),
  };
}
