CREATE TABLE crm_client (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 180),
  email TEXT,
  phone TEXT,
  notes TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL CHECK(stage IN ('prospect', 'active', 'archived')),
  version INTEGER NOT NULL DEFAULT 1,
  mutation_token TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(office_id, id)
);
CREATE INDEX crm_client_office_idx ON crm_client(office_id, name, id);

CREATE TABLE crm_client_case (
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  case_id TEXT NOT NULL REFERENCES vault_case(id) ON DELETE CASCADE,
  PRIMARY KEY(office_id, client_id, case_id),
  FOREIGN KEY(office_id, client_id) REFERENCES crm_client(office_id, id) ON DELETE CASCADE
);

CREATE TABLE agenda_activity (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('task', 'meeting')),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 2 AND 180),
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('pending', 'completed', 'cancelled')),
  due_on TEXT,
  starts_at TEXT,
  ends_at TEXT,
  client_id TEXT,
  case_id TEXT REFERENCES vault_case(id) ON DELETE SET NULL,
  assignee_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(office_id, client_id) REFERENCES crm_client(office_id, id),
  CHECK((kind='task' AND starts_at IS NULL AND ends_at IS NULL) OR
        (kind='meeting' AND due_on IS NULL AND starts_at IS NOT NULL AND ends_at > starts_at))
);
CREATE INDEX agenda_activity_date_idx ON agenda_activity(office_id, due_on, starts_at);
CREATE INDEX agenda_activity_case_idx ON agenda_activity(office_id, case_id);
CREATE INDEX agenda_activity_client_idx ON agenda_activity(office_id, client_id);
