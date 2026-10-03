-- Honcho memory (docs/research/honcho-lume-2026-10-03.md). The person's remote memory lives in a
-- Honcho workspace named from their office, user and generation; forgetting starts a new
-- generation, so nothing written before it can be read again.
CREATE TABLE honcho_memory (
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation >= 1),
  -- The working memory as last queued, to send only what changed.
  synced_memory TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (office_id, user_id)
);

-- Personal statements waiting to reach Honcho. The id travels as metadata, so a send whose answer
-- was lost is found remotely before it is tried again.
CREATE TABLE honcho_outbox (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  conversation_id TEXT NOT NULL,
  content TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'delivered', 'uncertain', 'discarded')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TIMESTAMPTZ,
  FOREIGN KEY (office_id, user_id) REFERENCES honcho_memory(office_id, user_id) ON DELETE CASCADE
);
CREATE INDEX honcho_outbox_due ON honcho_outbox(created_at) WHERE state IN ('pending', 'sending', 'uncertain');

-- Remote deletions still owed: a forgotten generation's workspace or a deleted conversation's
-- session. Accepted means Honcho took the request, not that its background deletion finished.
CREATE TABLE honcho_deletion (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  session_id TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'accepted')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at TIMESTAMPTZ
);
CREATE INDEX honcho_deletion_pending ON honcho_deletion(created_at) WHERE state = 'pending';
