-- A person's request to delete their office and account (src/lib/office-deletion.ts). The request
-- outlives the office on purpose: it is the record that the deletion was asked for and carried out,
-- so it has no foreign key that would take it along with the data it describes.
CREATE TABLE office_deletion_request (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'cancelled', 'completed')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  scheduled_for TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  -- Counts per table and the storage objects queued, written when the purge runs.
  report_json TEXT
);
CREATE UNIQUE INDEX office_deletion_request_open ON office_deletion_request(office_id) WHERE status = 'scheduled';
