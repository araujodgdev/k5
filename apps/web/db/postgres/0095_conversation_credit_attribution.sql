CREATE TABLE billing_origin (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id),
  user_id TEXT NOT NULL REFERENCES "user"(id),
  conversation_id TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(office_id,user_id,conversation_id)
);
CREATE TABLE conversation_credit_tracking (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO conversation_credit_tracking(singleton) VALUES(true);
ALTER TABLE credit_entry ADD COLUMN conversation_id TEXT;
ALTER TABLE credit_entry ADD COLUMN billing_origin_id TEXT REFERENCES billing_origin(id);
ALTER TABLE ai_usage ADD COLUMN conversation_id TEXT;
ALTER TABLE ai_usage ADD COLUMN billing_origin_id TEXT REFERENCES billing_origin(id);
ALTER TABLE ai_run ADD COLUMN billing_origin_id TEXT REFERENCES billing_origin(id);
ALTER TABLE vault_document ADD COLUMN billing_origin_id TEXT REFERENCES billing_origin(id);
CREATE INDEX credit_entry_conversation ON credit_entry(office_id,user_id,conversation_id) WHERE conversation_id IS NOT NULL;
