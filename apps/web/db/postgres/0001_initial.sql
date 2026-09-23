-- PostgreSQL baseline from the complete legacy schema (0000–0020).

-- The legacy files remain only for importing SQLite/D1 backups. Do not apply them to PostgreSQL.

CREATE TABLE "account" (
  "id" text not null primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  "scope" text,
  "password" text,
  "createdAt" TIMESTAMPTZ not null,
  "updatedAt" TIMESTAMPTZ not null
);

CREATE TABLE "agenda_activity" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('task', 'meeting')),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 2 AND 180),
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('pending', 'completed', 'cancelled')),
  due_on TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  client_id TEXT,
  case_id TEXT,
  assignee_id TEXT,
  created_by TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  mutation_token TEXT,
  CHECK((kind='task' AND starts_at IS NULL AND ends_at IS NULL) OR
        (kind='meeting' AND due_on IS NULL AND starts_at IS NOT NULL AND ends_at > starts_at))
);

CREATE TABLE "agenda_proposal" (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  reference_at TIMESTAMPTZ NOT NULL,
  time_zone TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload TEXT NOT NULL,
  questions TEXT NOT NULL,
  provenance TEXT NOT NULL,
  evaluation_status TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  version BIGINT NOT NULL DEFAULT 1,
  confirmation_hash TEXT,
  confirmed_payload TEXT,
  result TEXT,
  expires_at BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ai_artifact" (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  run_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_refs TEXT NOT NULL DEFAULT '[]',
  validation_issues TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  version BIGINT NOT NULL DEFAULT 1,
  template_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ai_artifact_version" (
  artifact_id TEXT NOT NULL,
  version BIGINT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(artifact_id,version)
);

CREATE TABLE "ai_checkpoint" (
  run_id TEXT NOT NULL,
  step_key TEXT NOT NULL,
  result TEXT NOT NULL,
  PRIMARY KEY(run_id,step_key)
);

CREATE TABLE "ai_citation_approval" (
  run_id TEXT NOT NULL,
  citation_id TEXT NOT NULL,
  source_text TEXT NOT NULL,
  source_label TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_type TEXT NOT NULL DEFAULT 'vault' CHECK(source_type IN ('vault','research')),
  document_id TEXT,
  research_reference_id TEXT,
  material_version_id TEXT,
  judgment_id TEXT,
  research_chunk_id TEXT,
  PRIMARY KEY(run_id,citation_id)
);

CREATE TABLE "ai_connection" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'google', 'deepseek', 'inception', 'openrouter', 'vercel')),
  encrypted_api_key TEXT,
  api_key_hint TEXT NOT NULL,
  chat_model TEXT,
  extraction_model TEXT,
  drafting_model TEXT,
  enabled BIGINT NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  embedding_model TEXT,
  CHECK (deleted_at IS NULL OR encrypted_api_key IS NULL),
  UNIQUE (office_id, name)
);

CREATE TABLE "ai_conversation" (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  messages TEXT NOT NULL DEFAULT '[]',
  busy_until BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ai_run" (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('chronology','draft')),
  input TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled')),
  progress BIGINT NOT NULL DEFAULT 0,
  error TEXT,
  artifact_id TEXT,
  lease_until BIGINT NOT NULL DEFAULT 0,
  lease_token TEXT,
  attempts BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  model_provider TEXT,
  model_id TEXT
);

CREATE TABLE "ai_usage" (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  user_id TEXT,
  connection_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  task TEXT NOT NULL,
  input_tokens BIGINT,
  output_tokens BIGINT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "artifact_verification" (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_version BIGINT NOT NULL,
  content_hash TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  units TEXT NOT NULL,
  results TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'queued',
  mode TEXT NOT NULL DEFAULT 'enabled',
  model TEXT,
  question_version TEXT NOT NULL,
  checked BIGINT NOT NULL DEFAULT 0,
  total BIGINT NOT NULL,
  lease_token TEXT,
  lease_until BIGINT NOT NULL DEFAULT 0,
  attempts BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sequence_no BIGINT GENERATED BY DEFAULT AS IDENTITY UNIQUE
);

CREATE TABLE "capability_approval" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  capability_name TEXT NOT NULL,
  normalized_input TEXT NOT NULL,
  target_resource_id TEXT,
  target_version BIGINT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'consumed')),
  expires_at BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  consumed_at TIMESTAMPTZ
);

CREATE TABLE "capability_idempotency" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  capability_name TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  response_payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(office_id, idempotency_key)
);

CREATE TABLE "crm_client" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 180),
  email TEXT,
  phone TEXT,
  notes TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL CHECK(stage IN ('prospect', 'active', 'archived')),
  version BIGINT NOT NULL DEFAULT 1,
  mutation_token TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(office_id, id)
);

CREATE TABLE "crm_client_case" (
  office_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  PRIMARY KEY(office_id, client_id, case_id)
);

CREATE TABLE "judicial_access_audit" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  user_id TEXT,
  actor TEXT NOT NULL DEFAULT 'user' CHECK (actor IN ('user', 'agent', 'worker')),
  action TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  subject_id TEXT,
  installation_id TEXT,
  purpose TEXT,
  outcome TEXT NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok', 'denied', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "judicial_alert" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  link_id TEXT,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('new_publication', 'historical_publication', 'new_movement', 'correction', 'sync_failed', 'coverage_gap')),
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('publication', 'movement', 'job', 'subscription')),
  subject_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  delivered_at TIMESTAMPTZ,
  attempts BIGINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (office_id, dedupe_key)
);

CREATE TABLE "judicial_case_link" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  cnj_number TEXT,
  native_number TEXT,
  degree TEXT NOT NULL CHECK (degree IN ('first', 'second', 'superior', 'panel', 'not_applicable')),
  confirmation TEXT NOT NULL DEFAULT 'pending_review' CHECK (confirmation IN ('confirmed', 'pending_review', 'rejected')),
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'unlinked')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (cnj_number IS NOT NULL OR native_number IS NOT NULL)
);

CREATE TABLE "judicial_connection" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 2 AND 120),
  holder_kind TEXT NOT NULL DEFAULT 'institutional' CHECK (holder_kind IN ('institutional', 'lawyer', 'recipient')),
  holder_user_id TEXT,
  secret_ref TEXT,
  secret_hint TEXT,
  scopes TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'needs_attention')),
  expires_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (office_id, installation_id, label)
);

CREATE TABLE "judicial_document" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  snapshot_id TEXT,
  source_document_id TEXT NOT NULL,
  title TEXT NOT NULL,
  document_type TEXT,
  mime_type TEXT,
  byte_size BIGINT NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
  sha256 TEXT,
  storage_key TEXT,
  vault_document_id TEXT,
  imported_at TIMESTAMPTZ,
  imported_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (office_id, record_id, source_document_id)
);

