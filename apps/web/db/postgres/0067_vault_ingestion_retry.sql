-- LUME-1E (docs/incidents/2026-09-29-vault-ingestion.md): a deploy reset the processor's Durable
-- Object while a container was still reading two originals, the binding answered 403 and both
-- documents became terminal failures. A storage outage is transient, so ingestion now returns the
-- document to the queue a few times, waiting `retry_at` between attempts, before giving up.
ALTER TABLE vault_document
  ADD COLUMN ingestion_attempts INTEGER NOT NULL DEFAULT 0 CHECK (ingestion_attempts >= 0),
  ADD COLUMN retry_at TIMESTAMPTZ;
