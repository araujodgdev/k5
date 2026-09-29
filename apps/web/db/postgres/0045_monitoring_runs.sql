CREATE TABLE monitoring_run (
  name TEXT PRIMARY KEY CHECK (name IN ('queues','journeys')),
  lease_token TEXT,
  lease_until TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running','ok','error')),
  result_json JSONB
);
