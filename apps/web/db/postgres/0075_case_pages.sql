CREATE TABLE case_page (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id),
  case_id TEXT NOT NULL REFERENCES vault_case(id),
  folder_id TEXT REFERENCES vault_folder(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  source_dependencies JSONB NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX case_page_case ON case_page(office_id, case_id, folder_id);
CREATE TABLE case_page_version (
  page_id TEXT NOT NULL REFERENCES case_page(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_dependencies JSONB NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(page_id, version)
);
CREATE TABLE case_page_approval (
  approval_id TEXT PRIMARY KEY REFERENCES capability_approval(id) ON DELETE CASCADE,
  source_dependencies JSONB NOT NULL,
  conversation_id TEXT,
  result_page_id TEXT REFERENCES case_page(id),
  result_version INTEGER
);
CREATE TABLE ai_source_provenance (
  office_id TEXT NOT NULL REFERENCES office(id),
  user_id TEXT NOT NULL REFERENCES "user"(id),
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('conversation', 'artifact')),
  resource_id TEXT NOT NULL,
  complete BOOLEAN NOT NULL,
  dependencies JSONB NOT NULL DEFAULT '[]',
  PRIMARY KEY(office_id, user_id, resource_kind, resource_id)
);
