-- A case is a folder, not a tag. It has a title, a description and — behind an advanced section —
-- the client's own data, which is why those columns are nullable and separate from the name: an
-- office can file documents long before it has the client's full qualification.
ALTER TABLE vault_case ADD COLUMN description TEXT;
ALTER TABLE vault_case ADD COLUMN client_name TEXT;
ALTER TABLE vault_case ADD COLUMN client_document TEXT;
ALTER TABLE vault_case ADD COLUMN client_email TEXT;
ALTER TABLE vault_case ADD COLUMN client_phone TEXT;
ALTER TABLE vault_case ADD COLUMN client_notes TEXT;

-- Subdirectories inside a case. The parent is a folder of the same case, so a rename or a move
-- cannot smuggle a folder into another office's tree; office_id is carried on the row anyway
-- because every read path filters on it directly.
CREATE TABLE IF NOT EXISTS vault_folder (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES vault_case(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES vault_folder(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  created_by TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS vault_folder_case_idx ON vault_folder(office_id, case_id, parent_id);
-- Two siblings cannot share a name; the case root is modelled as parent_id IS NULL, and SQLite
-- treats NULLs as distinct in a UNIQUE index, so the root level gets its own partial index.
CREATE UNIQUE INDEX IF NOT EXISTS vault_folder_sibling_idx ON vault_folder(case_id, parent_id, name) WHERE deleted_at IS NULL AND parent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vault_folder_root_idx ON vault_folder(case_id, name) WHERE deleted_at IS NULL AND parent_id IS NULL;

-- Where the document sits inside its case. NULL is the case root, which is also what every
-- document written before this migration keeps.
ALTER TABLE vault_document ADD COLUMN folder_id TEXT REFERENCES vault_folder(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS vault_document_folder_idx ON vault_document(office_id, folder_id, created_at DESC);
