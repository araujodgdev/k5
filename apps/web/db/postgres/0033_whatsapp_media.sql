ALTER TABLE whatsapp_job DROP CONSTRAINT whatsapp_job_kind_check;
ALTER TABLE whatsapp_job ADD CONSTRAINT whatsapp_job_kind_check
  CHECK (kind IN ('event','history','history_refresh','conversations','disconnect','revoke_key','media'));

CREATE TABLE whatsapp_attachment (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  user_id TEXT REFERENCES "user"(id),
  message_id TEXT REFERENCES whatsapp_message(id) ON DELETE CASCADE,
  send_id TEXT UNIQUE REFERENCES whatsapp_send(id),
  attachment_index INTEGER NOT NULL DEFAULT 0 CHECK (attachment_index>=0),
  media_id TEXT,
  kind TEXT NOT NULL,
  filename TEXT,
  mime_type TEXT,
  byte_length INTEGER CHECK (byte_length>0 AND byte_length<=25000000),
  sha256 TEXT,
  storage_key TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending','ready','unavailable')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (message_id,attachment_index),
  FOREIGN KEY (connection_id,office_id) REFERENCES whatsapp_connection(id,office_id) ON DELETE CASCADE,
  FOREIGN KEY (thread_id,office_id) REFERENCES whatsapp_thread(id,office_id) ON DELETE CASCADE,
  CHECK (state<>'ready' OR (storage_key IS NOT NULL AND mime_type IS NOT NULL AND filename IS NOT NULL AND byte_length IS NOT NULL AND sha256 IS NOT NULL))
);
CREATE INDEX whatsapp_attachment_thread ON whatsapp_attachment(office_id,thread_id);
CREATE INDEX whatsapp_attachment_expiry ON whatsapp_attachment(expires_at) WHERE send_id IS NULL AND message_id IS NULL;
