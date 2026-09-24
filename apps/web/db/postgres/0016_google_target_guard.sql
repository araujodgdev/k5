-- Different operations on the same uncertain remote resource must wait for reconciliation.
DROP INDEX google_operation_unresolved_effect;
CREATE UNIQUE INDEX google_operation_unresolved_effect ON google_operation(office_id,user_id,connection_id,effect_key)
  WHERE status IN ('pending','running','unknown') AND effect_key IS NOT NULL;
