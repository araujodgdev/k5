import 'server-only';
import { randomUUID } from 'node:crypto';
import { database as defaultDatabase, type BoundStatement, type Database } from '@/lib/database';
import type { WorkspaceContext } from '@/lib/application/context';
import { NotificationRequestError, type NotificationCategory, type NotificationEventType, type NotificationPreferenceInput, type NotificationView, type PushSubscriptionInput } from './contracts';
import { categoryForEvent, eventCopy, isTimeZone } from './policy';
import { endpointHash, encryptPushSubscription, publicPushConfiguration, validatePushSubscription } from './subscriptions';

type NotificationRow = {
  id: string;
  event_type: NotificationEventType;
  data_json: string;
  created_at: string;
  read_at: string | null;
};

type PreferenceRow = {
  timezone: string;
  quiet_enabled: number;
  quiet_start: string | null;
  quiet_end: string | null;
  push_enabled: number;
  categories_json: string;
  revocation_generation: number;
};

function noStore<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export { noStore };

export async function ensureNotificationDefaults(context: WorkspaceContext, db: Database = defaultDatabase) {
  await db.batch([
    db.prepare('INSERT INTO notification_rollout(office_id) VALUES(?) ON CONFLICT(office_id) DO NOTHING').bind(context.officeId),
    db.prepare('INSERT INTO notification_preference(office_id,user_id) VALUES(?,?) ON CONFLICT(office_id,user_id) DO NOTHING').bind(context.officeId, context.userId),
  ]);
}

function encodeCursor(createdAt: string, id: string) {
  return Buffer.from(JSON.stringify([createdAt, id])).toString('base64url');
}

function decodeCursor(value: string | undefined): [string, string] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some((part) => typeof part !== 'string')) return null;
    return parsed as [string, string];
  } catch { return null; }
}

function parseData(value: string): Record<string, unknown> {
  try {
    const data = JSON.parse(value);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}

function toView(row: NotificationRow, userId: string): NotificationView {
  const data = parseData(row.data_json);
  const copy = eventCopy(row.event_type, data, userId);
  return {
    id: row.id,
    eventType: row.event_type,
    category: categoryForEvent(row.event_type),
    ...copy,
    createdAt: row.created_at,
    readAt: row.read_at,
    href: `/api/notifications/${encodeURIComponent(row.id)}/open`,
  };
}

export async function listNotifications(context: WorkspaceContext, input: {
  unreadOnly: boolean; cursor?: string; limit: number;
}, db: Database = defaultDatabase) {
  await ensureNotificationDefaults(context, db);
  const rollout = await db.prepare('SELECT inbox_enabled FROM notification_rollout WHERE office_id=?')
    .get<{ inbox_enabled: number }>(context.officeId);
  if (!rollout?.inbox_enabled) return { notifications: [], nextCursor: null };
  const clauses = ['r.office_id=?', 'r.user_id=?', 'r.archived_at IS NULL'];
  const params: unknown[] = [context.officeId, context.userId];
  if (input.unreadOnly) clauses.push('r.read_at IS NULL');
  const cursor = decodeCursor(input.cursor);
  if (input.cursor && !cursor) throw new NotificationRequestError(400, 'Cursor de notificações inválido.');
  if (cursor) {
    clauses.push('(r.created_at < ? OR (r.created_at = ? AND r.event_id < ?))');
    params.push(cursor[0], cursor[0], cursor[1]);
  }
  const rows = await db.prepare(`SELECT r.event_id AS id,e.event_type,e.data_json,r.created_at,r.read_at
    FROM notification_recipient r JOIN notification_event e ON e.id=r.event_id AND e.office_id=r.office_id
    WHERE ${clauses.join(' AND ')} ORDER BY r.created_at DESC,r.event_id DESC LIMIT ?`)
    .all<NotificationRow>(...params, input.limit + 1);
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page.at(-1);
  return {
    notifications: page.map((row) => toView(row, context.userId)),
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

export async function unreadCount(context: WorkspaceContext, db: Database = defaultDatabase) {
  const defaults = await db.prepare(`SELECT 1 FROM notification_rollout ro
    JOIN notification_preference p ON p.office_id=ro.office_id
    WHERE ro.office_id=? AND p.user_id=?`).get(context.officeId, context.userId);
  if (!defaults) await ensureNotificationDefaults(context, db);
  const row = await db.prepare(`SELECT count(*) AS total FROM notification_recipient r
    JOIN notification_rollout ro ON ro.office_id=r.office_id AND ro.inbox_enabled=1
    WHERE r.office_id=? AND r.user_id=? AND r.read_at IS NULL AND r.archived_at IS NULL`)
    .get<{ total: number }>(context.officeId, context.userId);
  return Number(row?.total ?? 0);
}

export async function markNotificationRead(context: WorkspaceContext, eventId: string, db: Database = defaultDatabase) {
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(`UPDATE notification_recipient SET read_at=COALESCE(read_at,?)
      WHERE event_id=? AND office_id=? AND user_id=?`).bind(now, eventId, context.officeId, context.userId),
    db.prepare(`UPDATE notification_delivery SET state='cancelled',updated_at=?
      WHERE event_id=? AND office_id=? AND user_id=? AND state IN ('pending','retry')`).bind(now, eventId, context.officeId, context.userId),
  ]);
  return results[0].changes > 0;
}

export async function markAllNotificationsRead(context: WorkspaceContext, cutoff: { createdAt: string; id: string }, db: Database = defaultDatabase) {
  const now = new Date().toISOString();
  const where = `office_id=? AND user_id=? AND read_at IS NULL AND archived_at IS NULL
    AND (created_at < ? OR (created_at = ? AND event_id <= ?))`;
  const statements: BoundStatement[] = [
    db.prepare(`UPDATE notification_delivery SET state='cancelled',updated_at=?
      WHERE office_id=? AND user_id=? AND state IN ('pending','retry')
        AND event_id IN (SELECT event_id FROM notification_recipient WHERE ${where})`)
      .bind(now, context.officeId, context.userId, context.officeId, context.userId, cutoff.createdAt, cutoff.createdAt, cutoff.id),
    db.prepare(`UPDATE notification_recipient SET read_at=? WHERE ${where}`)
      .bind(now, context.officeId, context.userId, cutoff.createdAt, cutoff.createdAt, cutoff.id),
  ];
  return (await db.batch(statements))[1].changes;
}

export async function archiveNotification(context: WorkspaceContext, eventId: string, db: Database = defaultDatabase) {
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(`UPDATE notification_recipient SET archived_at=COALESCE(archived_at,?),read_at=COALESCE(read_at,?)
      WHERE event_id=? AND office_id=? AND user_id=?`).bind(now, now, eventId, context.officeId, context.userId),
    db.prepare(`UPDATE notification_delivery SET state='cancelled',updated_at=?
      WHERE event_id=? AND office_id=? AND user_id=? AND state IN ('pending','retry')`).bind(now, eventId, context.officeId, context.userId),
  ]);
  return results[0].changes > 0;
}

