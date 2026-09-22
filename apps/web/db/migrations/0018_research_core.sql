-- Public judicial reference corpus. Private queries and work are separate and office-scoped.
-- Source permissions and the two installation switches remain in judicial_source_installation.
CREATE TABLE research_judgment (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES judicial_source_installation(id) ON DELETE RESTRICT,
  source_judgment_id TEXT NOT NULL,
  tribunal TEXT NOT NULL,
  court_unit TEXT,
  case_number TEXT,
  class_name TEXT,
  rapporteur TEXT,
  title TEXT NOT NULL,
  decision_date TEXT,
  source_url TEXT,
  source_updated_at TEXT,
  metadata_revision INTEGER NOT NULL DEFAULT 1,
  metadata_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('candidate','active','restricted')),
  collected_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(installation_id, source_judgment_id)
);
CREATE INDEX research_judgment_filter ON research_judgment(tribunal,decision_date DESC,id);
CREATE INDEX research_judgment_installation ON research_judgment(installation_id,status);

CREATE TABLE research_material (
  id TEXT PRIMARY KEY,
  judgment_id TEXT NOT NULL REFERENCES research_judgment(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('ementa','full_text')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','fetching','processing','ready','unavailable','failed','restricted')),
  current_version_id TEXT,
  source_locator TEXT,
  unavailable_reason TEXT,
  source_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(judgment_id,kind)
);
CREATE INDEX research_material_status ON research_material(status,kind);

CREATE TABLE research_material_version (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES research_material(id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
  storage_key TEXT,
  text_content TEXT,
  parser_version TEXT NOT NULL,
  citation_metadata_json TEXT NOT NULL DEFAULT '{}',
  metadata_revision INTEGER NOT NULL,
  source_url TEXT,
  source_updated_at TEXT,
  collected_at TEXT NOT NULL,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(material_id,sha256,parser_version,metadata_revision),
  CHECK(storage_key IS NOT NULL OR text_content IS NOT NULL)
);
CREATE INDEX research_version_material ON research_material_version(material_id,created_at DESC);

CREATE TABLE research_chunk (
  id TEXT PRIMARY KEY,
  material_version_id TEXT NOT NULL REFERENCES research_material_version(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  text_content TEXT NOT NULL,
  reference TEXT NOT NULL,
  page_number INTEGER,
  UNIQUE(material_version_id,ordinal)
);
CREATE INDEX research_chunk_version ON research_chunk(material_version_id,ordinal);
CREATE TABLE research_extract_checkpoint (
  material_version_id TEXT NOT NULL REFERENCES research_material_version(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL CHECK(page_number>0),
  text_content TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('text_layer','ocr')),
  PRIMARY KEY(material_version_id,page_number)
);
CREATE VIRTUAL TABLE research_fts USING fts5(judgment_id UNINDEXED,material_version_id UNINDEXED,text_content,tokenize='unicode61 remove_diacritics 2');

CREATE TABLE research_search (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  theme TEXT NOT NULL,
  filters_json TEXT NOT NULL DEFAULT '{}',
  include_sources INTEGER NOT NULL DEFAULT 0 CHECK(include_sources IN (0,1)),
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','partial','failed','cancelled')),
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX research_search_owner ON research_search(office_id,user_id,created_at DESC);
CREATE UNIQUE INDEX research_search_idem ON research_search(office_id,user_id,idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE research_search_page (
  id TEXT PRIMARY KEY,
  search_id TEXT NOT NULL REFERENCES research_search(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL CHECK(page_number >= 0),
  source_cursor TEXT,
  request_cursor TEXT,
  next_cursor TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','partial','failed')),
  total_reported INTEGER,
  source_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(search_id,page_number)
);
CREATE UNIQUE INDEX research_search_page_cursor ON research_search_page(search_id,request_cursor)
  WHERE request_cursor IS NOT NULL;

CREATE TABLE research_search_result (
  id TEXT PRIMARY KEY,
  search_id TEXT NOT NULL REFERENCES research_search(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES research_search_page(id) ON DELETE CASCADE,
  judgment_id TEXT NOT NULL REFERENCES research_judgment(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK(position >= 0),
  origin TEXT NOT NULL CHECK(origin IN ('local','source')),
  version_seen_id TEXT REFERENCES research_material_version(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(search_id,judgment_id),
  UNIQUE(page_id,position)
);
CREATE INDEX research_search_result_page ON research_search_result(page_id,position);

CREATE TABLE research_job (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  search_id TEXT REFERENCES research_search(id) ON DELETE CASCADE,
  page_id TEXT REFERENCES research_search_page(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL REFERENCES judicial_source_installation(id) ON DELETE RESTRICT,
  material_id TEXT REFERENCES research_material(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('search_page','fetch_material','extract_material','stj_resource')),
  request_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  lease_owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  run_after INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  UNIQUE(office_id,user_id,idempotency_key)
);
CREATE INDEX research_job_queue ON research_job(status,kind,run_after,lease_until);
CREATE INDEX research_job_owner ON research_job(office_id,user_id,created_at DESC);
CREATE INDEX research_job_material ON research_job(material_id,status);

CREATE TABLE research_quarantine (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES research_job(id) ON DELETE CASCADE,
  record_index INTEGER NOT NULL,
  reason TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL DEFAULT (datetime('now','+30 days')),
  UNIQUE(job_id,record_index)
);
CREATE INDEX research_quarantine_expiry ON research_quarantine(expires_at);

-- Global reservation makes simultaneous private requests for the same public bytes one download.
CREATE TABLE research_material_claim (
  material_id TEXT PRIMARY KEY REFERENCES research_material(id) ON DELETE CASCADE,
  lease_owner TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE research_source_budget (
  installation_id TEXT NOT NULL REFERENCES judicial_source_installation(id) ON DELETE CASCADE,
  office_id TEXT NOT NULL,
  window_kind TEXT NOT NULL CHECK(window_kind IN ('minute','day')),
  period_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  max_count INTEGER NOT NULL CHECK(max_count>0),
  CHECK(request_count<=max_count),
  PRIMARY KEY(installation_id,office_id,window_kind,period_start)
);
CREATE TABLE research_source_resource (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES judicial_source_installation(id) ON DELETE CASCADE,
  source_resource_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  resource_kind TEXT NOT NULL,
  etag TEXT,
  source_updated_at TEXT,
  checkpoint TEXT,
  status TEXT NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate','queued','running','completed','failed','restricted')),
  error_code TEXT,
  last_ingested_at TEXT,
  UNIQUE(installation_id,source_resource_id)
);
