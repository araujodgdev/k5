-- Documents the Lume writes during a conversation. Until now every document came from a job, so
-- run_id was required; a chat document has no job and belongs to the conversation that made it.
ALTER TABLE ai_artifact ALTER COLUMN run_id DROP NOT NULL;
ALTER TABLE ai_artifact ADD COLUMN kind TEXT NOT NULL DEFAULT 'draft' CHECK (kind IN ('draft','chronology','document'));
ALTER TABLE ai_artifact ADD COLUMN conversation_id TEXT REFERENCES ai_conversation(id) ON DELETE SET NULL;
-- The agent may edit, without asking, only a document it created in the same conversation.
ALTER TABLE ai_artifact ADD COLUMN created_by_agent BOOLEAN NOT NULL DEFAULT false;
-- A chat document must say where it came from; job documents keep their run.
ALTER TABLE ai_artifact ADD CONSTRAINT ai_artifact_origin CHECK (run_id IS NOT NULL OR kind = 'document');
UPDATE ai_artifact a SET kind = r.kind FROM ai_run r WHERE r.id = a.run_id AND r.kind = 'chronology';
CREATE INDEX ai_artifact_conversation ON ai_artifact(office_id, user_id, conversation_id);
CREATE INDEX ai_artifact_recent ON ai_artifact(office_id, user_id, updated_at DESC);
