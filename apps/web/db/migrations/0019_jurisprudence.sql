-- Jurisprudence collection (docs/Refinos-MVP/plano-jurisprudencia.md, B1 and B3).
--
-- No office_id, on purpose: this is public, licensed material, identical for every office, and
-- copying it per office would multiply storage and embedding cost without isolating anything.
-- Isolation moves to the search scope instead (B3), which is tested there.
--
-- Chunks, vectors and index generations arrive with B3 in a later migration; each file here runs
-- exactly once, so this one holds only what B1 writes.

-- One row per version of a downloaded file. A resource is not a judgment: one ZIP may hold
-- thousands, and the two counts are kept apart. A replaced file upstream is a new version, never an
-- overwrite, because a source changing a file it already published is itself information.
CREATE TABLE IF NOT EXISTS jurisprudence_resource (
  id TEXT PRIMARY KEY NOT NULL,
  installation_id TEXT NOT NULL REFERENCES judicial_source_installation(id) ON DELETE RESTRICT,
  dataset_id TEXT NOT NULL,
  source_resource_id TEXT NOT NULL,
  name TEXT,
  url TEXT NOT NULL,
  format TEXT,
  content_kind TEXT NOT NULL CHECK (content_kind IN ('ementa', 'espelho', 'inteiro_teor', 'sumula', 'tema', 'decisao_monocratica')),
  -- What the source declared; a change here is what triggers a new download.
  declared_checksum TEXT NOT NULL,
  -- What was actually received, and where those exact bytes are kept.
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  storage_key TEXT NOT NULL,
  license_title TEXT,
  license_url TEXT,
  attribution TEXT,
  version INTEGER NOT NULL CHECK (version >= 1),
  supersedes_id TEXT REFERENCES jurisprudence_resource(id) ON DELETE RESTRICT,
  documents_count INTEGER NOT NULL DEFAULT 0 CHECK (documents_count >= 0),
  rejected_count INTEGER NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  parser_version TEXT NOT NULL,
  source_updated_at TEXT,
  collected_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (installation_id, source_resource_id, version)
);

CREATE INDEX IF NOT EXISTS jurisprudence_resource_latest ON jurisprudence_resource(installation_id, source_resource_id, version DESC);

-- One row per version of a document. An older version stays readable and citable with the date it
-- was collected; a citation made against it keeps resolving to it.
CREATE TABLE IF NOT EXISTS jurisprudence_document (
  id TEXT PRIMARY KEY NOT NULL,
  installation_id TEXT NOT NULL REFERENCES judicial_source_installation(id) ON DELETE RESTRICT,
  resource_id TEXT NOT NULL REFERENCES jurisprudence_resource(id) ON DELETE RESTRICT,
  source_document_id TEXT NOT NULL,
  court TEXT NOT NULL,
  organ TEXT,
  content_kind TEXT NOT NULL CHECK (content_kind IN ('ementa', 'espelho', 'inteiro_teor', 'sumula', 'tema', 'decisao_monocratica')),
  cnj_number TEXT,
  native_number TEXT,
  title TEXT,
  rapporteur TEXT,
  judged_on TEXT,
  published_on TEXT,
  headnote TEXT,
  full_text_ref TEXT,
  citation_label TEXT NOT NULL,
  checksum TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  supersedes_id TEXT REFERENCES jurisprudence_document(id) ON DELETE RESTRICT,
  -- Declared by the source, then resolved to a row; never inferred from similar text.
  related_source_document_id TEXT,
  related_document_id TEXT REFERENCES jurisprudence_document(id) ON DELETE SET NULL,
  -- Null license means undeclared: stored, but neither indexed for AI nor exportable.
  license_title TEXT,
  license_url TEXT,
  attribution TEXT,
  -- The installation's five permissions as they stood when this was collected.
  permissions TEXT NOT NULL CHECK (json_valid(permissions)),
  source_updated_at TEXT,
  collected_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (installation_id, source_document_id, version)
);

CREATE INDEX IF NOT EXISTS jurisprudence_document_latest ON jurisprudence_document(installation_id, source_document_id, version DESC);
CREATE INDEX IF NOT EXISTS jurisprudence_document_resource ON jurisprudence_document(resource_id);
CREATE INDEX IF NOT EXISTS jurisprudence_document_related ON jurisprudence_document(installation_id, related_source_document_id)
  WHERE related_source_document_id IS NOT NULL;
