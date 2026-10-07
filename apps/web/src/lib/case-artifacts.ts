import 'server-only';
import { type Transaction } from './database';
import { aclReadTransaction } from './acl-transaction';
import { caseAccess } from './collaboration/access';
import { artifactPolicy, assertPolicyAccess } from './content-policy';
import { CapabilityError } from './capabilities/errors';
import type { Owner } from './ai-store';

export type CaseArtifact = { id: string; title: string; version: number; href: string; place: 'private' | 'vault'; conversationId?: string | null };

export async function caseArtifacts(owner: Owner, caseId: string, tx?: Transaction): Promise<CaseArtifact[]> {
  if (!tx) return aclReadTransaction(reader => caseArtifacts(owner, caseId, reader));
  const access = await caseAccess(owner.userId, caseId, tx);
  const originals = await tx.prepare(`SELECT a.id,a.title,a.version,a.conversation_id AS "conversationId" FROM ai_artifact a
    WHERE a.office_id=? AND a.user_id=? AND (
      EXISTS (SELECT 1 FROM jsonb_array_elements(a.content_policy->'guards') g
        WHERE g->>'caseId'=? OR (g->>'kind'='case' AND g->>'id'=?)
          OR (g->>'kind'='document' AND EXISTS (SELECT 1 FROM vault_document source WHERE source.id=g->>'id' AND source.case_id=?)))
      OR EXISTS (SELECT 1 FROM vault_agent_origin o JOIN vault_document d ON d.id=o.document_id
        WHERE o.source_id=a.id AND o.user_id=? AND o.source_kind IN ('artifact_pdf','artifact_docx')
          AND d.case_id=? AND d.deleted_at IS NULL AND lume_vault_visible(d.id,?)))
    ORDER BY a.updated_at DESC`).all<{ id: string; title: string; version: number; conversationId: string | null }>(owner.officeId, owner.userId, caseId, caseId, caseId, owner.userId, caseId, owner.userId);
  const items: CaseArtifact[] = [];
  for (const row of originals) {
    try {
      await assertPolicyAccess(owner.userId, await artifactPolicy(owner, row.id, tx), tx);
      items.push({ ...row, href: `/app/documents/${encodeURIComponent(row.id)}`, place: 'private' });
    } catch (error) { if (!(error instanceof CapabilityError && error.code === 'NOT_FOUND')) throw error; }
  }
  const copies = await tx.prepare(`SELECT d.id,d.original_name AS title,
      (SELECT o.source_version FROM vault_agent_origin o WHERE o.document_id=d.id) AS version
    FROM vault_document d WHERE d.office_id=? AND d.case_id=? AND d.deleted_at IS NULL
      AND lume_vault_visible(d.id,?) AND EXISTS (SELECT 1 FROM vault_agent_origin o
        WHERE o.document_id=d.id AND o.source_kind IN ('artifact_pdf','artifact_docx'))
    ORDER BY d.updated_at DESC`).all<{ id: string; title: string; version: number }>(access.officeId, caseId, owner.userId);
  return [...items, ...copies.map(row => ({ ...row, href: `/app/vault/files/${encodeURIComponent(row.id)}`, place: 'vault' as const }))];
}
