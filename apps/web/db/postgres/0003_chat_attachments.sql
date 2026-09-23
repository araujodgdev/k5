ALTER TABLE ai_conversation ADD CONSTRAINT ai_conversation_owner_unique UNIQUE(id,office_id,user_id);
CREATE TABLE ai_chat_attachment (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message_id TEXT,
  storage_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK(byte_size>0 AND byte_size<=10485760),
  extracted_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(conversation_id,office_id,user_id) REFERENCES ai_conversation(id,office_id,user_id) ON DELETE CASCADE
);
CREATE INDEX ai_chat_attachment_conversation ON ai_chat_attachment(conversation_id,office_id,user_id);
