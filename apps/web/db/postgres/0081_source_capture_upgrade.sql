ALTER TABLE content_submission ADD COLUMN input_format INTEGER NOT NULL DEFAULT 1;

UPDATE vault_document SET status='queued',progress=0,lease_owner=NULL,lease_expires_at=NULL,
  error_message=NULL,updated_at=CURRENT_TIMESTAMP
WHERE deleted_at IS NULL AND status='ready' AND (extracted_version IS NULL OR extracted_sha256 IS NULL);

UPDATE capability_approval SET status='cancelled'
WHERE status IN ('pending','approved') AND id IN (
  SELECT a.approval_id FROM content_generation_attempt a JOIN content_submission s ON s.id=a.submission_id
  WHERE s.input_format=1
);
