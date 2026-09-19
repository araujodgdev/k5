-- Judicial data infrastructure, phase F1 (foundation) of docs/plano-infra-judicial.md.
-- Nothing here collects data by itself: every table is inert until an installation is enabled
-- and an office creates a connection or a subscription through an authenticated operation.

-- Public configuration of one source installation. Deliberately global and deliberately without
-- secrets: a court contract version and coverage window are not one office's business data.
-- The unit is "orgao + instalacao + grau + sistema + finalidade + intervalo", not the court acronym.
CREATE TABLE IF NOT EXISTS judicial_source_installation (
  id TEXT PRIMARY KEY NOT NULL,
  -- How the source is talked to, which decides the connector, not what the data means.
  kind TEXT NOT NULL CHECK (kind IN ('djen', 'mni', 'ckan', 'jurisprudence_api', 'vocabulary', 'court_portal')),
  court_code TEXT NOT NULL,
  court_name TEXT NOT NULL,
  -- An installation covers one degree; a court with two systems is two rows, never one.
  degree TEXT NOT NULL CHECK (degree IN ('first', 'second', 'superior', 'panel', 'not_applicable')),
  system TEXT NOT NULL CHECK (system IN ('pje', 'eproc', 'esaj', 'projudi', 'saj', 'sei', 'proprietary', 'not_applicable')),
  purpose TEXT NOT NULL CHECK (purpose IN ('publications', 'case_tracking', 'jurisprudence', 'vocabulary')),
  -- Coverage the source is documented to hold, which is not the coverage already collected.
  coverage_from TEXT,
  coverage_to TEXT,
  base_url TEXT,
  contract_version TEXT,
  auth_kind TEXT NOT NULL DEFAULT 'none' CHECK (auth_kind IN ('none', 'public_key', 'institutional', 'delegated_lawyer', 'recipient')),
  -- Section 4.2 step 10: an advance needs evidence. Every row starts at 'candidate'.
  discovery_status TEXT NOT NULL DEFAULT 'candidate' CHECK (discovery_status IN (
    'candidate', 'documented', 'access_pending', 'spike_approved', 'pilot', 'production', 'degraded', 'suspended'
  )),
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  -- Five independent permissions (section 4.3). Collapsing these into one boolean is the bug
  -- this column exists to prevent: a source may allow a query and forbid sending it to a model.
  permission_query TEXT NOT NULL DEFAULT 'nao_esclarecido' CHECK (permission_query IN ('permitido', 'restrito', 'proibido', 'nao_esclarecido')),
  permission_cache TEXT NOT NULL DEFAULT 'nao_esclarecido' CHECK (permission_cache IN ('permitido', 'restrito', 'proibido', 'nao_esclarecido')),
  permission_documents TEXT NOT NULL DEFAULT 'nao_esclarecido' CHECK (permission_documents IN ('permitido', 'restrito', 'proibido', 'nao_esclarecido')),
  permission_redistribution TEXT NOT NULL DEFAULT 'nao_esclarecido' CHECK (permission_redistribution IN ('permitido', 'restrito', 'proibido', 'nao_esclarecido')),
  permission_ai TEXT NOT NULL DEFAULT 'nao_esclarecido' CHECK (permission_ai IN ('permitido', 'restrito', 'proibido', 'nao_esclarecido')),
  permission_evidence TEXT,
  -- Egress is refused unless the host is listed here, so a redirect cannot walk the collector
  -- to a host nobody approved for this installation.
  allowed_hosts TEXT NOT NULL DEFAULT '[]',
  -- Two independent switches. `enabled` is the operator decision; `live_transport_enabled` is
  -- the separate act of permitting real network egress, which stays off until F0 clears the source.
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  live_transport_enabled INTEGER NOT NULL DEFAULT 0 CHECK (live_transport_enabled IN (0, 1)),
  -- Published ceiling and the lower budget K5 holds itself to, measured per source, not per worker.
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 10 CHECK (rate_limit_per_minute > 0),
  daily_request_budget INTEGER NOT NULL DEFAULT 500 CHECK (daily_request_budget > 0),
  notes TEXT,
  documentation_url TEXT,
  documentation_reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (kind, court_code, degree, system, purpose)
);

CREATE INDEX IF NOT EXISTS judicial_source_installation_active ON judicial_source_installation(enabled, purpose, court_code);

