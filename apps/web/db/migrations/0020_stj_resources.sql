-- CKAN resource revisions and the two independent STJ document namespaces.
-- A full-text document can be attached to an espelho only through an explicit,
-- evidenced link; process/registration numbers alone are never a join key.
ALTER TABLE research_source_resource ADD COLUMN dataset_slug TEXT;
ALTER TABLE research_source_resource ADD COLUMN resource_name TEXT;
ALTER TABLE research_source_resource ADD COLUMN source_data_date TEXT;
ALTER TABLE research_source_resource ADD COLUMN content_sha256 TEXT;
ALTER TABLE research_source_resource ADD COLUMN ingested_revision TEXT;
ALTER TABLE research_source_resource ADD COLUMN original_storage_key TEXT;

CREATE TABLE research_stj_mirror_identity (
  installation_id TEXT NOT NULL REFERENCES judicial_source_installation(id) ON DELETE CASCADE,
  source_judgment_id TEXT NOT NULL,
  judgment_id TEXT NOT NULL REFERENCES research_judgment(id) ON DELETE CASCADE,
  document_id TEXT,
  registration_number TEXT,
  source_resource_id TEXT NOT NULL REFERENCES research_source_resource(id) ON DELETE RESTRICT,
  source_data_date TEXT NOT NULL,
  PRIMARY KEY(installation_id,source_judgment_id)
);
CREATE INDEX research_stj_mirror_document ON research_stj_mirror_identity(installation_id,document_id);

CREATE TABLE research_stj_fulltext_identity (
  installation_id TEXT NOT NULL REFERENCES judicial_source_installation(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  registration_number TEXT,
  document_type TEXT NOT NULL,
  publication_date TEXT,
  metadata_resource_id TEXT NOT NULL REFERENCES research_source_resource(id) ON DELETE RESTRICT,
  source_data_date TEXT NOT NULL,
  PRIMARY KEY(installation_id,document_id)
);

CREATE TABLE research_stj_document_link (
  installation_id TEXT NOT NULL REFERENCES judicial_source_installation(id) ON DELETE CASCADE,
  judgment_id TEXT NOT NULL REFERENCES research_judgment(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  evidence_url TEXT NOT NULL,
  evidence_note TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  last_published_data_date TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(installation_id,document_id),
  UNIQUE(installation_id,judgment_id),
  FOREIGN KEY(installation_id,document_id)
    REFERENCES research_stj_fulltext_identity(installation_id,document_id) ON DELETE RESTRICT
);
