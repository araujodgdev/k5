CREATE TABLE IF NOT EXISTS office (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS office_member (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('administrator', 'lawyer', 'reviewer')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id),
  UNIQUE (office_id, user_id)
);

CREATE INDEX IF NOT EXISTS office_member_office_idx ON office_member(office_id);