function preferenceView(row: PreferenceRow) {
  return {
    timezone: row.timezone,
    quietEnabled: Boolean(row.quiet_enabled),
    quietStart: row.quiet_start,
    quietEnd: row.quiet_end,
    pushEnabled: Boolean(row.push_enabled),
    categories: JSON.parse(row.categories_json) as Record<NotificationCategory, boolean>,
    authorizationGeneration: row.revocation_generation,
  };
}

export async function getNotificationPreferences(context: WorkspaceContext, db: Database = defaultDatabase) {
  await ensureNotificationDefaults(context, db);
  const row = await db.prepare(`SELECT timezone,quiet_enabled,quiet_start,quiet_end,push_enabled,
    categories_json,revocation_generation FROM notification_preference WHERE office_id=? AND user_id=?`)
    .get<PreferenceRow>(context.officeId, context.userId);
  return preferenceView(row!);
}

export async function updateNotificationPreferences(context: WorkspaceContext, input: NotificationPreferenceInput, db: Database = defaultDatabase) {
  const current = await getNotificationPreferences(context, db);
  const timezone = input.timezone ?? current.timezone;
  if (!isTimeZone(timezone)) throw new NotificationRequestError(400, 'Fuso horário inválido.');
  const quietEnabled = input.quietEnabled ?? current.quietEnabled;
  const quietStart = input.quietStart === undefined ? current.quietStart : input.quietStart;
  const quietEnd = input.quietEnd === undefined ? current.quietEnd : input.quietEnd;
  if (quietEnabled && (!quietStart || !quietEnd)) throw new NotificationRequestError(400, 'Informe o início e o fim do horário de silêncio.');
  const categories = { ...current.categories, ...input.categories };
  await db.prepare(`UPDATE notification_preference SET timezone=?,quiet_enabled=?,quiet_start=?,quiet_end=?,
    push_enabled=?,categories_json=?,channels_json=?,config_version=config_version+1,updated_at=?
    WHERE office_id=? AND user_id=?`).run(
      timezone, quietEnabled ? 1 : 0, quietStart, quietEnd,
      (input.pushEnabled ?? current.pushEnabled) ? 1 : 0, JSON.stringify(categories),
      JSON.stringify({ inbox: true, push: input.pushEnabled ?? current.pushEnabled }), new Date().toISOString(),
      context.officeId, context.userId,
    );
  return getNotificationPreferences(context, db);
}

