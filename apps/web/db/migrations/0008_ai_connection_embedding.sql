-- Embeddings are a fourth model profile with its own model and dimension, never inherited from
-- chat: the index generation pins both, so the profile has to be chosen deliberately per office.
ALTER TABLE ai_connection ADD COLUMN embedding_model TEXT;
