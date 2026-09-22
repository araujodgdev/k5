-- Case research is private to an office. Public corpus rows are never owned or deleted by a case.
CREATE TABLE research_case_profile (
  case_id TEXT PRIMARY KEY REFERENCES vault_case(id) ON DELETE CASCADE,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  legal_question TEXT NOT NULL,
  objective TEXT NOT NULL,
  thesis TEXT,
  documented_facts_json TEXT NOT NULL DEFAULT '[]',
  alleged_facts_json TEXT NOT NULL DEFAULT '[]',
  gaps_json TEXT NOT NULL DEFAULT '[]',
  document_ids_json TEXT NOT NULL DEFAULT '[]',
  updated_by TEXT NOT NULL REFERENCES user(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX research_case_profile_office ON research_case_profile(office_id,case_id);

CREATE TABLE research_case_profile_revision (
  case_id TEXT NOT NULL REFERENCES vault_case(id) ON DELETE CASCADE,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  reviewed_by TEXT NOT NULL REFERENCES user(id),
  reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(case_id,version)
);
CREATE INDEX research_case_profile_revision_office ON research_case_profile_revision(office_id,case_id,version DESC);

CREATE TABLE research_case_assessment (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES vault_case(id) ON DELETE CASCADE,
  material_version_id TEXT NOT NULL REFERENCES research_material_version(id) ON DELETE RESTRICT,
  requested_by TEXT NOT NULL REFERENCES user(id),
  profile_version INTEGER,
  input_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','evaluated','incomplete','disabled','unavailable','budget_exceeded','stale')),
  mode TEXT NOT NULL CHECK(mode IN ('off','shadow','enabled')),
  model TEXT,
  question_version TEXT NOT NULL,
  config_version INTEGER,
  result_json TEXT,
  reason TEXT,
  typesafe_evaluation_id TEXT REFERENCES typesafe_evaluation(id),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(office_id,case_id,material_version_id,input_fingerprint)
);
CREATE INDEX research_case_assessment_queue ON research_case_assessment(status,lease_until,created_at);
CREATE INDEX research_case_assessment_case ON research_case_assessment(office_id,case_id,created_at DESC);

CREATE TABLE research_case_reference (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES vault_case(id) ON DELETE CASCADE,
  material_version_id TEXT NOT NULL REFERENCES research_material_version(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL CHECK(purpose IN ('foundation','counterpoint','context')),
  notes TEXT NOT NULL DEFAULT '',
  assessment_id TEXT REFERENCES research_case_assessment(id) ON DELETE SET NULL,
  bypass_evaluation INTEGER NOT NULL DEFAULT 0 CHECK(bypass_evaluation IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_by TEXT NOT NULL REFERENCES user(id),
  updated_by TEXT NOT NULL REFERENCES user(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  UNIQUE(office_id,case_id,material_version_id)
);
CREATE INDEX research_case_reference_case ON research_case_reference(office_id,case_id,deleted_at,created_at DESC);

CREATE TABLE research_rerank_cache (
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  model TEXT NOT NULL,
  config_version INTEGER NOT NULL,
  ordered_ids_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(office_id,user_id,fingerprint)
);

ALTER TABLE typesafe_connection ADD COLUMN research_mode TEXT NOT NULL DEFAULT 'off' CHECK(research_mode IN ('off','shadow','enabled'));

-- Human-approved citations retain their pinned public provenance in durable runs.
ALTER TABLE ai_citation_approval ADD COLUMN source_type TEXT NOT NULL DEFAULT 'vault' CHECK(source_type IN ('vault','research'));
ALTER TABLE ai_citation_approval ADD COLUMN document_id TEXT;
ALTER TABLE ai_citation_approval ADD COLUMN research_reference_id TEXT;
ALTER TABLE ai_citation_approval ADD COLUMN material_version_id TEXT;
ALTER TABLE ai_citation_approval ADD COLUMN judgment_id TEXT;
ALTER TABLE ai_citation_approval ADD COLUMN research_chunk_id TEXT;

ALTER TABLE knowledge_scope ADD COLUMN case_id TEXT;
ALTER TABLE knowledge_scope ADD COLUMN research_reference_ids TEXT NOT NULL DEFAULT '[]';
