CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Public INPI publications are shared; uploads and search histories remain office/user scoped.
CREATE TABLE inpi_import (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('baseline','rpi')),
  edition INTEGER,
  published_on DATE NOT NULL,
  source_url TEXT NOT NULL,
  sha256 TEXT,
  archive_key TEXT,
  state TEXT NOT NULL CHECK (state IN ('running','completed','failed')),
  record_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  error TEXT
);
CREATE UNIQUE INDEX inpi_import_edition ON inpi_import(edition) WHERE edition IS NOT NULL;
CREATE TABLE inpi_sync (
  id INTEGER PRIMARY KEY CHECK (id=1),
  next_check_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checked_at TIMESTAMPTZ,
  error TEXT
);
INSERT INTO inpi_sync(id) VALUES(1);

CREATE TABLE inpi_trademark (
  process_number TEXT PRIMARY KEY CHECK (process_number ~ '^\d{9}$'),
  name TEXT,
  normalized_name TEXT NOT NULL DEFAULT '',
  owners TEXT[] NOT NULL DEFAULT '{}',
  nice_classes INTEGER[] NOT NULL DEFAULT '{}',
  vienna_codes TEXT[] NOT NULL DEFAULT '{}',
  situation TEXT,
  situation_group TEXT NOT NULL DEFAULT 'unknown' CHECK (situation_group IN ('active','pending','ended','unknown')),
  fields JSONB NOT NULL DEFAULT '{}',
  latest_edition INTEGER,
  published_on DATE NOT NULL,
  import_id TEXT NOT NULL REFERENCES inpi_import(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX inpi_trademark_name ON inpi_trademark USING gin(normalized_name gin_trgm_ops);
CREATE INDEX inpi_trademark_exact_name ON inpi_trademark(normalized_name,process_number);
CREATE INDEX inpi_trademark_nice ON inpi_trademark USING gin(nice_classes);
CREATE INDEX inpi_trademark_vienna ON inpi_trademark USING gin(vienna_codes);
CREATE TABLE inpi_vienna_term (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL
);
CREATE TABLE inpi_trademark_event (
  process_number TEXT NOT NULL REFERENCES inpi_trademark(process_number),
  edition INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  code TEXT NOT NULL,
  description TEXT NOT NULL,
  complement TEXT,
  PRIMARY KEY(process_number,edition,ordinal)
);
ALTER TABLE research_trademark_search ADD COLUMN provider TEXT NOT NULL DEFAULT 'wipo' CHECK(provider IN ('wipo','inpi'));
ALTER TABLE research_trademark_search ADD COLUMN analysis_json JSONB;
ALTER TABLE research_trademark_search ADD COLUMN corpus_json JSONB;
ALTER TABLE research_trademark_upload ADD COLUMN analysis_json JSONB;
