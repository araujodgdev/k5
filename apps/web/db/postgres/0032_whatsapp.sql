CREATE TABLE whatsapp_connection (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL UNIQUE REFERENCES office(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('pending','connected','reconnect_required','disconnecting','disconnected')),
  profile_id TEXT UNIQUE,
  account_id TEXT UNIQUE,
  number TEXT,
  label TEXT,
  api_key_id TEXT,
  encrypted_api_key TEXT,
  key_provisioning_state TEXT NOT NULL DEFAULT 'none' CHECK (key_provisioning_state IN ('none','pending','unknown','ready')),
  key_operation_id TEXT,
  sync_state TEXT NOT NULL DEFAULT 'idle' CHECK (sync_state IN ('idle','pending','error')),
  synced_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  sync_cursor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, office_id)
);
CREATE TABLE whatsapp_connect_state (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  state_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verifying','consumed')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (connection_id, office_id) REFERENCES whatsapp_connection(id, office_id) ON DELETE CASCADE
);
CREATE TABLE whatsapp_thread (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  participant_name TEXT NOT NULL DEFAULT '',
  last_text TEXT NOT NULL DEFAULT '',
  last_message_at TIMESTAMPTZ NOT NULL,
  last_customer_message_at TIMESTAMPTZ,
  unread_count INTEGER NOT NULL DEFAULT 0,
  history_complete BOOLEAN NOT NULL DEFAULT false,
  history_cursor TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (connection_id, account_id, provider_id),
  UNIQUE (id, office_id),
  FOREIGN KEY (connection_id, office_id) REFERENCES whatsapp_connection(id, office_id) ON DELETE CASCADE
);
CREATE INDEX whatsapp_thread_page ON whatsapp_thread(office_id, last_message_at DESC, id DESC);
CREATE TABLE whatsapp_message (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  source TEXT NOT NULL DEFAULT 'provider' CHECK (source IN ('provider','tises','whatsapp_business_app')),
  text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','pending','dispatching','accepted','sent','delivered','read','failed','unknown')),
  deleted BOOLEAN NOT NULL DEFAULT false,
  edited BOOLEAN NOT NULL DEFAULT false,
  attachments JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL,
  content_updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (thread_id, provider_id),
  FOREIGN KEY (thread_id, office_id) REFERENCES whatsapp_thread(id, office_id) ON DELETE CASCADE
);
CREATE INDEX whatsapp_message_page ON whatsapp_message(office_id, thread_id, created_at DESC, id DESC);
CREATE TABLE whatsapp_event (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMPTZ,
  FOREIGN KEY (connection_id, office_id) REFERENCES whatsapp_connection(id, office_id) ON DELETE CASCADE
);
CREATE TABLE whatsapp_job (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('event','history','history_refresh','conversations','disconnect','revoke_key')),
  subject_id TEXT,
  dedupe_key TEXT NOT NULL,
  generation INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_until TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (connection_id, office_id) REFERENCES whatsapp_connection(id, office_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX whatsapp_job_active ON whatsapp_job(dedupe_key) WHERE status IN ('queued','running');
CREATE INDEX whatsapp_job_due ON whatsapp_job(status, available_at);
CREATE TABLE whatsapp_send (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  thread_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id),
  idempotency_key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  text TEXT NOT NULL,
  provider_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','dispatching','accepted','sent','delivered','read','failed','unknown')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (office_id, idempotency_key),
  FOREIGN KEY (connection_id, office_id) REFERENCES whatsapp_connection(id, office_id),
  FOREIGN KEY (thread_id, office_id) REFERENCES whatsapp_thread(id, office_id)
);
CREATE INDEX whatsapp_send_unknown ON whatsapp_send(status, updated_at);
CREATE TABLE whatsapp_api_budget (
  bucket TEXT PRIMARY KEY,
  starts_at TIMESTAMPTZ NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
