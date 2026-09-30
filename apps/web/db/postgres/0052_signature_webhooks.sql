ALTER TABLE signature_connection ADD COLUMN encrypted_webhook_secret TEXT;
ALTER TABLE signature_connection ADD COLUMN webhook_secret_hash TEXT UNIQUE;
ALTER TABLE signature_connection ADD CONSTRAINT signature_webhook_secret_pair CHECK((encrypted_webhook_secret IS NULL)=(webhook_secret_hash IS NULL));
ALTER TABLE signature_event ALTER COLUMN actor_user_id DROP NOT NULL;
CREATE TABLE signature_webhook_job (
  request_id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  provider_token TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  generation BIGINT NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','done','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_token TEXT,
  lease_until TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(office_id,request_id) REFERENCES signature_request(office_id,id)
);
CREATE INDEX signature_webhook_due ON signature_webhook_job(run_after) WHERE state IN ('pending','leased');
