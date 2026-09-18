ALTER TABLE vault_document ADD COLUMN deleted_at TEXT;
ALTER TABLE vault_case ADD COLUMN deleted_at TEXT;

CREATE TABLE IF NOT EXISTS vault_document_version (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES vault_document(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id, version)
);
CREATE INDEX IF NOT EXISTS vault_document_version_doc ON vault_document_version(document_id, version DESC);
CREATE INDEX IF NOT EXISTS vault_document_version_office ON vault_document_version(office_id, document_id);

CREATE TABLE IF NOT EXISTS vault_extraction_manifest (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES vault_document(id) ON DELETE CASCADE,
  version_id TEXT REFERENCES vault_document_version(id) ON DELETE CASCADE,
  extractor_version TEXT NOT NULL,
  total_units INTEGER NOT NULL DEFAULT 0,
  completed_units INTEGER NOT NULL DEFAULT 0,
  failed_units INTEGER NOT NULL DEFAULT 0,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS knowledge_index_generation (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  profile_name TEXT NOT NULL,
  model_id TEXT NOT NULL,
  dimension INTEGER NOT NULL,
  chunker TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'building', 'retired', 'failed')),
  count_expected INTEGER NOT NULL DEFAULT 0,
  count_published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS knowledge_index_gen_office ON knowledge_index_generation(office_id, status);

CREATE TABLE IF NOT EXISTS vault_document_chunk_vector (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES vault_document(id) ON DELETE CASCADE,
  chunk_id TEXT NOT NULL REFERENCES vault_document_chunk(id) ON DELETE CASCADE,
  generation_id TEXT NOT NULL REFERENCES knowledge_index_generation(id) ON DELETE CASCADE,
  embedding TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(chunk_id, generation_id)
);
CREATE INDEX IF NOT EXISTS vault_chunk_vector_lookup ON vault_document_chunk_vector(office_id, document_id, generation_id);

CREATE TABLE IF NOT EXISTS knowledge_scope (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES ai_conversation(id) ON DELETE CASCADE,
  document_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS knowledge_scope_conv ON knowledge_scope(office_id, conversation_id);

CREATE TABLE IF NOT EXISTS knowledge_retrieval_audit (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  strategy TEXT NOT NULL,
  degraded INTEGER NOT NULL DEFAULT 0,
  document_count INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS knowledge_retrieval_audit_office ON knowledge_retrieval_audit(office_id, created_at DESC);

CREATE TABLE IF NOT EXISTS capability_approval (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  capability_name TEXT NOT NULL,
  normalized_input TEXT NOT NULL,
  target_resource_id TEXT,
  target_version INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'consumed')),
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  consumed_at TEXT
);
CREATE INDEX IF NOT EXISTS capability_approval_lookup ON capability_approval(office_id, capability_name, status);

CREATE TABLE IF NOT EXISTS capability_idempotency (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  capability_name TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  response_payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(office_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS capability_idempotency_key ON capability_idempotency(office_id, idempotency_key);