-- An office's authorization to use one installation. The credential itself never lands here:
-- the column holds a reference to an encrypted secret, the same shape the AI connections use.
CREATE TABLE IF NOT EXISTS judicial_connection (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL REFERENCES judicial_source_installation(id) ON DELETE RESTRICT,
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 2 AND 120),
  -- Who the credential belongs to. A personal lawyer login is not an institutional grant, and
  -- the distinction decides whether recurring collection may run without that person present.
  holder_kind TEXT NOT NULL DEFAULT 'institutional' CHECK (holder_kind IN ('institutional', 'lawyer', 'recipient')),
  holder_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  secret_ref TEXT,
  secret_hint TEXT,
  scopes TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'needs_attention')),
  expires_at TEXT,
  last_verified_at TEXT,
  created_by TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (office_id, installation_id, label)
);

CREATE INDEX IF NOT EXISTS judicial_connection_office ON judicial_connection(office_id, status);

-- A vault case may carry several proceedings, and one proceeding may exist in several
-- installations, so this is a link table and not a column on vault_case.
CREATE TABLE IF NOT EXISTS judicial_case_link (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES vault_case(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL REFERENCES judicial_source_installation(id) ON DELETE RESTRICT,
  -- 20 digits, no punctuation. Null when the proceeding only has a native/legacy identity.
  cnj_number TEXT,
  -- Preserved exactly as the source writes it; the CNJ number is not the only key of an instance.
  native_number TEXT,
  degree TEXT NOT NULL CHECK (degree IN ('first', 'second', 'superior', 'panel', 'not_applicable')),
  -- 'confirmed' requires a person; automatic linking is only for a trustworthy identifier.
  confirmation TEXT NOT NULL DEFAULT 'pending_review' CHECK (confirmation IN ('confirmed', 'pending_review', 'rejected')),
  confirmed_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  confirmed_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'unlinked')),
  created_by TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (cnj_number IS NOT NULL OR native_number IS NOT NULL)
);

-- Two links to the same proceeding in the same installation are the same link. NULL never equals
-- NULL in a UNIQUE constraint, so the identity columns are coalesced into one expression index.
CREATE UNIQUE INDEX IF NOT EXISTS judicial_case_link_identity
  ON judicial_case_link(office_id, case_id, installation_id, COALESCE(cnj_number, ''), COALESCE(native_number, ''));
CREATE INDEX IF NOT EXISTS judicial_case_link_case ON judicial_case_link(office_id, case_id, status);
CREATE INDEX IF NOT EXISTS judicial_case_link_number ON judicial_case_link(office_id, cnj_number);

-- Identity of a record as the source knows it. Several rows may describe the same proceeding;
-- recording that they might be equivalent is a later, separate judgement.
CREATE TABLE IF NOT EXISTS judicial_source_record (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL REFERENCES judicial_source_installation(id) ON DELETE RESTRICT,
  link_id TEXT REFERENCES judicial_case_link(id) ON DELETE SET NULL,
  source_record_id TEXT NOT NULL,
  record_kind TEXT NOT NULL CHECK (record_kind IN ('case', 'publication', 'decision', 'document')),
  cnj_number TEXT,
  native_number TEXT,
  title TEXT,
  -- Declared by the source, which is not when K5 saw it.
  source_updated_at TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (office_id, installation_id, source_record_id)
);

CREATE INDEX IF NOT EXISTS judicial_source_record_link ON judicial_source_record(office_id, link_id, record_kind);