CREATE TABLE "judicial_movement" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  source_movement_id TEXT,
  source_code TEXT,
  source_text TEXT NOT NULL,
  tpu_code TEXT,
  tpu_source TEXT CHECK (tpu_source IS NULL OR tpu_source IN ('source_declared', 'catalog_exact')),
  event_at TIMESTAMPTZ NOT NULL,
  event_precision TEXT NOT NULL DEFAULT 'date' CHECK (event_precision IN ('date', 'minute', 'second')),
  event_timezone TEXT,
  fingerprint TEXT NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (office_id, record_id, fingerprint)
);

CREATE TABLE "judicial_publication" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  record_id TEXT,
  link_id TEXT,
  snapshot_id TEXT NOT NULL,
  source_publication_id TEXT,
  cnj_number TEXT,
  edition TEXT,
  page TEXT,
  official_hash TEXT,
  body TEXT NOT NULL,
  made_available_on TEXT,
  published_on TEXT,
  source_updated_at TIMESTAMPTZ,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  supersedes_id TEXT,
  revision_kind TEXT NOT NULL DEFAULT 'original' CHECK (revision_kind IN ('original', 'republication', 'errata')),
  fingerprint TEXT NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (office_id, installation_id, fingerprint)
);

CREATE TABLE "judicial_rate_budget" (
  installation_id TEXT NOT NULL,
  office_id TEXT NOT NULL,
  day TEXT NOT NULL,
  requests BIGINT NOT NULL DEFAULT 0 CHECK (requests >= 0),
  last_request_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (installation_id, office_id, day)
);

CREATE TABLE "judicial_snapshot" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  record_id TEXT,
  job_id TEXT,
  operation TEXT NOT NULL,
  request_summary TEXT NOT NULL DEFAULT '{}',
  payload TEXT,
  storage_key TEXT,
  content_type TEXT NOT NULL DEFAULT 'application/json',
  byte_size BIGINT NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL,
  parser_version TEXT NOT NULL DEFAULT 'unversioned',
  collected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  visibility TEXT NOT NULL DEFAULT 'restricted' CHECK (visibility IN ('public', 'restricted', 'sealed')),
  usage_conditions TEXT NOT NULL DEFAULT '{}',
  redacted_at TIMESTAMPTZ,
  redaction_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((payload IS NOT NULL AND storage_key IS NULL) OR (payload IS NULL AND storage_key IS NOT NULL))
);

CREATE TABLE "judicial_source_installation" (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('djen', 'mni', 'ckan', 'jurisprudence_api', 'vocabulary', 'court_portal')),
  court_code TEXT NOT NULL,
  court_name TEXT NOT NULL,
  degree TEXT NOT NULL CHECK (degree IN ('first', 'second', 'superior', 'panel', 'not_applicable')),
  system TEXT NOT NULL CHECK (system IN ('pje', 'eproc', 'esaj', 'projudi', 'saj', 'sei', 'proprietary', 'not_applicable')),
  purpose TEXT NOT NULL CHECK (purpose IN ('publications', 'case_tracking', 'jurisprudence', 'vocabulary')),
  coverage_from TEXT,
  coverage_to TEXT,
  base_url TEXT,
  contract_version TEXT,
  auth_kind TEXT NOT NULL DEFAULT 'none' CHECK (auth_kind IN ('none', 'public_key', 'institutional', 'delegated_lawyer', 'recipient')),
  discovery_status TEXT NOT NULL DEFAULT 'candidate' CHECK (discovery_status IN (
    'candidate', 'documented', 'access_pending', 'spike_approved', 'pilot', 'production', 'degraded', 'suspended'
  )),
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  permission_query TEXT NOT NULL DEFAULT 'nao_esclarecido' CHECK (permission_query IN ('permitido', 'restrito', 'proibido', 'nao_esclarecido')),
  permission_cache TEXT NOT NULL DEFAULT 'nao_esclarecido' CHECK (permission_cache IN ('permitido', 'restrito', 'proibido', 'nao_esclarecido')),
  permission_documents TEXT NOT NULL DEFAULT 'nao_esclarecido' CHECK (permission_documents IN ('permitido', 'restrito', 'proibido', 'nao_esclarecido')),
  permission_redistribution TEXT NOT NULL DEFAULT 'nao_esclarecido' CHECK (permission_redistribution IN ('permitido', 'restrito', 'proibido', 'nao_esclarecido')),
  permission_ai TEXT NOT NULL DEFAULT 'nao_esclarecido' CHECK (permission_ai IN ('permitido', 'restrito', 'proibido', 'nao_esclarecido')),
  permission_evidence TEXT,
  allowed_hosts TEXT NOT NULL DEFAULT '[]',
  enabled BIGINT NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  live_transport_enabled BIGINT NOT NULL DEFAULT 0 CHECK (live_transport_enabled IN (0, 1)),
  rate_limit_per_minute BIGINT NOT NULL DEFAULT 10 CHECK (rate_limit_per_minute > 0),
  daily_request_budget BIGINT NOT NULL DEFAULT 500 CHECK (daily_request_budget > 0),
  notes TEXT,
  documentation_url TEXT,
  documentation_reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (kind, court_code, degree, system, purpose)
);

CREATE TABLE "judicial_source_record" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  link_id TEXT,
  source_record_id TEXT NOT NULL,
  record_kind TEXT NOT NULL CHECK (record_kind IN ('case', 'publication', 'decision', 'document')),
  cnj_number TEXT,
  native_number TEXT,
  title TEXT,
  source_updated_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (office_id, installation_id, source_record_id)
);

CREATE TABLE "judicial_subscription" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  connection_id TEXT,
  link_id TEXT,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('case', 'publications_by_case', 'jurisprudence_collection')),
  filters TEXT NOT NULL DEFAULT '{}',
  interval_minutes BIGINT NOT NULL DEFAULT 360 CHECK (interval_minutes >= 15),
  daily_request_budget BIGINT NOT NULL DEFAULT 50 CHECK (daily_request_budget > 0),
  watermark TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'suspended', 'cancelled')),
  suspended_reason TEXT,
  next_run_at BIGINT NOT NULL DEFAULT 0,
  last_success_at TIMESTAMPTZ,
  authorized_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "judicial_sync_job" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  subscription_id TEXT,
  installation_id TEXT NOT NULL,
  link_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('refresh', 'backfill', 'manual')),
  operation TEXT NOT NULL,
  request TEXT NOT NULL DEFAULT '{}',
  window_from TEXT,
  window_to TEXT,
  cursor TEXT,
  pages_fetched BIGINT NOT NULL DEFAULT 0 CHECK (pages_fetched >= 0),
  records_accepted BIGINT NOT NULL DEFAULT 0 CHECK (records_accepted >= 0),
  records_rejected BIGINT NOT NULL DEFAULT 0 CHECK (records_rejected >= 0),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'quarantined')),
  attempts BIGINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_owner TEXT,
  lease_until BIGINT NOT NULL DEFAULT 0,
  run_after BIGINT NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  sequence_no BIGINT GENERATED BY DEFAULT AS IDENTITY UNIQUE
);

CREATE TABLE "judicial_vocabulary_term" (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('class', 'subject', 'movement')),
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  parent_code TEXT,
  valid_from TEXT,
  valid_to TEXT,
  version TEXT NOT NULL DEFAULT 'unversioned',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (kind, code, version)
);

