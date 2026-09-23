-- Google integration (docs/plano-integracao-google.md). Additive only: no existing table changes.
-- Tokens and operation arguments are ciphertext produced with K5_CREDENTIALS_KEY (platform-crypto).

-- Gradual release: the platform operator enables each module per office. Absent row = disabled.
CREATE TABLE google_rollout (
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN ('gmail','calendar','drive','docs')),
  enabled SMALLINT NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (office_id, module)
);

-- Single-use OAuth state, bound to the member and the browser session that started it.
CREATE TABLE google_oauth_state (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  encrypted_verifier TEXT NOT NULL,
  modules TEXT[] NOT NULL,
  scopes TEXT[] NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX google_oauth_state_expiry ON google_oauth_state(expires_at);

CREATE TABLE google_connection (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  google_subject TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  -- active: usable; reauth_required: refresh failed (revoked/expired grant); disconnected: by the member;
  -- member_removed: the member left the office. Only active connections start new work.
  status TEXT NOT NULL CHECK (status IN ('active','reauth_required','disconnected','member_removed')),
  granted_scopes TEXT[] NOT NULL DEFAULT '{}',
  encrypted_refresh_token TEXT,
  encrypted_access_token TEXT,
  access_expires_at TIMESTAMPTZ,
  token_generation INTEGER NOT NULL DEFAULT 0,
  refresh_lease_token TEXT,
  refresh_lease_until TIMESTAMPTZ,
  last_error_code TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disconnected_at TIMESTAMPTZ
);
-- One live Google account per member, and one member per Google account in an office.
CREATE UNIQUE INDEX google_connection_member_live ON google_connection(office_id, user_id) WHERE status IN ('active','reauth_required');
CREATE UNIQUE INDEX google_connection_subject_live ON google_connection(office_id, google_subject) WHERE status IN ('active','reauth_required');

-- Office rules. The current row is the head; every saved version is kept for audit and revalidation.
CREATE TABLE google_policy (
  office_id TEXT PRIMARY KEY REFERENCES office(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  rules_json TEXT NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE google_policy_version (
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  rules_json TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (office_id, version)
);

-- Durable record written before any external effect. Arguments are encrypted: only the owner reads them.
CREATE TABLE google_operation (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES google_connection(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  capability_name TEXT NOT NULL,
  invocation TEXT NOT NULL CHECK (invocation IN ('ui','agent','webmcp','worker')),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  encrypted_args TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  policy_mode TEXT NOT NULL CHECK (policy_mode IN ('automatic','confirmation')),
  approval_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','unknown')),
  attempts INTEGER NOT NULL DEFAULT 0,
  reconcile_key TEXT,
  external_ref TEXT,
  encrypted_result TEXT,
  error_code TEXT,
  error_message TEXT,
  usage_day DATE NOT NULL,
  usage_units INTEGER NOT NULL DEFAULT 1,
  lease_token TEXT,
  lease_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (office_id, user_id, idempotency_key)
);
CREATE INDEX google_operation_owner ON google_operation(office_id, user_id, created_at DESC);
CREATE INDEX google_operation_usage ON google_operation(office_id, user_id, action, usage_day);
CREATE INDEX google_operation_unknown ON google_operation(status, updated_at) WHERE status IN ('unknown','running');

-- Serialises the daily-limit check: the counter row is locked while an automatic operation is admitted.
CREATE TABLE google_usage_counter (
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  usage_day DATE NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (office_id, user_id, action, usage_day)
);

-- Background work. Queue messages carry only the id; this table is the source of truth.
CREATE TABLE google_job (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES google_connection(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('calendar_list','calendar_sync','calendar_watch','calendar_push','drive_import','operation_reconcile')),
  runtime TEXT NOT NULL DEFAULT 'edge' CHECK (runtime IN ('edge','node')),
  subject_id TEXT,
  dedupe_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','dead','cancelled')),
  run_after TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until TIMESTAMPTZ,
  checkpoint_json TEXT,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Duplicate push notifications and repeated schedules collapse into the one queued job.
CREATE UNIQUE INDEX google_job_dedupe ON google_job(dedupe_key) WHERE status IN ('queued','running') AND dedupe_key IS NOT NULL;
CREATE INDEX google_job_ready ON google_job(runtime, status, run_after);

-- Private calendars of a member. Never read by office-wide queries.
CREATE TABLE google_calendar (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES google_connection(id) ON DELETE CASCADE,
  google_calendar_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  time_zone TEXT,
  access_role TEXT NOT NULL CHECK (access_role IN ('owner','writer','reader','freeBusyReader')),
  is_primary SMALLINT NOT NULL DEFAULT 0,
  selected SMALLINT NOT NULL DEFAULT 0,
  sync_token TEXT,
  sync_state TEXT NOT NULL DEFAULT 'idle' CHECK (sync_state IN ('idle','pending','full_required','error','removed')),
  last_synced_at TIMESTAMPTZ,
  last_error_code TEXT,
  channel_id TEXT,
  channel_resource_id TEXT,
  channel_token_hash TEXT,
  channel_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (connection_id, google_calendar_id)
);
CREATE UNIQUE INDEX google_calendar_channel ON google_calendar(channel_id) WHERE channel_id IS NOT NULL;

CREATE TABLE personal_event (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL REFERENCES google_calendar(id) ON DELETE CASCADE,
  google_event_id TEXT NOT NULL,
  ical_uid TEXT,
  recurring_event_id TEXT,
  original_start TEXT,
  etag TEXT,
  status TEXT NOT NULL CHECK (status IN ('confirmed','tentative','cancelled')),
  summary TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  all_day SMALLINT NOT NULL DEFAULT 0,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  start_date DATE,
  end_date DATE,
  time_zone TEXT,
  recurrence TEXT[] NOT NULL DEFAULT '{}',
  attendees_json TEXT NOT NULL DEFAULT '[]',
  organizer_email TEXT,
  self_response TEXT,
  meeting_url TEXT,
  html_link TEXT,
  remote_updated_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  -- Fields edited in the Lume that still have to reach Google; reapplied over the current remote version.
  pending_fields_json TEXT,
  sync_state TEXT NOT NULL DEFAULT 'synced' CHECK (sync_state IN ('synced','pending_push','conflict','remote_deleted','permission_lost','failed')),
  sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (calendar_id, google_event_id)
);
CREATE INDEX personal_event_owner_range ON personal_event(office_id, user_id, start_at, end_at);
CREATE INDEX personal_event_owner_dates ON personal_event(office_id, user_id, start_date, end_date);

-- What the owner chose to show the office: a reviewed copy, never the Google event itself.
CREATE TABLE personal_event_share (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES personal_event(id) ON DELETE CASCADE,
  occurrence_start TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  all_day SMALLINT NOT NULL DEFAULT 0,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  start_date DATE,
  end_date DATE,
  version INTEGER NOT NULL DEFAULT 1,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX personal_event_share_live ON personal_event_share(event_id, occurrence_start) WHERE revoked_at IS NULL;
CREATE INDEX personal_event_share_office ON personal_event_share(office_id, starts_at, start_date) WHERE revoked_at IS NULL;

-- Drive files the member explicitly picked. The opaque id is what travels through tools and routes.
CREATE TABLE google_drive_file (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES google_connection(id) ON DELETE CASCADE,
  google_file_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT,
  drive_id TEXT,
  version TEXT,
  head_revision_id TEXT,
  modified_time TIMESTAMPTZ,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  web_view_link TEXT,
  state TEXT NOT NULL DEFAULT 'available' CHECK (state IN ('available','not_found','permission_lost')),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (connection_id, google_file_id)
);

-- Local files attached to an e-mail being composed. Short-lived, owner-only, never indexed.
CREATE TABLE google_mail_upload (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX google_mail_upload_expiry ON google_mail_upload(expires_at);

-- Provenance of each copy brought into the Cofre. A reimport is a new row and a new document version.
CREATE TABLE google_drive_import (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('drive','gmail_attachment')),
  drive_file_id TEXT REFERENCES google_drive_file(id) ON DELETE SET NULL,
  source_account_email TEXT NOT NULL,
  google_file_id TEXT,
  gmail_message_id TEXT,
  gmail_attachment_part TEXT,
  source_name TEXT NOT NULL,
  source_mime_type TEXT NOT NULL,
  source_version TEXT,
  source_modified_time TIMESTAMPTZ,
  export_mime_type TEXT,
  case_id TEXT NOT NULL,
  folder_id TEXT,
  vault_document_id TEXT,
  vault_version INTEGER,
  sha256 TEXT,
  byte_size BIGINT,
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed')),
  error_code TEXT,
  error_message TEXT,
  job_id TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  UNIQUE (office_id, user_id, idempotency_key)
);
CREATE INDEX google_drive_import_file ON google_drive_import(office_id, user_id, google_file_id, case_id);
