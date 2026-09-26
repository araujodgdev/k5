-- Execution traces of the Lume's chat turns, for debugging: one row per turn and one per event
-- (model step, tool call and result, web search source, citation review, error). Tool inputs and
-- outputs live here, scoped by office and deleted with the conversation; Sentry only receives the
-- trace id, names, durations and counts. The worker sweeps traces older than 30 days.
CREATE TABLE "agent_trace" (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  task TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  sentry_trace_id TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','halted','failed','cancelled')),
  steps INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER,
  output_tokens INTEGER,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ
);
CREATE INDEX agent_trace_recent ON agent_trace(started_at DESC);
CREATE INDEX agent_trace_conversation ON agent_trace(conversation_id, started_at DESC);
ALTER TABLE "agent_trace" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "agent_trace" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "agent_trace" ADD FOREIGN KEY ("conversation_id") REFERENCES "ai_conversation" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

CREATE TABLE "agent_trace_event" (
  trace_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  name TEXT,
  -- Milliseconds since the turn started, and how long the event took when it has a duration.
  at_ms INTEGER NOT NULL,
  duration_ms INTEGER,
  data TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (trace_id, seq)
);
ALTER TABLE "agent_trace_event" ADD FOREIGN KEY ("trace_id") REFERENCES "agent_trace" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
