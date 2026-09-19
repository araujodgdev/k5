import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';

/**
 * Who reached which evidence, and why. Section 8: identifiers and purpose only. No payload, no
 * credential and no publication text ever lands in this table — an audit trail that copies the
 * sensitive content it is auditing just doubles the exposure.
 */

export type AuditEntry = {
  officeId: string;
  userId?: string | null;
  actor: 'user' | 'agent' | 'worker';
  action: string;
  subjectKind: string;
  subjectId?: string | null;
  installationId?: string | null;
  purpose?: string | null;
  outcome?: 'ok' | 'denied' | 'error';
};

export function recordAudit(entry: AuditEntry): void {
  database.prepare(`
    INSERT INTO judicial_access_audit (
      id, office_id, user_id, actor, action, subject_kind, subject_id, installation_id, purpose, outcome
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), entry.officeId, entry.userId ?? null, entry.actor, entry.action,
    entry.subjectKind, entry.subjectId ?? null, entry.installationId ?? null,
    // Free text supplied by a caller is capped so a long prompt cannot be smuggled into the log.
    entry.purpose ? entry.purpose.slice(0, 200) : null,
    entry.outcome ?? 'ok',
  );
}

export function listAudit(officeId: string, limit = 50) {
  return database.prepare(
    'SELECT id, user_id, actor, action, subject_kind, subject_id, installation_id, purpose, outcome, created_at FROM judicial_access_audit WHERE office_id = ? ORDER BY created_at DESC LIMIT ?',
  ).all(officeId, Math.max(1, Math.min(limit, 200))) as Array<{
    id: string; user_id: string | null; actor: string; action: string; subject_kind: string;
    subject_id: string | null; installation_id: string | null; purpose: string | null;
    outcome: string; created_at: string;
  }>;
}
