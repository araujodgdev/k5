-- Durable, per-person notifications. The inbox is authoritative; Web Push is an optional
-- delivery channel whose acceptance never means that a person read the notification.

CREATE UNIQUE INDEX IF NOT EXISTS agenda_activity_office_identity
  ON agenda_activity(office_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS vault_case_office_identity
  ON vault_case(office_id, id);

CREATE TABLE notification_event (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 3 AND 100),
  payload_version INTEGER NOT NULL DEFAULT 1 CHECK(payload_version > 0),
  source_kind TEXT NOT NULL CHECK(source_kind IN (
    'activity', 'case', 'document', 'run', 'artifact', 'judicial_alert', 'system'
  )),
  source_id TEXT,
  source_version INTEGER,
  actor_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  intended_recipients_json TEXT NOT NULL CHECK(json_valid(intended_recipients_json)),
  data_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data_json)),
  dedupe_key TEXT NOT NULL,
  historical INTEGER NOT NULL DEFAULT 0 CHECK(historical IN (0, 1)),
  push_eligible INTEGER NOT NULL DEFAULT 1 CHECK(push_eligible IN (0, 1)),
  projection_state TEXT NOT NULL DEFAULT 'pending' CHECK(projection_state IN ('pending', 'leased', 'projected', 'dead')),
  projection_attempts INTEGER NOT NULL DEFAULT 0 CHECK(projection_attempts >= 0),
  lease_token TEXT,
  lease_until TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  projected_at TEXT,
  last_error TEXT,
  UNIQUE(office_id, dedupe_key),
  UNIQUE(office_id, id)
);

CREATE INDEX notification_event_work
  ON notification_event(projection_state, lease_until, created_at, id);

CREATE TABLE notification_recipient (
  event_id TEXT NOT NULL,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  read_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(event_id, user_id),
  UNIQUE(office_id, event_id, user_id),
  FOREIGN KEY(office_id, event_id) REFERENCES notification_event(office_id, id) ON DELETE CASCADE,
  FOREIGN KEY(office_id, user_id) REFERENCES office_member(office_id, user_id) ON DELETE CASCADE
);

CREATE INDEX notification_recipient_inbox
  ON notification_recipient(office_id, user_id, archived_at, created_at DESC, event_id DESC);
CREATE INDEX notification_recipient_unread
  ON notification_recipient(office_id, user_id, read_at, archived_at, created_at DESC);

CREATE TABLE notification_preference (
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo' CHECK(length(timezone) BETWEEN 1 AND 100),
  quiet_enabled INTEGER NOT NULL DEFAULT 0 CHECK(quiet_enabled IN (0, 1)),
  quiet_start TEXT,
  quiet_end TEXT,
  push_enabled INTEGER NOT NULL DEFAULT 1 CHECK(push_enabled IN (0, 1)),
  categories_json TEXT NOT NULL DEFAULT '{"agenda":true,"vault":true,"documents":true,"judicial":true,"system":true}' CHECK(json_valid(categories_json)),
  channels_json TEXT NOT NULL DEFAULT '{"inbox":true,"push":true}' CHECK(json_valid(channels_json)),
  config_version INTEGER NOT NULL DEFAULT 1 CHECK(config_version > 0),
  revocation_generation INTEGER NOT NULL DEFAULT 1 CHECK(revocation_generation > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(office_id, user_id),
  FOREIGN KEY(office_id, user_id) REFERENCES office_member(office_id, user_id) ON DELETE CASCADE,
  CHECK((quiet_enabled = 0) OR (quiet_start IS NOT NULL AND quiet_end IS NOT NULL))
);

CREATE TABLE push_subscription (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL CHECK(length(device_id) BETWEEN 8 AND 128),
  device_label TEXT CHECK(device_label IS NULL OR length(device_label) <= 120),
  endpoint_hash TEXT NOT NULL UNIQUE,
  encrypted_subscription TEXT NOT NULL,
  vapid_key_id TEXT NOT NULL CHECK(length(vapid_key_id) BETWEEN 1 AND 100),
  auth_generation INTEGER NOT NULL CHECK(auth_generation > 0),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'revoked', 'invalid')),
  subscribed_at TEXT NOT NULL,
  revoked_at TEXT,
  last_reconciled_at TEXT NOT NULL,
  last_error_code TEXT,
  UNIQUE(office_id, user_id, device_id),
  UNIQUE(office_id, id),
  FOREIGN KEY(office_id, user_id) REFERENCES office_member(office_id, user_id) ON DELETE CASCADE
);