export async function listPushSubscriptions(context: WorkspaceContext, db: Database = defaultDatabase) {
  return db.prepare(`SELECT id,device_id AS deviceId,device_label AS deviceLabel,state,subscribed_at AS subscribedAt,
    revoked_at AS revokedAt,last_reconciled_at AS lastReconciledAt,vapid_key_id AS vapidKeyId
    FROM push_subscription WHERE office_id=? AND user_id=? ORDER BY last_reconciled_at DESC`)
    .all(context.officeId, context.userId);
}

export async function registerPushSubscription(context: WorkspaceContext, raw: PushSubscriptionInput, db: Database = defaultDatabase) {
  await ensureNotificationDefaults(context, db);
  const input = validatePushSubscription(raw);
  const config = publicPushConfiguration();
  if (!config.available || input.vapidKeyId !== config.keyId) throw new NotificationRequestError(409, 'A configuração de push mudou. Atualize a página e tente novamente.');
  const hash = endpointHash(input.endpoint);
  const owner = await db.prepare('SELECT office_id,user_id FROM push_subscription WHERE endpoint_hash=?')
    .get<{ office_id: string; user_id: string }>(hash);
  if (owner && (owner.office_id !== context.officeId || owner.user_id !== context.userId)) {
    throw new NotificationRequestError(409, 'Este dispositivo está associado a outra conta. Saia dela antes de ativar as notificações.');
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  const existingDevice = await db.prepare(`SELECT id,endpoint_hash FROM push_subscription
    WHERE office_id=? AND user_id=? AND device_id=?`).get<{ id: string; endpoint_hash: string }>(context.officeId, context.userId, input.deviceId);
  if (!existingDevice) {
    const active = await db.prepare(`SELECT count(*) AS total FROM push_subscription
      WHERE office_id=? AND user_id=? AND state='active'`).get<{ total: number }>(context.officeId, context.userId);
    if (Number(active?.total ?? 0) >= 10) throw new NotificationRequestError(429, 'Revogue um dispositivo antigo antes de ativar outro.');
  }
  if (existingDevice && existingDevice.endpoint_hash !== hash) {
    const result = await db.prepare(`UPDATE push_subscription SET device_label=?,endpoint_hash=?,encrypted_subscription=?,
      vapid_key_id=?,auth_generation=?,state='active',revoked_at=NULL,last_error_code=NULL,last_reconciled_at=?
      WHERE id=? AND office_id=? AND user_id=? AND EXISTS(SELECT 1 FROM notification_preference
        WHERE office_id=? AND user_id=? AND revocation_generation=?)`).run(
      input.deviceLabel ?? null, hash, encryptPushSubscription(input), input.vapidKeyId,
      input.authorizationGeneration, now, existingDevice.id, context.officeId, context.userId,
      context.officeId, context.userId, input.authorizationGeneration,
    );
    if (!result.changes) throw new NotificationRequestError(409, 'A autorização deste dispositivo expirou. Atualize a página e tente novamente.');
    return { subscriptions: await listPushSubscriptions(context, db) };
  }
  const result = await db.prepare(`INSERT INTO push_subscription(
    id,office_id,user_id,device_id,device_label,endpoint_hash,encrypted_subscription,vapid_key_id,
    auth_generation,state,subscribed_at,last_reconciled_at
  ) SELECT ?,?,?,?,?,?,?,?,?, 'active',?,? FROM notification_preference
    WHERE office_id=? AND user_id=? AND revocation_generation=?
    ON CONFLICT(endpoint_hash) DO UPDATE SET
      device_id=excluded.device_id,device_label=excluded.device_label,
      encrypted_subscription=excluded.encrypted_subscription,vapid_key_id=excluded.vapid_key_id,
      auth_generation=excluded.auth_generation,state='active',revoked_at=NULL,last_error_code=NULL,
      last_reconciled_at=excluded.last_reconciled_at
    WHERE push_subscription.office_id=excluded.office_id AND push_subscription.user_id=excluded.user_id`)
    .run(id, context.officeId, context.userId, input.deviceId, input.deviceLabel ?? null, hash,
      encryptPushSubscription(input), input.vapidKeyId, input.authorizationGeneration, now, now,
      context.officeId, context.userId, input.authorizationGeneration);
  if (!result.changes) throw new NotificationRequestError(409, 'A autorização deste dispositivo expirou. Atualize a página e tente novamente.');
  return { subscriptions: await listPushSubscriptions(context, db) };
}

export async function revokePushSubscription(context: WorkspaceContext, id: string, db: Database = defaultDatabase) {
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(`UPDATE push_subscription SET state='revoked',revoked_at=?,last_reconciled_at=?
      WHERE id=? AND office_id=? AND user_id=? AND state='active'`).bind(now, now, id, context.officeId, context.userId),
    db.prepare(`UPDATE notification_delivery SET state='cancelled',updated_at=?
      WHERE subscription_id=? AND office_id=? AND user_id=? AND state IN ('pending','retry','leased')`).bind(now, id, context.officeId, context.userId),
  ]);
  return results[0].changes > 0;
}

