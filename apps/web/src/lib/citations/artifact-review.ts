import 'server-only';
import { database } from '@/lib/database';
import type { ArtifactRow } from '@/lib/ai-store';
import { reviewCitations, type CitationReview } from './review';
import { conversationSources } from './sources';
import { needsReview, type CitationItem } from './verdict';

type Owner = { officeId: string; userId: string };
export type CitationSummary = { status: CitationReview['status']; total: number; toReview: number; noSource: number };
export type StoredCitationReview = CitationReview & { artifactVersion: number; createdAt: string };

export const summarize = (review: CitationReview): CitationSummary => ({
  status: review.status, total: review.items.length,
  toReview: review.items.filter(needsReview).length, noSource: review.items.filter(item => item.status === 'no_source').length,
});

/**
 * Checks a document's citations against what its conversation consulted and keeps the result for
 * that version. Bounded, so an agent's write never waits long on it: past the deadline the batches
 * still running come back unchecked and the document says so.
 */
export async function reviewArtifactCitations(owner: Owner, artifact: ArtifactRow, options: { conversationId?: string | null; signal?: AbortSignal } = {}) {
  const sources = await conversationSources(owner, artifact.conversation_id ?? options.conversationId);
  const signal = AbortSignal.any([AbortSignal.timeout(20_000), ...(options.signal ? [options.signal] : [])]);
  const review = await reviewCitations(owner, artifact.content, sources, { signal });
  await database.prepare(`INSERT INTO artifact_citation_review(artifact_id,office_id,user_id,artifact_version,status,items,mentions)
    SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM ai_artifact WHERE id=? AND office_id=? AND user_id=? AND version=?)
    ON CONFLICT (artifact_id) DO UPDATE SET artifact_version=excluded.artifact_version,status=excluded.status,items=excluded.items,
      mentions=excluded.mentions,created_at=CURRENT_TIMESTAMP
    WHERE artifact_citation_review.artifact_version <= excluded.artifact_version`)
    .run(artifact.id, owner.officeId, owner.userId, artifact.version, review.status, JSON.stringify(review.items), review.mentions,
      artifact.id, owner.officeId, owner.userId, artifact.version);
  return summarize(review);
}

export async function storedCitationReview(owner: Owner, artifactId: string): Promise<StoredCitationReview | null> {
  const row = await database.prepare(`SELECT artifact_version AS "artifactVersion", status, items, mentions, created_at AS "createdAt"
    FROM artifact_citation_review WHERE artifact_id=? AND office_id=? AND user_id=?`).get(artifactId, owner.officeId, owner.userId) as
    { artifactVersion: number; status: CitationReview['status']; items: string; mentions: number; createdAt: string } | undefined;
  return row ? { ...row, items: JSON.parse(row.items) as CitationItem[] } : null;
}