CREATE INDEX push_subscription_owner
  ON push_subscription(office_id, user_id, state, last_reconciled_at DESC);

CREATE TABLE notification_delivery (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  group_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN (
    'pending', 'leased', 'accepted', 'retry', 'expired', 'cancelled', 'dead'
  )),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  next_attempt_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  lease_token TEXT,
  lease_until TEXT,
  error_code TEXT,
  accepted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(event_id, user_id, subscription_id),
  UNIQUE(office_id, id),
  FOREIGN KEY(office_id, event_id, user_id)
    REFERENCES notification_recipient(office_id, event_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY(office_id, subscription_id)
    REFERENCES push_subscription(office_id, id) ON DELETE CASCADE
);

CREATE INDEX notification_delivery_work
  ON notification_delivery(state, next_attempt_at, lease_until, id);

CREATE TABLE notification_reminder (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  activity_version INTEGER NOT NULL CHECK(activity_version > 0),
  schedule_key TEXT NOT NULL,
  rule TEXT NOT NULL CHECK(rule IN ('task_due', 'meeting_soon')),
  timezone TEXT NOT NULL,
  due_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'scheduled' CHECK(state IN ('scheduled', 'emitted', 'cancelled', 'expired')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(office_id, activity_id, user_id, rule, schedule_key),
  FOREIGN KEY(office_id, activity_id) REFERENCES agenda_activity(office_id, id) ON DELETE CASCADE,
  FOREIGN KEY(office_id, user_id) REFERENCES office_member(office_id, user_id) ON DELETE CASCADE
);

CREATE INDEX notification_reminder_work
  ON notification_reminder(state, due_at, expires_at, id);

CREATE TABLE notification_follow (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  FOREIGN KEY(office_id, case_id) REFERENCES vault_case(office_id, id) ON DELETE CASCADE,
  FOREIGN KEY(office_id, user_id) REFERENCES office_member(office_id, user_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX notification_follow_active
  ON notification_follow(office_id, case_id, user_id) WHERE ended_at IS NULL;

-- The person who already authorized collection is the only safe initial follower. This is
-- idempotent and does not grant future members access to historical personal notifications.
INSERT OR IGNORE INTO notification_follow(id,office_id,case_id,user_id,started_at)
SELECT lower(hex(randomblob(16))),s.office_id,l.case_id,s.authorized_by,s.created_at
FROM judicial_subscription s
JOIN judicial_case_link l ON l.id=s.link_id AND l.office_id=s.office_id
JOIN office_member m ON m.office_id=s.office_id AND m.user_id=s.authorized_by
WHERE s.status<>'cancelled';

CREATE TABLE notification_rollout (
  office_id TEXT PRIMARY KEY NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  capture_enabled INTEGER NOT NULL DEFAULT 1 CHECK(capture_enabled IN (0, 1)),
  inbox_enabled INTEGER NOT NULL DEFAULT 1 CHECK(inbox_enabled IN (0, 1)),
  push_enabled INTEGER NOT NULL DEFAULT 1 CHECK(push_enabled IN (0, 1)),
  reminders_enabled INTEGER NOT NULL DEFAULT 1 CHECK(reminders_enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Enforce the capture kill switch at the persistence boundary so every producer, including
-- background workers, gets the same behavior without relying on a pre-read.
CREATE TRIGGER notification_event_capture_gate
BEFORE INSERT ON notification_event
WHEN NEW.event_type<>'system.push.test'
  AND COALESCE((SELECT capture_enabled FROM notification_rollout WHERE office_id=NEW.office_id),1)=0
BEGIN
  SELECT RAISE(IGNORE);
END;
