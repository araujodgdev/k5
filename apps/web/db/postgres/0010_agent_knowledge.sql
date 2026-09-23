-- Reference documents the Lume consults: an office's, and each person's own. They point at Cofre
-- documents, which keep owning the bytes, the extraction and the index. 'always' puts the text in
-- the prompt, within a budget; 'search' only names the document so the model looks it up.
CREATE TABLE agent_knowledge (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  -- NULL is office knowledge; a user id is that person's own.
  user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES vault_document(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('always','search')),
  -- When to use it, in the office's words; it reaches the prompt next to the document name.
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  version BIGINT NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX agent_knowledge_unique ON agent_knowledge(office_id, COALESCE(user_id, ''), document_id);
CREATE INDEX agent_knowledge_document ON agent_knowledge(document_id);