CREATE TABLE "knowledge_index_generation" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  profile_name TEXT NOT NULL,
  model_id TEXT NOT NULL,
  dimension BIGINT NOT NULL,
  chunker TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'building', 'retired', 'failed')),
  count_expected BIGINT NOT NULL DEFAULT 0,
  count_published BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "knowledge_index_job" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  cursor_ordinal BIGINT NOT NULL DEFAULT 0,
  chunks_total BIGINT NOT NULL DEFAULT 0,
  chunks_done BIGINT NOT NULL DEFAULT 0,
  attempts BIGINT NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_until BIGINT NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (document_id, generation_id)
);

CREATE TABLE "knowledge_retrieval_audit" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  query TEXT NOT NULL,
  strategy TEXT NOT NULL,
  degraded BIGINT NOT NULL DEFAULT 0,
  document_count BIGINT NOT NULL DEFAULT 0,
  source_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "knowledge_scope" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  conversation_id TEXT,
  document_ids TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  case_id TEXT,
  research_reference_ids TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE "model_feedback" (
  id TEXT PRIMARY KEY NOT NULL,
  campaign_id TEXT NOT NULL,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  model_a TEXT NOT NULL,
  model_b TEXT NOT NULL,
  preference TEXT NOT NULL CHECK (preference IN ('a', 'b', 'tie', 'neither', 'unsure')),
  preferred_model TEXT,
  assessment_a TEXT NOT NULL,
  assessment_b TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  training_consent BIGINT NOT NULL DEFAULT 0 CHECK (training_consent IN (0, 1)),
  rubric_version TEXT NOT NULL DEFAULT 'legal-artifacts-v1',
  prior_exposure BIGINT NOT NULL DEFAULT 0 CHECK (prior_exposure IN (0, 1)),
  training_consent_purpose TEXT,
  training_consent_version BIGINT CHECK (training_consent_version > 0),
  UNIQUE (campaign_id, office_id, user_id)
);

CREATE TABLE "notification_delivery" (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  group_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN (
    'pending', 'leased', 'accepted', 'retry', 'expired', 'cancelled', 'dead'
  )),
  attempts BIGINT NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  lease_token TEXT,
  lease_until TIMESTAMPTZ,
  error_code TEXT,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(event_id, user_id, subscription_id),
  UNIQUE(office_id, id)
);

CREATE TABLE "notification_event" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 3 AND 100),
  payload_version BIGINT NOT NULL DEFAULT 1 CHECK(payload_version > 0),
  source_kind TEXT NOT NULL CHECK(source_kind IN (
    'activity', 'case', 'document', 'run', 'artifact', 'judicial_alert', 'system'
  )),
  source_id TEXT,
  source_version BIGINT,
  actor_user_id TEXT,
  intended_recipients_json TEXT NOT NULL CHECK((intended_recipients_json IS JSON)),
  data_json TEXT NOT NULL DEFAULT '{}' CHECK((data_json IS JSON)),
  dedupe_key TEXT NOT NULL,
  historical BIGINT NOT NULL DEFAULT 0 CHECK(historical IN (0, 1)),
  push_eligible BIGINT NOT NULL DEFAULT 1 CHECK(push_eligible IN (0, 1)),
  projection_state TEXT NOT NULL DEFAULT 'pending' CHECK(projection_state IN ('pending', 'leased', 'projected', 'dead')),
  projection_attempts BIGINT NOT NULL DEFAULT 0 CHECK(projection_attempts >= 0),
  lease_token TEXT,
  lease_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  projected_at TIMESTAMPTZ,
  last_error TEXT,
  UNIQUE(office_id, dedupe_key),
  UNIQUE(office_id, id)
);

CREATE TABLE "notification_follow" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ
);

