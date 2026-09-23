-- Writing rules the office and each person give the Lume. They enter the system prompt as
-- instructions, below the persona and above the legal policy, which always has the last word.
CREATE TABLE agent_instruction (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  -- NULL is an office rule; a user id is that person's own rule.
  user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 2000),
  applies_to TEXT NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all','chat','documents')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  version BIGINT NOT NULL DEFAULT 1,
  updated_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX agent_instruction_owner ON agent_instruction(office_id, user_id, created_at);
