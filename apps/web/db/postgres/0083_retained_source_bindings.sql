ALTER TABLE content_generation_attempt ADD COLUMN office_id TEXT REFERENCES office(id);
UPDATE content_generation_attempt a SET office_id=s.office_id FROM content_submission s WHERE s.id=a.submission_id;
ALTER TABLE content_generation_attempt ALTER COLUMN office_id SET NOT NULL;
ALTER TABLE content_generation_attempt DROP CONSTRAINT content_generation_attempt_submission_id_fkey;
ALTER TABLE content_generation_attempt ADD FOREIGN KEY(submission_id) REFERENCES content_submission(id) ON DELETE CASCADE;
ALTER TABLE content_generation_attempt DROP CONSTRAINT content_generation_attempt_approval_id_fkey;
ALTER TABLE content_generation_attempt ADD FOREIGN KEY(approval_id) REFERENCES capability_approval(id) ON DELETE SET NULL;

CREATE TABLE annex_plan (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id),
  user_id TEXT NOT NULL REFERENCES "user"(id),
  case_id TEXT NOT NULL REFERENCES vault_case(id) ON DELETE CASCADE,
  scan_document_id TEXT NOT NULL REFERENCES vault_document(id) ON DELETE CASCADE,
  scan_version INTEGER NOT NULL,
  scan_sha256 TEXT NOT NULL,
  petition_policy JSONB NOT NULL,
  content_policy JSONB NOT NULL,
  plan JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(scan_document_id,scan_version) REFERENCES vault_document_version(document_id,version)
);
CREATE INDEX annex_plan_owner_scan ON annex_plan(office_id,user_id,case_id,scan_document_id,created_at DESC);

ALTER TABLE capability_idempotency ADD COLUMN replay_binding JSONB;
ALTER TABLE capability_idempotency ADD COLUMN state TEXT NOT NULL DEFAULT 'completed' CHECK(state IN ('pending','completed','unknown'));
ALTER TABLE capability_idempotency ALTER COLUMN response_payload DROP NOT NULL;
