-- The office letterhead: a Word file from the Cofre used for every generated document that has no
-- template of its own. One per office, and optionally one per person that takes precedence.
-- The Cofre keeps owning the bytes; this only points at a document.
CREATE TABLE agent_document_template (
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  -- '' is the office default; a user id is that person's own template.
  user_id TEXT NOT NULL DEFAULT '',
  document_id TEXT NOT NULL REFERENCES vault_document(id) ON DELETE CASCADE,
  updated_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (office_id, user_id)
);
CREATE INDEX agent_document_template_document ON agent_document_template(document_id);