CREATE TABLE "notification_preference" (
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo' CHECK(length(timezone) BETWEEN 1 AND 100),
  quiet_enabled BIGINT NOT NULL DEFAULT 0 CHECK(quiet_enabled IN (0, 1)),
  quiet_start TEXT,
  quiet_end TEXT,
  push_enabled BIGINT NOT NULL DEFAULT 1 CHECK(push_enabled IN (0, 1)),
  categories_json TEXT NOT NULL DEFAULT '{"agenda":true,"vault":true,"documents":true,"judicial":true,"system":true}' CHECK((categories_json IS JSON)),
  channels_json TEXT NOT NULL DEFAULT '{"inbox":true,"push":true}' CHECK((channels_json IS JSON)),
  config_version BIGINT NOT NULL DEFAULT 1 CHECK(config_version > 0),
  revocation_generation BIGINT NOT NULL DEFAULT 1 CHECK(revocation_generation > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(office_id, user_id),
  CHECK((quiet_enabled = 0) OR (quiet_start IS NOT NULL AND quiet_end IS NOT NULL))
);

CREATE TABLE "notification_recipient" (
  event_id TEXT NOT NULL,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(event_id, user_id),
  UNIQUE(office_id, event_id, user_id)
);

CREATE TABLE "notification_reminder" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  activity_version BIGINT NOT NULL CHECK(activity_version > 0),
  schedule_key TEXT NOT NULL,
  rule TEXT NOT NULL CHECK(rule IN ('task_due', 'meeting_soon')),
  timezone TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'scheduled' CHECK(state IN ('scheduled', 'emitted', 'cancelled', 'expired')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(office_id, activity_id, user_id, rule, schedule_key)
);

CREATE TABLE "notification_rollout" (
  office_id TEXT PRIMARY KEY NOT NULL,
  capture_enabled BIGINT NOT NULL DEFAULT 1 CHECK(capture_enabled IN (0, 1)),
  inbox_enabled BIGINT NOT NULL DEFAULT 1 CHECK(inbox_enabled IN (0, 1)),
  push_enabled BIGINT NOT NULL DEFAULT 1 CHECK(push_enabled IN (0, 1)),
  reminders_enabled BIGINT NOT NULL DEFAULT 1 CHECK(reminders_enabled IN (0, 1)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "office" (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "office_member" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('administrator', 'lawyer', 'reviewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id),
  UNIQUE (office_id, user_id)
);

CREATE TABLE "platform_admin" (
  user_id TEXT PRIMARY KEY NOT NULL,
  granted_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "platform_audit_log" (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL,
  office_id TEXT,
  connection_id TEXT,
  action TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "platform_secret_ref" (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('ai_connection_key')),
  encrypted_secret TEXT NOT NULL,
  secret_hint TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "push_subscription" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL CHECK(length(device_id) BETWEEN 8 AND 128),
  device_label TEXT CHECK(device_label IS NULL OR length(device_label) <= 120),
  endpoint_hash TEXT NOT NULL UNIQUE,
  encrypted_subscription TEXT NOT NULL,
  vapid_key_id TEXT NOT NULL CHECK(length(vapid_key_id) BETWEEN 1 AND 100),
  auth_generation BIGINT NOT NULL CHECK(auth_generation > 0),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'revoked', 'invalid')),
  subscribed_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_reconciled_at TIMESTAMPTZ NOT NULL,
  last_error_code TEXT,
  UNIQUE(office_id, user_id, device_id),
  UNIQUE(office_id, id)
);

CREATE TABLE "rateLimit" (
  "id" text not null primary key,
  "key" text not null unique,
  "count" BIGINT not null,
  "lastRequest" bigint not null
);

CREATE TABLE "research_case_assessment" (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  material_version_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  profile_version BIGINT,
  input_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','evaluated','incomplete','disabled','unavailable','budget_exceeded','stale')),
  mode TEXT NOT NULL CHECK(mode IN ('off','shadow','enabled')),
  model TEXT,
  question_version TEXT NOT NULL,
  config_version BIGINT,
  result_json TEXT,
  reason TEXT,
  typesafe_evaluation_id TEXT,
  attempts BIGINT NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(office_id,case_id,material_version_id,input_fingerprint)
);

CREATE TABLE "research_case_profile" (
  case_id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1 CHECK(version > 0),
  legal_question TEXT NOT NULL,
  objective TEXT NOT NULL,
  thesis TEXT,
  documented_facts_json TEXT NOT NULL DEFAULT '[]',
  alleged_facts_json TEXT NOT NULL DEFAULT '[]',
  gaps_json TEXT NOT NULL DEFAULT '[]',
  document_ids_json TEXT NOT NULL DEFAULT '[]',
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "research_case_profile_revision" (
  case_id TEXT NOT NULL,
  office_id TEXT NOT NULL,
  version BIGINT NOT NULL,
  snapshot_json TEXT NOT NULL,
  reviewed_by TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(case_id,version)
);

CREATE TABLE "research_case_reference" (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  material_version_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('foundation','counterpoint','context')),
  notes TEXT NOT NULL DEFAULT '',
  assessment_id TEXT,
  bypass_evaluation BIGINT NOT NULL DEFAULT 0 CHECK(bypass_evaluation IN (0,1)),
  version BIGINT NOT NULL DEFAULT 1 CHECK(version > 0),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  UNIQUE(office_id,case_id,material_version_id)
);

CREATE TABLE "research_chunk" (
  id TEXT PRIMARY KEY,
  material_version_id TEXT NOT NULL,
  ordinal BIGINT NOT NULL CHECK(ordinal >= 0),
  text_content TEXT NOT NULL,
  reference TEXT NOT NULL,
  page_number BIGINT,
  UNIQUE(material_version_id,ordinal)
);

CREATE TABLE "research_extract_checkpoint" (
  material_version_id TEXT NOT NULL,
  page_number BIGINT NOT NULL CHECK(page_number>0),
  text_content TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('text_layer','ocr')),
  PRIMARY KEY(material_version_id,page_number)
);

CREATE TABLE "research_job" (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  search_id TEXT,
  page_id TEXT,
  installation_id TEXT NOT NULL,
  material_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('search_page','fetch_material','extract_material','stj_resource')),
  request_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled')),
  attempts BIGINT NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  lease_owner TEXT,
  lease_until BIGINT NOT NULL DEFAULT 0,
  run_after BIGINT NOT NULL DEFAULT 0,
  error_code TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  UNIQUE(office_id,user_id,idempotency_key)
);

CREATE TABLE "research_judgment" (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  source_judgment_id TEXT NOT NULL,
  tribunal TEXT NOT NULL,
  court_unit TEXT,
  case_number TEXT,
  class_name TEXT,
  rapporteur TEXT,
  title TEXT NOT NULL,
  decision_date TEXT,
  source_url TEXT,
  source_updated_at TIMESTAMPTZ,
  metadata_revision BIGINT NOT NULL DEFAULT 1,
  metadata_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('candidate','active','restricted')),
  collected_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(installation_id, source_judgment_id)
);

CREATE TABLE "research_material" (
  id TEXT PRIMARY KEY,
  judgment_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('ementa','full_text')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','fetching','processing','ready','unavailable','failed','restricted')),
  current_version_id TEXT,
  source_locator TEXT,
  unavailable_reason TEXT,
  source_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(judgment_id,kind)
);

