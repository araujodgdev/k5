-- The model that answers is the person's choice in the composer, not an office setting. A run is
-- durable and may start hours before a worker picks it up, so the choice travels with the row
-- instead of being re-resolved from whatever the office happens to have configured later.
ALTER TABLE ai_run ADD COLUMN model_provider TEXT;
ALTER TABLE ai_run ADD COLUMN model_id TEXT;

-- Per-task model assignments were a platform-admin setting and no longer are: K5 supplies the
-- embedding model, and the person supplies the conversation model. Clearing them here is what
-- keeps an old assignment from silently overriding both.
UPDATE ai_connection SET chat_model = NULL, extraction_model = NULL, drafting_model = NULL, embedding_model = NULL WHERE deleted_at IS NULL;
