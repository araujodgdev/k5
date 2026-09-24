-- Lume's AI connections move from each office to the platform, the way TypeSafe did in 0005:
-- one set of providers and task models serves every office, configured once by the platform
-- administrator. A platform connection is an ai_connection row without an office.
ALTER TABLE ai_connection ALTER COLUMN office_id DROP NOT NULL;
-- (office_id, name) stays unique per office; platform names are unique among themselves.
CREATE UNIQUE INDEX ai_connection_platform_name ON ai_connection(name) WHERE office_id IS NULL;

-- Adoption: the connections of the office configured most recently become the platform's, so
-- nothing stops answering at deploy. The key is copied as ciphertext (it is not bound to the
-- office). The per-office rows stay on record and keep being re-encrypted on key rotation, but
-- nothing reads them any more.
WITH source AS (
  SELECT office_id FROM ai_connection
  WHERE office_id IS NOT NULL AND deleted_at IS NULL AND encrypted_api_key IS NOT NULL
  ORDER BY enabled DESC, updated_at DESC, id
  LIMIT 1
)
INSERT INTO ai_connection
  (id, office_id, name, provider, encrypted_api_key, api_key_hint, chat_model, extraction_model, drafting_model, embedding_model, enabled)
SELECT gen_random_uuid()::text, NULL, c.name, c.provider, c.encrypted_api_key, c.api_key_hint,
  c.chat_model, c.extraction_model, c.drafting_model, c.embedding_model, c.enabled
FROM ai_connection c JOIN source s ON c.office_id = s.office_id
WHERE c.deleted_at IS NULL AND c.encrypted_api_key IS NOT NULL;