CREATE TABLE "research_material_claim" (
  material_id TEXT PRIMARY KEY,
  lease_owner TEXT NOT NULL,
  lease_until BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "research_material_version" (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK(byte_size >= 0),
  storage_key TEXT,
  text_content TEXT,
  parser_version TEXT NOT NULL,
  citation_metadata_json TEXT NOT NULL DEFAULT '{}',
  metadata_revision BIGINT NOT NULL,
  source_url TEXT,
  source_updated_at TIMESTAMPTZ,
  collected_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(material_id,sha256,parser_version,metadata_revision),
  CHECK(storage_key IS NOT NULL OR text_content IS NOT NULL)
);

CREATE TABLE "research_quarantine" (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  record_index BIGINT NOT NULL,
  reason TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days'),
  UNIQUE(job_id,record_index)
);

CREATE TABLE "research_rerank_cache" (
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  model TEXT NOT NULL,
  config_version BIGINT NOT NULL,
  ordered_ids_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(office_id,user_id,fingerprint)
);

CREATE TABLE "research_search" (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  theme TEXT NOT NULL,
  filters_json TEXT NOT NULL DEFAULT '{}',
  include_sources BIGINT NOT NULL DEFAULT 0 CHECK(include_sources IN (0,1)),
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','partial','failed','cancelled')),
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "research_search_page" (
  id TEXT PRIMARY KEY,
  search_id TEXT NOT NULL,
  page_number BIGINT NOT NULL CHECK(page_number >= 0),
  source_cursor TEXT,
  request_cursor TEXT,
  next_cursor TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','partial','failed')),
  total_reported BIGINT,
  source_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(search_id,page_number)
);

CREATE TABLE "research_search_result" (
  id TEXT PRIMARY KEY,
  search_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  judgment_id TEXT NOT NULL,
  position BIGINT NOT NULL CHECK(position >= 0),
  origin TEXT NOT NULL CHECK(origin IN ('local','source')),
  version_seen_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(search_id,judgment_id),
  UNIQUE(page_id,position)
);

CREATE TABLE "research_source_budget" (
  installation_id TEXT NOT NULL,
  office_id TEXT NOT NULL,
  window_kind TEXT NOT NULL CHECK(window_kind IN ('minute','day')),
  period_start BIGINT NOT NULL,
  request_count BIGINT NOT NULL DEFAULT 0,
  max_count BIGINT NOT NULL CHECK(max_count>0),
  CHECK(request_count<=max_count),
  PRIMARY KEY(installation_id,office_id,window_kind,period_start)
);

CREATE TABLE "research_source_resource" (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  source_resource_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  resource_kind TEXT NOT NULL,
  etag TEXT,
  source_updated_at TIMESTAMPTZ,
  checkpoint TEXT,
  status TEXT NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate','queued','running','completed','failed','restricted')),
  error_code TEXT,
  last_ingested_at TIMESTAMPTZ,
  dataset_slug TEXT,
  resource_name TEXT,
  source_data_date TEXT,
  content_sha256 TEXT,
  ingested_revision TEXT,
  original_storage_key TEXT,
  UNIQUE(installation_id,source_resource_id)
);

CREATE TABLE "research_stj_document_link" (
  installation_id TEXT NOT NULL,
  judgment_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  evidence_url TEXT NOT NULL,
  evidence_note TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  last_published_data_date TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(installation_id,document_id),
  UNIQUE(installation_id,judgment_id)
);

CREATE TABLE "research_stj_fulltext_identity" (
  installation_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  registration_number TEXT,
  document_type TEXT NOT NULL,
  publication_date TEXT,
  metadata_resource_id TEXT NOT NULL,
  source_data_date TEXT NOT NULL,
  PRIMARY KEY(installation_id,document_id)
);

CREATE TABLE "research_stj_mirror_identity" (
  installation_id TEXT NOT NULL,
  source_judgment_id TEXT NOT NULL,
  judgment_id TEXT NOT NULL,
  document_id TEXT,
  registration_number TEXT,
  source_resource_id TEXT NOT NULL,
  source_data_date TEXT NOT NULL,
  PRIMARY KEY(installation_id,source_judgment_id)
);

CREATE TABLE "session" (
  "id" text not null primary key,
  "expiresAt" TIMESTAMPTZ not null,
  "token" text not null unique,
  "createdAt" TIMESTAMPTZ not null,
  "updatedAt" TIMESTAMPTZ not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null
);

CREATE TABLE "typesafe_connection" (
  office_id TEXT PRIMARY KEY,
  encrypted_api_key TEXT,
  key_hint TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT 'jev-1.13.0',
  enabled BIGINT NOT NULL DEFAULT 0,
  rag_mode TEXT NOT NULL DEFAULT 'off' CHECK(rag_mode IN ('off','shadow','enabled')),
  documents_mode TEXT NOT NULL DEFAULT 'off' CHECK(documents_mode IN ('off','shadow','enabled')),
  agenda_mode TEXT NOT NULL DEFAULT 'off' CHECK(agenda_mode IN ('off','shadow','enabled')),
  daily_tokens BIGINT NOT NULL DEFAULT 500000,
  concurrency BIGINT NOT NULL DEFAULT 4,
  version BIGINT NOT NULL DEFAULT 1,
  failures BIGINT NOT NULL DEFAULT 0,
  circuit_until BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  research_mode TEXT NOT NULL DEFAULT 'off' CHECK(research_mode IN ('off','shadow','enabled'))
);

CREATE TABLE "typesafe_evaluation" (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  user_id TEXT,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  question_version TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  config_version BIGINT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  reserved_tokens BIGINT NOT NULL,
  input_tokens BIGINT,
  output_tokens BIGINT,
  duration_ms BIGINT,
  started_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  day TEXT NOT NULL
);

CREATE TABLE "user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" BOOLEAN NOT NULL,
  "image" text,
  "createdAt" TIMESTAMPTZ not null,
  "updatedAt" TIMESTAMPTZ not null,
  "officeName" text not null
);

CREATE TABLE "vault_case" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 180),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  description TEXT,
  client_name TEXT,
  client_document TEXT,
  client_email TEXT,
  client_phone TEXT,
  client_notes TEXT
);

CREATE TABLE "vault_deletion_queue" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('object', 'vector_document')),
  target_ref TEXT NOT NULL,
  attempts BIGINT NOT NULL DEFAULT 0,
  last_error TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "vault_document" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  case_id TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('library', 'case')),
  original_name TEXT NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),
  stored_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'ready', 'failed')),
  progress BIGINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error_message TEXT,
  extracted_characters BIGINT NOT NULL DEFAULT 0,
  source_count BIGINT NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  folder_id TEXT,
  CHECK ((scope = 'library' AND case_id IS NULL) OR (scope = 'case' AND case_id IS NOT NULL))
);

CREATE TABLE "vault_document_checkpoint" (
  document_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ocr')),
  stable_reference TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (document_id, kind, stable_reference)
);

CREATE TABLE "vault_document_chunk" (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL,
  office_id TEXT NOT NULL,
  ordinal BIGINT NOT NULL CHECK (ordinal >= 0),
  stable_reference TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id, ordinal),
  UNIQUE(document_id, stable_reference),
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('portuguese',content)) STORED
);

CREATE TABLE "vault_document_chunk_vector" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  embedding TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  embedding_blob BYTEA,
  UNIQUE(chunk_id, generation_id)
);

CREATE TABLE "vault_document_version" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  version BIGINT NOT NULL CHECK (version >= 1),
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL,
  created_by TEXT NOT NULL,
  is_active BIGINT NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id, version)
);

CREATE TABLE "vault_extraction_manifest" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  version_id TEXT,
  extractor_version TEXT NOT NULL,
  total_units BIGINT NOT NULL DEFAULT 0,
  completed_units BIGINT NOT NULL DEFAULT 0,
  failed_units BIGINT NOT NULL DEFAULT 0,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "vault_folder" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE "vault_upload_ref" (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" TIMESTAMPTZ not null,
  "createdAt" TIMESTAMPTZ not null,
  "updatedAt" TIMESTAMPTZ not null
);

CREATE INDEX "account_userId_idx" on "account" ("userId");

CREATE INDEX agenda_activity_case_idx ON agenda_activity(office_id, case_id);

CREATE INDEX agenda_activity_client_idx ON agenda_activity(office_id, client_id);

CREATE INDEX agenda_activity_date_idx ON agenda_activity(office_id, due_on, starts_at);

CREATE UNIQUE INDEX agenda_activity_office_identity
  ON agenda_activity(office_id, id);

CREATE INDEX agenda_proposal_owner ON agenda_proposal(office_id,user_id,status);

CREATE INDEX ai_connection_office_idx
  ON ai_connection(office_id, deleted_at);

CREATE INDEX ai_conversation_owner ON ai_conversation(office_id,user_id);

CREATE INDEX ai_run_queue ON ai_run(status,lease_until);

CREATE INDEX artifact_verification_artifact ON artifact_verification(office_id,user_id,artifact_id,created_at);

CREATE INDEX artifact_verification_queue ON artifact_verification(status,lease_until);

CREATE INDEX capability_approval_lookup ON capability_approval(office_id, capability_name, status);

CREATE INDEX capability_idempotency_key ON capability_idempotency(office_id, idempotency_key);

CREATE INDEX crm_client_office_idx ON crm_client(office_id, name, id);

CREATE INDEX judicial_access_audit_office ON judicial_access_audit(office_id, created_at DESC);

CREATE INDEX judicial_alert_inbox ON judicial_alert(office_id, read_at, created_at DESC);

CREATE INDEX judicial_alert_pending ON judicial_alert(delivered_at, created_at);

CREATE INDEX judicial_case_link_case ON judicial_case_link(office_id, case_id, status);

CREATE UNIQUE INDEX judicial_case_link_identity
  ON judicial_case_link(office_id, case_id, installation_id, COALESCE(cnj_number, ''), COALESCE(native_number, ''));

