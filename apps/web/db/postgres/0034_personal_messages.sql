CREATE TABLE personal_thread (
  id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL REFERENCES "user"(id),
  direct_key TEXT UNIQUE,
  next_sequence BIGINT NOT NULL DEFAULT 1 CHECK (next_sequence >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE personal_thread_participant (
  thread_id TEXT NOT NULL REFERENCES personal_thread(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  visible_from_sequence BIGINT NOT NULL DEFAULT 1 CHECK (visible_from_sequence >= 1),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  blocked_at TIMESTAMPTZ,
  last_read_sequence BIGINT NOT NULL DEFAULT 0 CHECK (last_read_sequence >= 0),
  last_read_at TIMESTAMPTZ,
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX personal_thread_participant_user ON personal_thread_participant(user_id, thread_id);

CREATE TABLE personal_thread_invitation (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL UNIQUE REFERENCES personal_thread(id) ON DELETE CASCADE,
  normalized_email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  encrypted_token TEXT NOT NULL,
  invited_by TEXT NOT NULL REFERENCES "user"(id),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','claimed','expired','revoked')),
  expires_at TIMESTAMPTZ NOT NULL,
  claimed_by TEXT REFERENCES "user"(id),
  claimed_at TIMESTAMPTZ,
  visible_from_sequence BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX personal_thread_invitation_pending
  ON personal_thread_invitation(invited_by, normalized_email) WHERE state='pending';

CREATE TABLE personal_verified_address (
  normalized_email TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX personal_verified_address_user
  ON personal_verified_address(user_id, normalized_email) WHERE revoked_at IS NULL;

CREATE TABLE personal_message (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES personal_thread(id) ON DELETE CASCADE,
  sequence BIGINT NOT NULL CHECK (sequence >= 1),
  sender_user_id TEXT NOT NULL REFERENCES "user"(id),
  sender_session_id TEXT REFERENCES session(id) ON DELETE SET NULL,
  client_message_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  body_kind TEXT NOT NULL CHECK (body_kind IN ('text','document_share','case_invitation')),
  body_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (thread_id, sequence),
  UNIQUE (sender_user_id, client_message_id)
);
CREATE INDEX personal_message_page ON personal_message(thread_id, sequence DESC);

CREATE TABLE personal_email_outbox (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE REFERENCES personal_message(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES personal_thread(id) ON DELETE CASCADE,
  invitation_id TEXT NOT NULL REFERENCES personal_thread_invitation(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  action_kind TEXT NOT NULL DEFAULT 'thread_claim' CHECK (action_kind IN ('thread_claim','document_claim','case_invite')),
  encrypted_action_token TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','accepted','retry','unknown','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_token TEXT,
  lease_until TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  provider_ref TEXT,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX personal_email_outbox_due ON personal_email_outbox(state, next_attempt_at, lease_until, id);

CREATE UNIQUE INDEX IF NOT EXISTS vault_document_office_identity
  ON vault_document(office_id, id);

CREATE TABLE vault_document_share (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES vault_document(id) ON DELETE CASCADE,
  document_version_id TEXT NOT NULL REFERENCES vault_document_version(id) ON DELETE CASCADE,
  version BIGINT NOT NULL CHECK (version >= 1),
  source_case_id TEXT,
  recipient_user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE,
  invitation_id TEXT REFERENCES personal_thread_invitation(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE,
  encrypted_token TEXT,
  expires_at TIMESTAMPTZ,
  conversation_id TEXT NOT NULL REFERENCES personal_thread(id) ON DELETE CASCADE,
  granted_by TEXT NOT NULL REFERENCES "user"(id),
  state TEXT NOT NULL CHECK (state IN ('pending','active','revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  CHECK ((state='pending' AND recipient_user_id IS NULL AND invitation_id IS NOT NULL AND token_hash IS NOT NULL AND encrypted_token IS NOT NULL AND expires_at IS NOT NULL)
      OR (state='active' AND recipient_user_id IS NOT NULL)
      OR state='revoked'),
  FOREIGN KEY (office_id, document_id) REFERENCES vault_document(office_id, id) ON DELETE CASCADE,
  FOREIGN KEY (office_id, source_case_id) REFERENCES vault_case(office_id, id) ON DELETE CASCADE
);
CREATE INDEX vault_document_share_recipient ON vault_document_share(recipient_user_id, state, created_at DESC);
CREATE INDEX vault_document_share_office ON vault_document_share(office_id, state, created_at DESC);

CREATE TABLE personal_share_operation (
  id TEXT PRIMARY KEY,
  author_user_id TEXT NOT NULL REFERENCES "user"(id),
  idempotency_key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('document','case')),
  message_id TEXT NOT NULL REFERENCES personal_message(id) ON DELETE CASCADE,
  result_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (author_user_id, idempotency_key)
);
