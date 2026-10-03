-- A Lume document saved to the Vault as DOCX joins the PDF and chat attachment copies, and the
-- conversation's Artefatos panel looks the copies up by their source.
ALTER TABLE vault_agent_origin DROP CONSTRAINT vault_agent_origin_source_kind_check;
ALTER TABLE vault_agent_origin ADD CONSTRAINT vault_agent_origin_source_kind_check
  CHECK (source_kind IN ('chat_attachment', 'artifact_pdf', 'artifact_docx'));
CREATE INDEX vault_agent_origin_source ON vault_agent_origin(source_kind, source_id);
