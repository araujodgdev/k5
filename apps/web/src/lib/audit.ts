import 'server-only';
import { database, type Database } from './database';
import {
  parseAuditCursor, platformAuditGroups,
  type AuditActorKind, type AuditOutcome, type OfficeAuditSource, type PlatformAuditGroup,
} from './audit-format';

/*
 * Reading the audit logs. Each module keeps its own table; these queries put them side by side,
 * newest first, without copying rows. The office view is scoped by the office from the session; the
 * platform view is for platform administrators only (the admin layout checks it).
 */

const PAGE = 50;
// Exact to the microsecond, so a page boundary never skips or repeats rows written together.
const cursorAt = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export type OfficeAuditEntry = {
  id: string; source: OfficeAuditSource; action: string; actorKind: AuditActorKind; actorName: string | null;
  targetName: string | null; subject: string | null; outcome: AuditOutcome; createdAt: string;
};

/**
 * One SELECT per source, each already limited to the page, so every branch reads its own
 * (office_id, created_at) index instead of the whole history.
 */
const officeSources: Record<OfficeAuditSource, string> = {
  judicial: `SELECT 'judicial' AS source, a.id, a.action, a.actor AS actor_kind, a.user_id AS actor_id, NULL AS target_id,
    a.subject_kind AS subject, a.outcome, a.created_at FROM judicial_access_audit a WHERE a.office_id=?`,
  collaboration: `SELECT 'collaboration' AS source, a.id, a.action, 'user' AS actor_kind, a.actor_user_id AS actor_id, a.target_user_id AS target_id,
    c.name AS subject, 'ok' AS outcome, a.created_at FROM collaboration_audit a LEFT JOIN vault_case c ON c.office_id=a.office_id AND c.id=a.case_id WHERE a.office_id=?`,
  google: `SELECT 'google' AS source, a.id, 'google.' || a.action AS action,
    CASE a.invocation WHEN 'worker' THEN 'worker' WHEN 'ui' THEN 'user' ELSE 'agent' END AS actor_kind, a.user_id AS actor_id, NULL AS target_id,
    NULL AS subject, CASE a.status WHEN 'succeeded' THEN 'ok' WHEN 'failed' THEN 'error' WHEN 'unknown' THEN 'unknown' ELSE 'pending' END AS outcome,
    a.created_at FROM google_operation a WHERE a.office_id=?`,
  ads: `SELECT 'ads' AS source, a.id, 'ads.' || a.action AS action, 'user' AS actor_kind, a.actor_user_id AS actor_id, NULL AS target_id,
    a.account_id AS subject, 'ok' AS outcome, a.created_at
    FROM ads_connection_audit a WHERE a.office_id=?`,
  // The query itself is stored only as a hash; the screen shows how many sources it used.
  knowledge: `SELECT 'knowledge' AS source, a.id, 'knowledge.search' AS action, 'user' AS actor_kind, a.user_id AS actor_id, NULL AS target_id,
    a.source_count::text AS subject, 'ok' AS outcome, a.created_at
    FROM knowledge_retrieval_audit a WHERE a.office_id=?`,
};

export async function listOfficeAudit(officeId: string, options: { source?: string; before?: string | null; limit?: number } = {}, db: Database = database) {
  const limit = Math.max(1, Math.min(options.limit ?? PAGE, 200));
  const cursor = parseAuditCursor(options.before);
  const sources = (Object.keys(officeSources) as OfficeAuditSource[]).filter(source => !options.source || source === options.source);
  if (!sources.length) return { entries: [] as OfficeAuditEntry[], next: null };
  const params: unknown[] = [];
  const branches = sources.map(source => {
    params.push(officeId);
    const after = cursor ? ' AND (a.created_at, a.id) < (?::timestamptz, ?)' : '';
    if (cursor) params.push(cursor.at, cursor.id);
    params.push(limit + 1);
    return `(${officeSources[source]}${after} ORDER BY a.created_at DESC, a.id DESC LIMIT ?)`;
  });
  params.push(limit + 1);
  const rows = await db.prepare(`SELECT e.id, e.source, e.action, e.actor_kind AS "actorKind", actor.name AS "actorName",
      target.name AS "targetName", e.subject, e.outcome, e.created_at AS "createdAt", ${cursorAt('e.created_at')} AS cursor
    FROM (${branches.join(' UNION ALL ')}) e
    LEFT JOIN "user" actor ON actor.id=e.actor_id LEFT JOIN "user" target ON target.id=e.target_id
    ORDER BY e.created_at DESC, e.id DESC LIMIT ?`).all<OfficeAuditEntry & { cursor: string }>(...params);
  return page(rows, limit);
}

export type PlatformAuditEntry = {
  id: string; action: string; actorName: string | null; actorEmail: string | null;
  officeId: string | null; officeName: string | null; details: string; createdAt: string;
};

export async function listPlatformAudit(db: Database, options: { group?: string; officeId?: string | null; before?: string | null; limit?: number } = {}) {
  const limit = Math.max(1, Math.min(options.limit ?? PAGE, 200));
  const cursor = parseAuditCursor(options.before);
  const prefixes = options.group && options.group in platformAuditGroups ? platformAuditGroups[options.group as PlatformAuditGroup] : [];
  const where: string[] = [];
  const params: unknown[] = [];
  if (prefixes.length) {
    where.push(`(${prefixes.map(() => 'l.action LIKE ?').join(' OR ')})`);
    params.push(...prefixes.map(prefix => `${prefix.replaceAll('_', '\\_')}%`));
  }
  if (options.officeId) { where.push('l.office_id=?'); params.push(options.officeId); }
  if (cursor) { where.push('(l.created_at, l.id) < (?::timestamptz, ?)'); params.push(cursor.at, cursor.id); }
  params.push(limit + 1);
  const rows = await db.prepare(`SELECT l.id, l.action, u.name AS "actorName", u.email AS "actorEmail", l.office_id AS "officeId",
      o.name AS "officeName", l.details_json AS details, l.created_at AS "createdAt", ${cursorAt('l.created_at')} AS cursor
    FROM platform_audit_log l LEFT JOIN "user" u ON u.id=l.actor_user_id LEFT JOIN office o ON o.id=l.office_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY l.created_at DESC, l.id DESC LIMIT ?`).all<PlatformAuditEntry & { cursor: string }>(...params);
  return page(rows, limit);
}

export async function platformAuditOffice(db: Database, officeId: string) {
  return (await db.prepare('SELECT name FROM office WHERE id=?').get<{ name: string }>(officeId))?.name ?? null;
}

function page<T extends { id: string; cursor: string }>(rows: T[], limit: number) {
  const last = rows.length > limit ? rows[limit - 1] : null;
  const entries = rows.slice(0, limit).map(row => { const entry: Omit<T, 'cursor'> & { cursor?: string } = { ...row }; delete entry.cursor; return entry as Omit<T, 'cursor'>; });
  return { entries, next: last ? `${last.cursor}_${last.id}` : null };
}