export async function getCaseFollowState(context: WorkspaceContext, caseId: string, db: Database = defaultDatabase) {
  const row = await db.prepare(`SELECT EXISTS(
      SELECT 1 FROM notification_follow f
      JOIN vault_case c ON c.office_id=f.office_id AND c.id=f.case_id AND c.deleted_at IS NULL
      WHERE f.office_id=? AND f.case_id=? AND f.user_id=? AND f.ended_at IS NULL
    ) AS following`).get<{ following: number }>(context.officeId, caseId, context.userId);
  return Boolean(row?.following);
}

export async function setCaseFollowState(context: WorkspaceContext, caseId: string, following: boolean, db: Database = defaultDatabase) {
  const now = new Date().toISOString();
  if (following) {
    await db.prepare(`INSERT OR IGNORE INTO notification_follow(id,office_id,case_id,user_id,started_at)
      SELECT ?,?,?,?,? FROM vault_case c
      WHERE c.office_id=? AND c.id=? AND c.deleted_at IS NULL
        AND EXISTS(SELECT 1 FROM office_member m WHERE m.office_id=c.office_id AND m.user_id=?)`)
      .run(randomUUID(), context.officeId, caseId, context.userId, now,
        context.officeId, caseId, context.userId);
  } else {
    await db.prepare(`UPDATE notification_follow SET ended_at=?
      WHERE office_id=? AND case_id=? AND user_id=? AND ended_at IS NULL`)
      .run(now, context.officeId, caseId, context.userId);
  }
  return { following: await getCaseFollowState(context, caseId, db) };
}

export function pushConfigurationView() {
  const value = publicPushConfiguration();
  return { available: value.available, publicKey: value.available ? value.publicKey : null, keyId: value.available ? value.keyId : null };
}

export async function resolveNotificationDestination(context: WorkspaceContext, eventId: string, db: Database = defaultDatabase) {
  const row = await db.prepare(`SELECT e.source_kind,e.source_id FROM notification_recipient r
    JOIN notification_event e ON e.id=r.event_id AND e.office_id=r.office_id
    WHERE r.event_id=? AND r.office_id=? AND r.user_id=? AND r.archived_at IS NULL`)
    .get<{ source_kind: string; source_id: string | null }>(eventId, context.officeId, context.userId);
  if (!row) return null;
  await markNotificationRead(context, eventId, db);
  if (row.source_kind === 'activity' && row.source_id && await db.prepare('SELECT 1 FROM agenda_activity WHERE id=? AND office_id=?').get(row.source_id, context.officeId)) {
    return `/app/agenda?activityId=${encodeURIComponent(row.source_id)}`;
  }
  if (row.source_kind === 'case' && row.source_id && await db.prepare('SELECT 1 FROM vault_case WHERE id=? AND office_id=? AND deleted_at IS NULL').get(row.source_id, context.officeId)) {
    return `/app/vault/cases/${encodeURIComponent(row.source_id)}`;
  }
  if (row.source_kind === 'document' && row.source_id && await db.prepare('SELECT 1 FROM vault_document WHERE id=? AND office_id=? AND deleted_at IS NULL').get(row.source_id, context.officeId)) {
    return `/app/vault?documentId=${encodeURIComponent(row.source_id)}`;
  }
  if (row.source_kind === 'artifact' && row.source_id && await db.prepare('SELECT 1 FROM ai_artifact WHERE id=? AND office_id=? AND user_id=?').get(row.source_id, context.officeId, context.userId)) {
    return `/app/documents/${encodeURIComponent(row.source_id)}`;
  }
  if (row.source_kind === 'judicial_alert' && row.source_id) {
    const judicial = await db.prepare(`SELECT l.case_id FROM judicial_alert a
      LEFT JOIN judicial_case_link l ON l.id=a.link_id AND l.office_id=a.office_id
      WHERE a.id=? AND a.office_id=?`).get<{ case_id: string | null }>(row.source_id, context.officeId);
    if (judicial?.case_id) return `/app/vault/cases/${encodeURIComponent(judicial.case_id)}`;
  }
  return '/app/notifications';
}
