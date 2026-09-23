-- What the Lume consulted in a conversation: web case law, web pages and Cofre excerpts. Citations
-- in its answers and documents are checked against these, not against the model's memory.
CREATE TABLE conversation_source (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES ai_conversation(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('web_jurisprudence','web','vault')),
  -- The URL for web sources, the chunk id for the Cofre; one row per source per conversation.
  ref TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  url TEXT,
  court TEXT,
  case_number TEXT,
  text TEXT NOT NULL DEFAULT '' CHECK (length(text) <= 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (conversation_id, kind, ref)
);
CREATE INDEX conversation_source_owner ON conversation_source(office_id, user_id, conversation_id, created_at DESC);

-- The latest citation check of a document, for the version it was run on.
CREATE TABLE artifact_citation_review (
  artifact_id TEXT PRIMARY KEY REFERENCES ai_artifact(id) ON DELETE CASCADE,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  artifact_version BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('evaluated','partial','disabled','unavailable')),
  items TEXT NOT NULL DEFAULT '[]' CHECK ((items IS JSON)),
  mentions BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
