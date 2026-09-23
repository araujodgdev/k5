-- Two concurrent enqueues of the same document version could both pass the NOT EXISTS check (each
-- blind to the other's uncommitted row) and queue duplicate jobs; the worker then processed one
-- while the page read the other. One active job per version is now a constraint, not a hope.
UPDATE artifact_verification v SET status = 'stale', lease_until = 0, updated_at = CURRENT_TIMESTAMP
WHERE v.status IN ('queued','running') AND EXISTS (
  SELECT 1 FROM artifact_verification newer
  WHERE newer.office_id = v.office_id AND newer.user_id = v.user_id AND newer.artifact_id = v.artifact_id
    AND newer.artifact_version = v.artifact_version AND newer.content_hash = v.content_hash
    AND newer.status IN ('queued','running') AND newer.sequence_no > v.sequence_no
);
CREATE UNIQUE INDEX artifact_verification_active ON artifact_verification(office_id, user_id, artifact_id, artifact_version, content_hash)
  WHERE status IN ('queued','running');
