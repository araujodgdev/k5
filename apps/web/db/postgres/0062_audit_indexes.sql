-- The audit screens read each log newest first: the platform's across offices or for one office,
-- and an office's across all of its cases and members.
CREATE INDEX platform_audit_log_recent ON platform_audit_log(created_at DESC, id DESC);
CREATE INDEX platform_audit_log_office ON platform_audit_log(office_id, created_at DESC, id DESC);
CREATE INDEX collaboration_audit_office ON collaboration_audit(office_id, created_at DESC, id DESC);
CREATE INDEX google_operation_office ON google_operation(office_id, created_at DESC, id DESC);
