-- Fence reconnects, retries and partial remote effects independently of access-token refreshes.
ALTER TABLE google_connection ADD COLUMN authorization_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE google_oauth_state ADD COLUMN connection_id TEXT;
ALTER TABLE google_oauth_state ADD COLUMN connection_generation INTEGER;
ALTER TABLE google_operation ADD COLUMN bound_hash TEXT;
ALTER TABLE google_operation ADD COLUMN effect_key TEXT;
ALTER TABLE google_operation ADD COLUMN actions_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE google_operation ADD COLUMN checkpoint_json TEXT;
ALTER TABLE google_operation ADD COLUMN has_effect SMALLINT NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX google_operation_unresolved_effect ON google_operation(office_id,user_id,connection_id,capability_name,effect_key)
  WHERE status IN ('pending','running','unknown') AND effect_key IS NOT NULL;