-- The original payload, kept before anything normalized is published. A parser change re-reads
-- this row instead of asking the court again.
CREATE TABLE IF NOT EXISTS judicial_snapshot (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL REFERENCES judicial_source_installation(id) ON DELETE RESTRICT,
  record_id TEXT REFERENCES judicial_source_record(id) ON DELETE SET NULL,
  job_id TEXT,
  operation TEXT NOT NULL,
  request_summary TEXT NOT NULL DEFAULT '{}',
  -- Small payloads inline, large ones in object storage; exactly one of the two is set.
  payload TEXT,
  storage_key TEXT,
  content_type TEXT NOT NULL DEFAULT 'application/json',
  byte_size INTEGER NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL,
  parser_version TEXT NOT NULL DEFAULT 'unversioned',
  -- The moment of the query, distinct from ingestion and from any date inside the payload.
  collected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ingested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  visibility TEXT NOT NULL DEFAULT 'restricted' CHECK (visibility IN ('public', 'restricted', 'sealed')),
  usage_conditions TEXT NOT NULL DEFAULT '{}',
  -- Section 8: a snapshot is versioned but never immune to a mandatory deletion.
  redacted_at TEXT,
  redaction_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((payload IS NOT NULL AND storage_key IS NULL) OR (payload IS NULL AND storage_key IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS judicial_snapshot_record ON judicial_snapshot(office_id, record_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS judicial_snapshot_hash ON judicial_snapshot(office_id, installation_id, sha256);

-- One docket movement. The original code and text are authoritative; the TPU code is only filled
-- when the source stated it, never inferred from a description that merely looks similar.
CREATE TABLE IF NOT EXISTS judicial_movement (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL REFERENCES judicial_source_record(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL REFERENCES judicial_snapshot(id) ON DELETE RESTRICT,
  source_movement_id TEXT,
  source_code TEXT,
  source_text TEXT NOT NULL,
  tpu_code TEXT,
  tpu_source TEXT CHECK (tpu_source IS NULL OR tpu_source IN ('source_declared', 'catalog_exact')),
  -- When the event happened, per the source.
  event_at TEXT NOT NULL,
  event_precision TEXT NOT NULL DEFAULT 'date' CHECK (event_precision IN ('date', 'minute', 'second')),
  event_timezone TEXT,
  -- A code plus a date is not an identity; this fingerprint also covers the stable text fields.
  fingerprint TEXT NOT NULL,
  ingested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (office_id, record_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS judicial_movement_record ON judicial_movement(office_id, record_id, event_at DESC);

-- A publication. Republication and errata create a relation between versions instead of
-- overwriting the earlier row, so the record of what was published stays readable.
CREATE TABLE IF NOT EXISTS judicial_publication (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL REFERENCES judicial_source_installation(id) ON DELETE RESTRICT,
  record_id TEXT REFERENCES judicial_source_record(id) ON DELETE SET NULL,
  link_id TEXT REFERENCES judicial_case_link(id) ON DELETE SET NULL,
  snapshot_id TEXT NOT NULL REFERENCES judicial_snapshot(id) ON DELETE RESTRICT,
  source_publication_id TEXT,
  cnj_number TEXT,
  edition TEXT,
  page TEXT,
  official_hash TEXT,
  body TEXT NOT NULL,
  -- Three different dates the sources keep apart, so K5 keeps them apart too.
  made_available_on TEXT,
  published_on TEXT,
  source_updated_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  supersedes_id TEXT REFERENCES judicial_publication(id) ON DELETE SET NULL,
  revision_kind TEXT NOT NULL DEFAULT 'original' CHECK (revision_kind IN ('original', 'republication', 'errata')),
  fingerprint TEXT NOT NULL,
  ingested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (office_id, installation_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS judicial_publication_inbox ON judicial_publication(office_id, made_available_on DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS judicial_publication_link ON judicial_publication(office_id, link_id, published_on DESC);

-- An external document. It may later be imported into the Vault, but the external record and the
-- vault copy stay distinct rows: deleting one must not silently erase the provenance of the other.
CREATE TABLE IF NOT EXISTS judicial_document (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL REFERENCES judicial_source_record(id) ON DELETE CASCADE,
  snapshot_id TEXT REFERENCES judicial_snapshot(id) ON DELETE SET NULL,
  source_document_id TEXT NOT NULL,
  title TEXT NOT NULL,
  document_type TEXT,
  mime_type TEXT,
  byte_size INTEGER NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
  sha256 TEXT,
  storage_key TEXT,
  vault_document_id TEXT REFERENCES vault_document(id) ON DELETE SET NULL,
  imported_at TEXT,
  imported_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (office_id, record_id, source_document_id)
);

CREATE INDEX IF NOT EXISTS judicial_document_record ON judicial_document(office_id, record_id);

-- Standing authorization for recurring collection. A job runs against this row, not against a
-- user session kept artificially alive.
CREATE TABLE IF NOT EXISTS judicial_subscription (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL REFERENCES judicial_source_installation(id) ON DELETE RESTRICT,
  connection_id TEXT REFERENCES judicial_connection(id) ON DELETE SET NULL,
  link_id TEXT REFERENCES judicial_case_link(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('case', 'publications_by_case', 'jurisprudence_collection')),
  filters TEXT NOT NULL DEFAULT '{}',
  interval_minutes INTEGER NOT NULL DEFAULT 360 CHECK (interval_minutes >= 15),
  daily_request_budget INTEGER NOT NULL DEFAULT 50 CHECK (daily_request_budget > 0),
  -- Everything already collected up to here. Overlap on the next window is deliberate.
  watermark TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'suspended', 'cancelled')),
  suspended_reason TEXT,
  next_run_at INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  -- The person who authorized recurring access; their membership is rechecked before each run.
  authorized_by TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS judicial_subscription_due ON judicial_subscription(status, next_run_at);
CREATE INDEX IF NOT EXISTS judicial_subscription_office ON judicial_subscription(office_id, status);

-- Durable collection work with a lease, a cursor and a checkpoint. Retrying a job is allowed;
-- duplicating its visible effects is not, which is what the outbox below is for.
CREATE TABLE IF NOT EXISTS judicial_sync_job (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  subscription_id TEXT REFERENCES judicial_subscription(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL REFERENCES judicial_source_installation(id) ON DELETE RESTRICT,
  link_id TEXT REFERENCES judicial_case_link(id) ON DELETE CASCADE,
  -- Backfill is a separate kind so a historical sweep cannot starve routine updates.
  kind TEXT NOT NULL CHECK (kind IN ('refresh', 'backfill', 'manual')),
  operation TEXT NOT NULL,
  request TEXT NOT NULL DEFAULT '{}',
  window_from TEXT,
  window_to TEXT,
  cursor TEXT,
  pages_fetched INTEGER NOT NULL DEFAULT 0 CHECK (pages_fetched >= 0),
  records_accepted INTEGER NOT NULL DEFAULT 0 CHECK (records_accepted >= 0),
  records_rejected INTEGER NOT NULL DEFAULT 0 CHECK (records_rejected >= 0),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'quarantined')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  run_after INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS judicial_sync_job_queue ON judicial_sync_job(status, run_after, lease_until);
CREATE INDEX IF NOT EXISTS judicial_sync_job_office ON judicial_sync_job(office_id, created_at DESC);
-- A queued job for the same target is reused instead of piling up behind a manual "Atualizar".
CREATE UNIQUE INDEX IF NOT EXISTS judicial_sync_job_idem ON judicial_sync_job(office_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Outbox. The row is written in the same transaction as the data that caused it; delivery is a
-- later, separately-retried step, and the unique dedupe key is what stops a replayed job from
-- announcing the same publication twice.
CREATE TABLE IF NOT EXISTS judicial_alert (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  link_id TEXT REFERENCES judicial_case_link(id) ON DELETE CASCADE,
  -- A record found during a backfill is historical, not news from today.
  event_kind TEXT NOT NULL CHECK (event_kind IN ('new_publication', 'historical_publication', 'new_movement', 'correction', 'sync_failed', 'coverage_gap')),
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('publication', 'movement', 'job', 'subscription')),
  subject_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  delivered_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (office_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS judicial_alert_pending ON judicial_alert(delivered_at, created_at);
CREATE INDEX IF NOT EXISTS judicial_alert_inbox ON judicial_alert(office_id, read_at, created_at DESC);

-- Who reached which evidence and why. Identifiers and purpose only: no payload, no credential.
CREATE TABLE IF NOT EXISTS judicial_access_audit (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  actor TEXT NOT NULL DEFAULT 'user' CHECK (actor IN ('user', 'agent', 'worker')),
  action TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  subject_id TEXT,
  installation_id TEXT REFERENCES judicial_source_installation(id) ON DELETE SET NULL,
  purpose TEXT,
  outcome TEXT NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok', 'denied', 'error')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS judicial_access_audit_office ON judicial_access_audit(office_id, created_at DESC);

-- Request accounting per installation, per office and per UTC day. A global ceiling divided
-- among workers is still one ceiling: the counter lives in the database, not in a process.
CREATE TABLE IF NOT EXISTS judicial_rate_budget (
  installation_id TEXT NOT NULL REFERENCES judicial_source_installation(id) ON DELETE CASCADE,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0 CHECK (requests >= 0),
  last_request_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (installation_id, office_id, day)
);

-- Normalized national vocabulary. Codes the catalog does not know are preserved upstream rather
-- than mapped by resemblance, so this table only ever holds what an official distribution stated.
CREATE TABLE IF NOT EXISTS judicial_vocabulary_term (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('class', 'subject', 'movement')),
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  parent_code TEXT,
  valid_from TEXT,
  valid_to TEXT,
  version TEXT NOT NULL DEFAULT 'unversioned',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (kind, code, version)
);

CREATE INDEX IF NOT EXISTS judicial_vocabulary_lookup ON judicial_vocabulary_term(kind, code);
