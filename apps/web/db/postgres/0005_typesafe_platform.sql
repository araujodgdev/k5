-- One TypeSafe connection serves the whole platform. The cost is the platform's, not the office's.
-- Existing per-office rows stay as the adoption source: the first read copies the most recent
-- connection that has a key (see src/lib/typesafe/config.ts). That covers databases migrated in
-- place and databases filled later by the legacy importer, which applies the schema before rows.
CREATE TABLE typesafe_platform_connection (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  encrypted_api_key TEXT,
  key_hint TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT 'jev-1.13.0',
  enabled BIGINT NOT NULL DEFAULT 0,
  rag_mode TEXT NOT NULL DEFAULT 'off' CHECK (rag_mode IN ('off','shadow','enabled')),
  documents_mode TEXT NOT NULL DEFAULT 'off' CHECK (documents_mode IN ('off','shadow','enabled')),
  agenda_mode TEXT NOT NULL DEFAULT 'off' CHECK (agenda_mode IN ('off','shadow','enabled')),
  research_mode TEXT NOT NULL DEFAULT 'off' CHECK (research_mode IN ('off','shadow','enabled')),
  feedback_mode TEXT NOT NULL DEFAULT 'enabled' CHECK (feedback_mode IN ('off','shadow','enabled')),
  daily_tokens BIGINT NOT NULL DEFAULT 2000000,
  concurrency BIGINT NOT NULL DEFAULT 4,
  version BIGINT NOT NULL DEFAULT 1,
  failures BIGINT NOT NULL DEFAULT 0,
  circuit_until BIGINT NOT NULL DEFAULT 0,
  adopted_from_office_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The budget is now platform-wide, so reservations are summed by day across offices.
CREATE INDEX typesafe_evaluation_platform_budget ON typesafe_evaluation(day,status,expires_at);

-- Platform-level calls (the connection test) belong to no office; office calls still record theirs.
ALTER TABLE typesafe_evaluation ALTER COLUMN office_id DROP NOT NULL;