CREATE INDEX judicial_case_link_number ON judicial_case_link(office_id, cnj_number);

CREATE INDEX judicial_connection_office ON judicial_connection(office_id, status);

CREATE INDEX judicial_document_record ON judicial_document(office_id, record_id);

CREATE INDEX judicial_movement_record ON judicial_movement(office_id, record_id, event_at DESC);

CREATE INDEX judicial_publication_inbox ON judicial_publication(office_id, made_available_on DESC, created_at DESC);

CREATE INDEX judicial_publication_link ON judicial_publication(office_id, link_id, published_on DESC);

CREATE INDEX judicial_snapshot_hash ON judicial_snapshot(office_id, installation_id, sha256);

CREATE INDEX judicial_snapshot_record ON judicial_snapshot(office_id, record_id, collected_at DESC);

CREATE INDEX judicial_source_installation_active ON judicial_source_installation(enabled, purpose, court_code);

CREATE INDEX judicial_source_record_link ON judicial_source_record(office_id, link_id, record_kind);

CREATE INDEX judicial_subscription_due ON judicial_subscription(status, next_run_at);

CREATE INDEX judicial_subscription_office ON judicial_subscription(office_id, status);

CREATE UNIQUE INDEX judicial_sync_job_idem ON judicial_sync_job(office_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX judicial_sync_job_office ON judicial_sync_job(office_id, created_at DESC);

CREATE INDEX judicial_sync_job_queue ON judicial_sync_job(status, run_after, lease_until);

CREATE INDEX judicial_vocabulary_lookup ON judicial_vocabulary_term(kind, code);

CREATE INDEX knowledge_index_gen_office ON knowledge_index_generation(office_id, status);

CREATE INDEX knowledge_index_job_queue ON knowledge_index_job(status, lease_until);

CREATE INDEX knowledge_retrieval_audit_office ON knowledge_retrieval_audit(office_id, created_at DESC);

CREATE INDEX knowledge_scope_conv ON knowledge_scope(office_id, conversation_id);

CREATE INDEX model_feedback_campaign_idx ON model_feedback(campaign_id, created_at);

CREATE INDEX notification_delivery_work
  ON notification_delivery(state, next_attempt_at, lease_until, id);

CREATE INDEX notification_event_work
  ON notification_event(projection_state, lease_until, created_at, id);

CREATE UNIQUE INDEX notification_follow_active
  ON notification_follow(office_id, case_id, user_id) WHERE ended_at IS NULL;

CREATE INDEX notification_recipient_inbox
  ON notification_recipient(office_id, user_id, archived_at, created_at DESC, event_id DESC);

CREATE INDEX notification_recipient_unread
  ON notification_recipient(office_id, user_id, read_at, archived_at, created_at DESC);

CREATE INDEX notification_reminder_work
  ON notification_reminder(state, due_at, expires_at, id);

CREATE INDEX office_member_office_idx ON office_member(office_id);

CREATE INDEX platform_audit_actor_idx
  ON platform_audit_log(actor_user_id, created_at);

CREATE INDEX platform_audit_office_idx
  ON platform_audit_log(office_id, created_at);

CREATE INDEX platform_secret_ref_owner ON platform_secret_ref(user_id, expires_at);

CREATE INDEX push_subscription_owner
  ON push_subscription(office_id, user_id, state, last_reconciled_at DESC);

CREATE INDEX research_case_assessment_case ON research_case_assessment(office_id,case_id,created_at DESC);

CREATE INDEX research_case_assessment_queue ON research_case_assessment(status,lease_until,created_at);

CREATE INDEX research_case_profile_office ON research_case_profile(office_id,case_id);

CREATE INDEX research_case_profile_revision_office ON research_case_profile_revision(office_id,case_id,version DESC);

CREATE INDEX research_case_reference_case ON research_case_reference(office_id,case_id,deleted_at,created_at DESC);

CREATE INDEX research_chunk_version ON research_chunk(material_version_id,ordinal);

CREATE INDEX research_job_material ON research_job(material_id,status);

CREATE INDEX research_job_owner ON research_job(office_id,user_id,created_at DESC);

CREATE INDEX research_job_queue ON research_job(status,kind,run_after,lease_until);

CREATE INDEX research_judgment_filter ON research_judgment(tribunal,decision_date DESC,id);

CREATE INDEX research_judgment_installation ON research_judgment(installation_id,status);

CREATE INDEX research_material_status ON research_material(status,kind);

CREATE INDEX research_quarantine_expiry ON research_quarantine(expires_at);

CREATE UNIQUE INDEX research_search_idem ON research_search(office_id,user_id,idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX research_search_owner ON research_search(office_id,user_id,created_at DESC);

CREATE UNIQUE INDEX research_search_page_cursor ON research_search_page(search_id,request_cursor)
  WHERE request_cursor IS NOT NULL;

CREATE INDEX research_search_result_page ON research_search_result(page_id,position);

CREATE INDEX research_stj_mirror_document ON research_stj_mirror_identity(installation_id,document_id);

CREATE INDEX research_version_material ON research_material_version(material_id,created_at DESC);

CREATE INDEX "session_userId_idx" on "session" ("userId");

CREATE INDEX typesafe_evaluation_budget ON typesafe_evaluation(office_id,day,status,expires_at);

CREATE UNIQUE INDEX vault_case_office_identity
  ON vault_case(office_id, id);

CREATE INDEX vault_case_office_idx ON vault_case(office_id, created_at DESC);

CREATE INDEX vault_chunk_vector_lookup ON vault_document_chunk_vector(office_id, document_id, generation_id);

CREATE INDEX vault_deletion_queue_pending ON vault_deletion_queue(completed_at, created_at);

CREATE INDEX vault_document_case_idx ON vault_document(office_id, case_id, created_at DESC);

CREATE INDEX vault_document_chunk_doc ON vault_document_chunk(office_id, document_id, ordinal);

CREATE INDEX vault_document_chunk_document_idx ON vault_document_chunk(document_id, ordinal);

CREATE INDEX vault_document_chunk_office_idx ON vault_document_chunk(office_id, document_id);

CREATE INDEX vault_document_folder_idx ON vault_document(office_id, folder_id, created_at DESC);

CREATE INDEX vault_document_live ON vault_document(office_id, deleted_at, created_at DESC);

CREATE INDEX vault_document_office_idx ON vault_document(office_id, created_at DESC);

CREATE INDEX vault_document_queue_idx ON vault_document(status, lease_expires_at, created_at);

CREATE INDEX vault_document_version_doc ON vault_document_version(document_id, version DESC);

CREATE INDEX vault_document_version_office ON vault_document_version(office_id, document_id);

CREATE INDEX vault_folder_case_idx ON vault_folder(office_id, case_id, parent_id);

CREATE UNIQUE INDEX vault_folder_root_idx ON vault_folder(case_id, name) WHERE deleted_at IS NULL AND parent_id IS NULL;

CREATE UNIQUE INDEX vault_folder_sibling_idx ON vault_folder(case_id, parent_id, name) WHERE deleted_at IS NULL AND parent_id IS NOT NULL;

CREATE INDEX vault_upload_ref_owner ON vault_upload_ref(office_id, user_id, expires_at);

CREATE INDEX "verification_identifier_idx" on "verification" ("identifier");

ALTER TABLE "account" ADD FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "agenda_activity" ADD FOREIGN KEY ("office_id","client_id") REFERENCES "crm_client" ("office_id","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "agenda_activity" ADD FOREIGN KEY ("created_by") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "agenda_activity" ADD FOREIGN KEY ("assignee_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "agenda_activity" ADD FOREIGN KEY ("case_id") REFERENCES "vault_case" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "agenda_activity" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "agenda_proposal" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "agenda_proposal" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "ai_artifact" ADD FOREIGN KEY ("run_id") REFERENCES "ai_run" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "ai_artifact" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "ai_artifact" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "ai_artifact_version" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "ai_artifact_version" ADD FOREIGN KEY ("artifact_id") REFERENCES "ai_artifact" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "ai_checkpoint" ADD FOREIGN KEY ("run_id") REFERENCES "ai_run" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "ai_citation_approval" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "ai_citation_approval" ADD FOREIGN KEY ("run_id") REFERENCES "ai_run" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "ai_connection" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "ai_conversation" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "ai_conversation" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "ai_run" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "ai_run" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "ai_usage" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "artifact_verification" ADD FOREIGN KEY ("artifact_id") REFERENCES "ai_artifact" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "artifact_verification" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "artifact_verification" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "capability_approval" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "capability_approval" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "capability_idempotency" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "capability_idempotency" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "crm_client" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "crm_client_case" ADD FOREIGN KEY ("office_id","client_id") REFERENCES "crm_client" ("office_id","id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "crm_client_case" ADD FOREIGN KEY ("case_id") REFERENCES "vault_case" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "crm_client_case" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_access_audit" ADD FOREIGN KEY ("installation_id") REFERENCES "judicial_source_installation" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_access_audit" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_access_audit" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_alert" ADD FOREIGN KEY ("link_id") REFERENCES "judicial_case_link" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_alert" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_case_link" ADD FOREIGN KEY ("created_by") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_case_link" ADD FOREIGN KEY ("confirmed_by") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_case_link" ADD FOREIGN KEY ("installation_id") REFERENCES "judicial_source_installation" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_case_link" ADD FOREIGN KEY ("case_id") REFERENCES "vault_case" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_case_link" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_connection" ADD FOREIGN KEY ("created_by") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_connection" ADD FOREIGN KEY ("holder_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_connection" ADD FOREIGN KEY ("installation_id") REFERENCES "judicial_source_installation" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_connection" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_document" ADD FOREIGN KEY ("imported_by") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_document" ADD FOREIGN KEY ("vault_document_id") REFERENCES "vault_document" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_document" ADD FOREIGN KEY ("snapshot_id") REFERENCES "judicial_snapshot" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_document" ADD FOREIGN KEY ("record_id") REFERENCES "judicial_source_record" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_document" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_movement" ADD FOREIGN KEY ("snapshot_id") REFERENCES "judicial_snapshot" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_movement" ADD FOREIGN KEY ("record_id") REFERENCES "judicial_source_record" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_movement" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_publication" ADD FOREIGN KEY ("supersedes_id") REFERENCES "judicial_publication" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_publication" ADD FOREIGN KEY ("snapshot_id") REFERENCES "judicial_snapshot" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_publication" ADD FOREIGN KEY ("link_id") REFERENCES "judicial_case_link" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_publication" ADD FOREIGN KEY ("record_id") REFERENCES "judicial_source_record" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_publication" ADD FOREIGN KEY ("installation_id") REFERENCES "judicial_source_installation" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_publication" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_rate_budget" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_rate_budget" ADD FOREIGN KEY ("installation_id") REFERENCES "judicial_source_installation" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_snapshot" ADD FOREIGN KEY ("record_id") REFERENCES "judicial_source_record" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_snapshot" ADD FOREIGN KEY ("installation_id") REFERENCES "judicial_source_installation" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_snapshot" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_source_record" ADD FOREIGN KEY ("link_id") REFERENCES "judicial_case_link" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_source_record" ADD FOREIGN KEY ("installation_id") REFERENCES "judicial_source_installation" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_source_record" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_subscription" ADD FOREIGN KEY ("authorized_by") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_subscription" ADD FOREIGN KEY ("link_id") REFERENCES "judicial_case_link" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_subscription" ADD FOREIGN KEY ("connection_id") REFERENCES "judicial_connection" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_subscription" ADD FOREIGN KEY ("installation_id") REFERENCES "judicial_source_installation" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_subscription" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_sync_job" ADD FOREIGN KEY ("link_id") REFERENCES "judicial_case_link" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_sync_job" ADD FOREIGN KEY ("installation_id") REFERENCES "judicial_source_installation" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_sync_job" ADD FOREIGN KEY ("subscription_id") REFERENCES "judicial_subscription" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "judicial_sync_job" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "knowledge_index_generation" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "knowledge_index_job" ADD FOREIGN KEY ("generation_id") REFERENCES "knowledge_index_generation" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "knowledge_index_job" ADD FOREIGN KEY ("document_id") REFERENCES "vault_document" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "knowledge_index_job" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "knowledge_retrieval_audit" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "knowledge_retrieval_audit" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "knowledge_scope" ADD FOREIGN KEY ("conversation_id") REFERENCES "ai_conversation" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "knowledge_scope" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "knowledge_scope" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "model_feedback" ADD FOREIGN KEY ("office_id","user_id") REFERENCES "office_member" ("office_id","user_id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "notification_delivery" ADD FOREIGN KEY ("office_id","subscription_id") REFERENCES "push_subscription" ("office_id","id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "notification_delivery" ADD FOREIGN KEY ("office_id","event_id","user_id") REFERENCES "notification_recipient" ("office_id","event_id","user_id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "notification_event" ADD FOREIGN KEY ("actor_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "notification_event" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "notification_follow" ADD FOREIGN KEY ("office_id","user_id") REFERENCES "office_member" ("office_id","user_id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "notification_follow" ADD FOREIGN KEY ("office_id","case_id") REFERENCES "vault_case" ("office_id","id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "notification_preference" ADD FOREIGN KEY ("office_id","user_id") REFERENCES "office_member" ("office_id","user_id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "notification_recipient" ADD FOREIGN KEY ("office_id","user_id") REFERENCES "office_member" ("office_id","user_id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "notification_recipient" ADD FOREIGN KEY ("office_id","event_id") REFERENCES "notification_event" ("office_id","id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "notification_reminder" ADD FOREIGN KEY ("office_id","user_id") REFERENCES "office_member" ("office_id","user_id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "notification_reminder" ADD FOREIGN KEY ("office_id","activity_id") REFERENCES "agenda_activity" ("office_id","id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "notification_rollout" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "office_member" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "office_member" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "platform_admin" ADD FOREIGN KEY ("granted_by_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "platform_admin" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "platform_audit_log" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "platform_audit_log" ADD FOREIGN KEY ("actor_user_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "platform_secret_ref" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "push_subscription" ADD FOREIGN KEY ("office_id","user_id") REFERENCES "office_member" ("office_id","user_id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_case_assessment" ADD FOREIGN KEY ("typesafe_evaluation_id") REFERENCES "typesafe_evaluation" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_case_assessment" ADD FOREIGN KEY ("requested_by") REFERENCES "user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_case_assessment" ADD FOREIGN KEY ("material_version_id") REFERENCES "research_material_version" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_case_assessment" ADD FOREIGN KEY ("case_id") REFERENCES "vault_case" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_case_assessment" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_case_profile" ADD FOREIGN KEY ("updated_by") REFERENCES "user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_case_profile" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_case_profile" ADD FOREIGN KEY ("case_id") REFERENCES "vault_case" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_case_profile_revision" ADD FOREIGN KEY ("reviewed_by") REFERENCES "user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_case_profile_revision" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_case_profile_revision" ADD FOREIGN KEY ("case_id") REFERENCES "vault_case" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_case_reference" ADD FOREIGN KEY ("updated_by") REFERENCES "user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_case_reference" ADD FOREIGN KEY ("created_by") REFERENCES "user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_case_reference" ADD FOREIGN KEY ("assessment_id") REFERENCES "research_case_assessment" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_case_reference" ADD FOREIGN KEY ("material_version_id") REFERENCES "research_material_version" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_case_reference" ADD FOREIGN KEY ("case_id") REFERENCES "vault_case" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_case_reference" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_chunk" ADD FOREIGN KEY ("material_version_id") REFERENCES "research_material_version" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_extract_checkpoint" ADD FOREIGN KEY ("material_version_id") REFERENCES "research_material_version" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_job" ADD FOREIGN KEY ("material_id") REFERENCES "research_material" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_job" ADD FOREIGN KEY ("installation_id") REFERENCES "judicial_source_installation" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_job" ADD FOREIGN KEY ("page_id") REFERENCES "research_search_page" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_job" ADD FOREIGN KEY ("search_id") REFERENCES "research_search" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_job" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_job" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_judgment" ADD FOREIGN KEY ("installation_id") REFERENCES "judicial_source_installation" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_material" ADD FOREIGN KEY ("judgment_id") REFERENCES "research_judgment" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_material_claim" ADD FOREIGN KEY ("material_id") REFERENCES "research_material" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_material_version" ADD FOREIGN KEY ("material_id") REFERENCES "research_material" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_quarantine" ADD FOREIGN KEY ("job_id") REFERENCES "research_job" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_quarantine" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_quarantine" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_rerank_cache" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_rerank_cache" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_search" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_search" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_search_page" ADD FOREIGN KEY ("search_id") REFERENCES "research_search" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_search_result" ADD FOREIGN KEY ("version_seen_id") REFERENCES "research_material_version" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_search_result" ADD FOREIGN KEY ("judgment_id") REFERENCES "research_judgment" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_search_result" ADD FOREIGN KEY ("page_id") REFERENCES "research_search_page" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_search_result" ADD FOREIGN KEY ("search_id") REFERENCES "research_search" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_source_budget" ADD FOREIGN KEY ("installation_id") REFERENCES "judicial_source_installation" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_source_resource" ADD FOREIGN KEY ("installation_id") REFERENCES "judicial_source_installation" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_stj_document_link" ADD FOREIGN KEY ("installation_id","document_id") REFERENCES "research_stj_fulltext_identity" ("installation_id","document_id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_stj_document_link" ADD FOREIGN KEY ("actor_user_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_stj_document_link" ADD FOREIGN KEY ("judgment_id") REFERENCES "research_judgment" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_stj_document_link" ADD FOREIGN KEY ("installation_id") REFERENCES "judicial_source_installation" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_stj_fulltext_identity" ADD FOREIGN KEY ("metadata_resource_id") REFERENCES "research_source_resource" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_stj_fulltext_identity" ADD FOREIGN KEY ("installation_id") REFERENCES "judicial_source_installation" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_stj_mirror_identity" ADD FOREIGN KEY ("source_resource_id") REFERENCES "research_source_resource" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_stj_mirror_identity" ADD FOREIGN KEY ("judgment_id") REFERENCES "research_judgment" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "research_stj_mirror_identity" ADD FOREIGN KEY ("installation_id") REFERENCES "judicial_source_installation" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "session" ADD FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "typesafe_connection" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "typesafe_evaluation" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "typesafe_evaluation" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_case" ADD FOREIGN KEY ("created_by") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_case" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_deletion_queue" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_document" ADD FOREIGN KEY ("folder_id") REFERENCES "vault_folder" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_document" ADD FOREIGN KEY ("created_by") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_document" ADD FOREIGN KEY ("case_id") REFERENCES "vault_case" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_document" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_document_checkpoint" ADD FOREIGN KEY ("document_id") REFERENCES "vault_document" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_document_chunk" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_document_chunk" ADD FOREIGN KEY ("document_id") REFERENCES "vault_document" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_document_chunk_vector" ADD FOREIGN KEY ("generation_id") REFERENCES "knowledge_index_generation" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_document_chunk_vector" ADD FOREIGN KEY ("chunk_id") REFERENCES "vault_document_chunk" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_document_chunk_vector" ADD FOREIGN KEY ("document_id") REFERENCES "vault_document" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_document_chunk_vector" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_document_version" ADD FOREIGN KEY ("created_by") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_document_version" ADD FOREIGN KEY ("document_id") REFERENCES "vault_document" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_document_version" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_extraction_manifest" ADD FOREIGN KEY ("version_id") REFERENCES "vault_document_version" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_extraction_manifest" ADD FOREIGN KEY ("document_id") REFERENCES "vault_document" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_extraction_manifest" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_folder" ADD FOREIGN KEY ("created_by") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_folder" ADD FOREIGN KEY ("parent_id") REFERENCES "vault_folder" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_folder" ADD FOREIGN KEY ("case_id") REFERENCES "vault_case" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_folder" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_upload_ref" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vault_upload_ref" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX vault_chunk_search_idx ON vault_document_chunk USING GIN(search_vector);

CREATE TABLE research_fts (
  judgment_id TEXT NOT NULL REFERENCES research_judgment(id) ON DELETE CASCADE,
  material_version_id TEXT NOT NULL REFERENCES research_material_version(id) ON DELETE CASCADE,
  text_content TEXT NOT NULL,
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('portuguese',text_content)) STORED
);

CREATE INDEX research_text_search_idx ON research_fts USING GIN(search_vector);

CREATE INDEX research_text_version_idx ON research_fts(material_version_id);

CREATE FUNCTION notification_event_capture_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_type <> 'system.push.test' AND COALESCE((SELECT capture_enabled FROM notification_rollout WHERE office_id=NEW.office_id),1)=0 THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER notification_event_capture_gate BEFORE INSERT ON notification_event FOR EACH ROW EXECUTE FUNCTION notification_event_capture_gate();
