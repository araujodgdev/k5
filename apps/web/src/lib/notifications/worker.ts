import { createHash, randomUUID } from 'node:crypto';
import { database as defaultDatabase, type BoundStatement, type Database } from '@/lib/database';
import type { NotificationEventType } from './contracts';
import { eventInsertStatement } from './events';
import { categoryForEvent, DEFAULT_TIMEZONE, quietUntil, reminderInstant } from './policy';
import { decryptPushSubscription } from './subscriptions';
import { PushTransportError, type PushSender } from './push-contract';

const categoryPreferenceSql = (category: string) => `COALESCE((p.categories_json::jsonb->>'${category}')::boolean,true)`;
let lastRetentionWindow: string | null = null;

type ClaimedEvent = {
  id: string; office_id: string; event_type: NotificationEventType; source_kind: string;
  source_id: string | null; intended_recipients_json: string; created_at: string;
  expires_at: string | null; historical: number; push_eligible: number; lease_token: string;
};

async function sourceAllowed(db: Database, event: ClaimedEvent, userId: string) {
  if (!await db.prepare('SELECT 1 FROM office_member WHERE office_id=? AND user_id=?').get(event.office_id, userId)) return false;
  if (!event.source_id || event.source_kind === 'system') return true;
  const lookups: Record<string, { sql: string; params: unknown[] }> = {
    activity: { sql: 'SELECT 1 FROM agenda_activity WHERE id=? AND office_id=?', params: [event.source_id, event.office_id] },
    case: { sql: 'SELECT 1 FROM vault_case WHERE id=? AND office_id=? AND deleted_at IS NULL', params: [event.source_id, event.office_id] },
    document: { sql: 'SELECT 1 FROM vault_document WHERE id=? AND office_id=? AND deleted_at IS NULL', params: [event.source_id, event.office_id] },
    run: { sql: 'SELECT 1 FROM ai_run WHERE id=? AND office_id=? AND user_id=?', params: [event.source_id, event.office_id, userId] },
    artifact: { sql: 'SELECT 1 FROM ai_artifact WHERE id=? AND office_id=? AND user_id=?', params: [event.source_id, event.office_id, userId] },
    judicial_alert: { sql: 'SELECT 1 FROM judicial_alert WHERE id=? AND office_id=?', params: [event.source_id, event.office_id] },
  };
  const lookup = lookups[event.source_kind];
  return Boolean(lookup && await db.prepare(lookup.sql).get(...lookup.params));
}

function intendedRecipients(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string => typeof id === 'string'))] : [];
  } catch { return []; }
}

export async function projectNextNotification(db: Database = defaultDatabase, now = new Date().toISOString()) {
  const token = randomUUID();
  const leaseUntil = new Date(Date.parse(now) + 60_000).toISOString();
  const event = await db.prepare(`UPDATE notification_event
    SET projection_state='leased',lease_token=?,lease_until=?,projection_attempts=projection_attempts+1
    WHERE id=(SELECT id FROM notification_event
      WHERE (projection_state='pending' OR (projection_state='leased' AND lease_until<?))
        AND COALESCE((SELECT capture_enabled FROM notification_rollout ro WHERE ro.office_id=notification_event.office_id),1)=1
      ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id,office_id,event_type,source_kind,source_id,intended_recipients_json,created_at,
      expires_at,historical,push_eligible,lease_token`).get<ClaimedEvent>(token, leaseUntil, now);
  if (!event) return false;
  try {
    const recipients: string[] = [];
    for (const userId of intendedRecipients(event.intended_recipients_json)) {
      if (await sourceAllowed(db, event, userId)) recipients.push(userId);
    }
    const category = categoryForEvent(event.event_type);
    const expiresAt = event.expires_at ?? new Date(Date.parse(event.created_at) + 24 * 60 * 60 * 1000).toISOString();
    const groupKey = `${category}:${event.created_at.slice(0, 16)}`;
    const writes: BoundStatement[] = [];
    for (const userId of recipients) {
      writes.push(db.prepare(`INSERT INTO notification_recipient(event_id,office_id,user_id,created_at)
        VALUES(?,?,?,?) ON CONFLICT(event_id,user_id) DO NOTHING`)
        .bind(event.id, event.office_id, userId, event.created_at));
      if (!event.historical && event.push_eligible) {
        writes.push(db.prepare(`INSERT INTO notification_delivery(
          id,event_id,office_id,user_id,subscription_id,group_key,state,next_attempt_at,expires_at,created_at,updated_at
        ) SELECT ?,?,?,?,s.id,?,'pending',?,?,?,? FROM push_subscription s
          JOIN notification_preference p ON p.office_id=s.office_id AND p.user_id=s.user_id
          JOIN notification_rollout ro ON ro.office_id=s.office_id
          WHERE s.office_id=? AND s.user_id=? AND s.state='active'
            AND s.auth_generation=p.revocation_generation AND p.push_enabled=1 AND ro.push_enabled=1
            AND ${categoryPreferenceSql(category)}
          ON CONFLICT(event_id,user_id,subscription_id) DO NOTHING`)
          .bind(randomUUID(), event.id, event.office_id, userId, groupKey, now, expiresAt, now, now, event.office_id, userId));
      }
    }
    writes.push(db.prepare(`UPDATE notification_event SET projection_state='projected',projected_at=?,lease_token=NULL,lease_until=NULL,last_error=NULL
      WHERE id=? AND office_id=? AND lease_token=?`).bind(now, event.id, event.office_id, token));
    await db.batch(writes);
    return true;
  } catch (error) {
    const code = error instanceof Error ? error.name.slice(0, 80) : 'projection_error';
    await db.prepare(`UPDATE notification_event SET projection_state=CASE WHEN projection_attempts>=8 THEN 'dead' ELSE 'pending' END,
      lease_token=NULL,lease_until=NULL,last_error=? WHERE id=? AND office_id=? AND lease_token=?`)
      .run(code, event.id, event.office_id, token);
    throw error;
  }
}

type ActivityReminderRow = {
  id: string; office_id: string; kind: 'task' | 'meeting'; title: string; status: string;
  due_on: string | null; starts_at: string | null; assignee_id: string | null; created_by: string; version: number;
};

export async function reconcileNotificationReminders(db: Database = defaultDatabase, now = new Date().toISOString(), limit = 100) {
  await db.prepare(`UPDATE notification_reminder SET state='cancelled',updated_at=? WHERE state='scheduled'
    AND EXISTS(SELECT 1 FROM agenda_activity a WHERE a.id=notification_reminder.activity_id
      AND a.office_id=notification_reminder.office_id AND a.status<>'pending')`).run(now);
  const activities = await db.prepare(`SELECT a.id,a.office_id,a.kind,a.title,a.status,a.due_on,a.starts_at,
    a.assignee_id,a.created_by,a.version FROM agenda_activity a
    JOIN notification_rollout ro ON ro.office_id=a.office_id AND ro.reminders_enabled=1
    WHERE a.status='pending' AND ((a.kind='task' AND a.due_on IS NOT NULL) OR (a.kind='meeting' AND a.starts_at IS NOT NULL))
      AND (
        EXISTS(SELECT 1 FROM office_member m
          LEFT JOIN notification_preference p ON p.office_id=m.office_id AND p.user_id=m.user_id
          WHERE m.office_id=a.office_id
            AND (m.user_id=COALESCE(a.assignee_id,a.created_by) OR (a.kind='meeting' AND m.user_id=a.created_by))
            AND NOT EXISTS(SELECT 1 FROM notification_reminder r
              WHERE r.office_id=a.office_id AND r.activity_id=a.id AND r.user_id=m.user_id
                AND r.rule=CASE a.kind WHEN 'task' THEN 'task_due' ELSE 'meeting_soon' END
                AND r.schedule_key=CAST(a.version AS TEXT)||':'||COALESCE(p.timezone,?)))
        OR EXISTS(SELECT 1 FROM notification_reminder r
          WHERE r.office_id=a.office_id AND r.activity_id=a.id AND r.state='scheduled'
            AND NOT EXISTS(SELECT 1 FROM office_member m
              LEFT JOIN notification_preference p ON p.office_id=m.office_id AND p.user_id=m.user_id
              WHERE m.office_id=a.office_id AND m.user_id=r.user_id
                AND (m.user_id=COALESCE(a.assignee_id,a.created_by) OR (a.kind='meeting' AND m.user_id=a.created_by))
                AND r.rule=CASE a.kind WHEN 'task' THEN 'task_due' ELSE 'meeting_soon' END
                AND r.schedule_key=CAST(a.version AS TEXT)||':'||COALESCE(p.timezone,?)))
      )
    ORDER BY COALESCE(a.due_on::date::timestamptz,a.starts_at),a.id LIMIT ?`).all<ActivityReminderRow>(DEFAULT_TIMEZONE, DEFAULT_TIMEZONE, limit);
  let changed = 0;
  for (const activity of activities) {
    const userIds = [...new Set([activity.assignee_id ?? activity.created_by, ...(activity.kind === 'meeting' ? [activity.created_by] : [])])];
    const preferences = await db.prepare(`SELECT m.user_id,COALESCE(p.timezone,?) AS timezone
      FROM office_member m LEFT JOIN notification_preference p ON p.office_id=m.office_id AND p.user_id=m.user_id
      WHERE m.office_id=? AND m.user_id IN (${userIds.map(() => '?').join(',')})`)
      .all<{ user_id: string; timezone: string }>(DEFAULT_TIMEZONE, activity.office_id, ...userIds);
    const existing = await db.prepare(`SELECT id,user_id,rule,schedule_key,state FROM notification_reminder
      WHERE office_id=? AND activity_id=?`).all<{
        id: string; user_id: string; rule: string; schedule_key: string; state: string;
      }>(activity.office_id, activity.id);
    const desired = new Set<string>();
    const writes: BoundStatement[] = [];
    for (const preference of preferences) {
      const instant = reminderInstant({ kind: activity.kind, dueOn: activity.due_on, startsAt: activity.starts_at, timezone: preference.timezone });
      if (!instant) continue;
      const scheduleKey = `${activity.version}:${preference.timezone}`;
      desired.add(`${preference.user_id}:${instant.rule}:${scheduleKey}`);
      writes.push(db.prepare(`INSERT INTO notification_reminder(
        id,office_id,activity_id,user_id,activity_version,schedule_key,rule,timezone,due_at,expires_at,state,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,'scheduled',?,?)
      ON CONFLICT(office_id,activity_id,user_id,rule,schedule_key) DO UPDATE SET
        due_at=excluded.due_at,expires_at=excluded.expires_at,timezone=excluded.timezone,updated_at=excluded.updated_at`)
        .bind(randomUUID(), activity.office_id, activity.id, preference.user_id, activity.version, scheduleKey,
          instant.rule, preference.timezone, instant.dueAt, instant.expiresAt, now, now));
    }
    for (const reminder of existing) {
      if (reminder.state === 'scheduled' && !desired.has(`${reminder.user_id}:${reminder.rule}:${reminder.schedule_key}`)) {
        writes.push(db.prepare(`UPDATE notification_reminder SET state='cancelled',updated_at=?
          WHERE id=? AND office_id=? AND state='scheduled'`).bind(now, reminder.id, activity.office_id));
      }
    }
    if (writes.length) await db.batch(writes);
    changed += 1;
  }
  return changed;
}

type DueReminder = {
  id: string; office_id: string; activity_id: string; user_id: string; activity_version: number;
  rule: 'task_due' | 'meeting_soon'; due_at: string; expires_at: string; title: string;
};

export async function emitNextReminder(db: Database = defaultDatabase, now = new Date().toISOString()) {
  await db.prepare(`UPDATE notification_reminder SET state='expired',updated_at=?
    WHERE state='scheduled' AND expires_at<=?`).run(now, now);
  const reminder = await db.prepare(`SELECT r.id,r.office_id,r.activity_id,r.user_id,r.activity_version,
    r.rule,r.due_at,r.expires_at,a.title FROM notification_reminder r
    JOIN agenda_activity a ON a.id=r.activity_id AND a.office_id=r.office_id
    WHERE r.state='scheduled' AND r.due_at<=? AND r.expires_at>?
      AND a.status='pending' AND a.version=r.activity_version ORDER BY r.due_at,r.id LIMIT 1`)
    .get<DueReminder>(now, now);
  if (!reminder) return false;
  const eventType = reminder.rule === 'task_due' ? 'agenda.task.due' : 'agenda.meeting.soon';
  const eventId = randomUUID();
  const dedupe = `reminder:${reminder.id}`;
  const results = await db.batch([
    eventInsertStatement(db, {
      id: eventId, officeId: reminder.office_id, eventType, sourceKind: 'activity', sourceId: reminder.activity_id,
      sourceVersion: reminder.activity_version, actorUserId: null, intendedRecipientIds: [reminder.user_id],
      data: { activityTitle: reminder.title, rule: reminder.rule }, dedupeKey: dedupe,
      createdAt: now, expiresAt: reminder.expires_at,
    }),
    db.prepare(`UPDATE notification_reminder SET state='emitted',updated_at=? WHERE id=? AND state='scheduled'
      AND EXISTS(SELECT 1 FROM notification_event WHERE office_id=? AND dedupe_key=?)`)
      .bind(now, reminder.id, reminder.office_id, dedupe),
  ]);
  return results[0].changes > 0;
}

type DeliveryRow = {
  id: string; event_id: string; office_id: string; user_id: string; subscription_id: string;
  group_key: string; attempts: number; expires_at: string; lease_token: string;
};

type DeliveryContext = {
  encrypted_subscription: string; state: string; auth_generation: number; preference_generation: number;
  read_at: string | null; archived_at: string | null; event_type: NotificationEventType;
  categories_json: string; push_enabled: number; quiet_enabled: number; quiet_start: string | null;
  quiet_end: string | null; timezone: string; rollout_push: number;
};

function retryAt(attempts: number, now: string, retryAfter: string | null) {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return new Date(Date.parse(now) + Math.min(seconds, 86_400) * 1000).toISOString();
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date) && date > Date.parse(now)) return new Date(date).toISOString();
  }
  const ceiling = Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
  return new Date(Date.parse(now) + Math.round(ceiling * (0.75 + Math.random() * 0.5))).toISOString();
}

export async function deliverNextNotification(
  db: Database,
  sender: PushSender,
  now = new Date().toISOString(),
) {
  const token = randomUUID();
  const leaseUntil = new Date(Date.parse(now) + 60_000).toISOString();
  const delivery = await db.prepare(`UPDATE notification_delivery SET state='leased',lease_token=?,lease_until=?,
    attempts=attempts+1,updated_at=? WHERE id=(SELECT id FROM notification_delivery
      WHERE (state IN ('pending','retry') OR (state='leased' AND lease_until<?)) AND next_attempt_at<=?
      ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id,event_id,office_id,user_id,subscription_id,group_key,attempts,expires_at,lease_token`)
    .get<DeliveryRow>(token, leaseUntil, now, now, now);
  if (!delivery) return false;
  const context = await db.prepare(`SELECT s.encrypted_subscription,s.state,s.auth_generation,
    p.revocation_generation AS preference_generation,r.read_at,r.archived_at,e.event_type,
    p.categories_json,p.push_enabled,p.quiet_enabled,p.quiet_start,p.quiet_end,p.timezone,
    ro.push_enabled AS rollout_push
    FROM push_subscription s
    JOIN notification_preference p ON p.office_id=s.office_id AND p.user_id=s.user_id
    JOIN notification_recipient r ON r.office_id=s.office_id AND r.user_id=s.user_id AND r.event_id=?
    JOIN notification_event e ON e.office_id=r.office_id AND e.id=r.event_id
    JOIN notification_rollout ro ON ro.office_id=s.office_id
    JOIN office_member m ON m.office_id=s.office_id AND m.user_id=s.user_id
    WHERE s.id=? AND s.office_id=? AND s.user_id=?`)
    .get<DeliveryContext>(delivery.event_id, delivery.subscription_id, delivery.office_id, delivery.user_id);
  const category = context ? categoryForEvent(context.event_type) : null;
  const categories = context ? JSON.parse(context.categories_json) as Record<string, boolean> : {};
  if (!context || context.state !== 'active' || context.auth_generation !== context.preference_generation
    || context.read_at || context.archived_at || !context.push_enabled || !context.rollout_push
    || (category && categories[category] === false)) {
    await db.prepare(`UPDATE notification_delivery SET state='cancelled',lease_token=NULL,lease_until=NULL,updated_at=?
      WHERE id=? AND lease_token=?`).run(now, delivery.id, token);
    return true;
  }
  if (delivery.expires_at <= now) {
    await db.prepare(`UPDATE notification_delivery SET state='expired',lease_token=NULL,lease_until=NULL,updated_at=?
      WHERE id=? AND lease_token=?`).run(now, delivery.id, token);
    return true;
  }
  const deferUntil = quietUntil({
    now, timezone: context.timezone, enabled: Boolean(context.quiet_enabled),
    start: context.quiet_start, end: context.quiet_end,
  });
  if (deferUntil) {
    await db.prepare(`UPDATE notification_delivery SET state=CASE WHEN ?>=expires_at THEN 'expired' ELSE 'retry' END,
      next_attempt_at=?,attempts=GREATEST(0,attempts-1),lease_token=NULL,lease_until=NULL,updated_at=?
      WHERE id=? AND lease_token=?`).run(deferUntil, deferUntil, now, delivery.id, token);
    return true;
  }
  try {
    const subscription = decryptPushSubscription(context.encrypted_subscription);
    const topic = createHash('sha256').update(delivery.group_key).digest('base64url').slice(0, 32);
    const ttl = Math.max(0, Math.floor((Date.parse(delivery.expires_at) - Date.parse(now)) / 1000));
    await sender.send({
      subscription,
      ttl,
      topic,
      payload: JSON.stringify({ version: 1, id: delivery.event_id, tag: topic, expiresAt: delivery.expires_at }),
    });
    await db.prepare(`UPDATE notification_delivery SET state='accepted',accepted_at=?,error_code=NULL,
      lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=?`).run(now, now, delivery.id, token);
  } catch (error) {
    const transport = error instanceof PushTransportError ? error : new PushTransportError(null, null, 'transport_error');
    const status = transport.statusCode;
    if (status === 404 || status === 410) {
      await db.batch([
        db.prepare(`UPDATE push_subscription SET state='invalid',revoked_at=?,last_error_code=? WHERE id=? AND office_id=?`)
          .bind(now, `http_${status}`, delivery.subscription_id, delivery.office_id),
        db.prepare(`UPDATE notification_delivery SET state='expired',error_code=?,lease_token=NULL,lease_until=NULL,updated_at=?
          WHERE id=? AND lease_token=?`).bind(`http_${status}`, now, delivery.id, token),
      ]);
    } else if (status === 400 || status === 413 || delivery.attempts >= 8) {
      const { captureOperationalError } = await import('../observability/report');
      captureOperationalError(error, 'notifications.delivery');
      await db.prepare(`UPDATE notification_delivery SET state='dead',error_code=?,lease_token=NULL,lease_until=NULL,updated_at=?
        WHERE id=? AND lease_token=?`).run(status ? `http_${status}` : transport.code, now, delivery.id, token);
    } else {
      await db.prepare(`UPDATE notification_delivery SET state='retry',next_attempt_at=?,error_code=?,
        lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=?`)
        .run(retryAt(delivery.attempts, now, transport.retryAfter), status ? `http_${status}` : transport.code, now, delivery.id, token);
    }
  }
  return true;
}

export async function cleanNotificationRetention(db: Database = defaultDatabase, now = new Date().toISOString()) {
  const operationalCutoff = new Date(Date.parse(now) - 30 * 24 * 60 * 60 * 1000).toISOString();
  const inboxCutoff = new Date(Date.parse(now) - 90 * 24 * 60 * 60 * 1000).toISOString();
  const results = await db.batch([
    db.prepare(`DELETE FROM notification_delivery
      WHERE state IN ('accepted','expired','cancelled','dead') AND updated_at<?`).bind(operationalCutoff),
    db.prepare(`DELETE FROM notification_reminder
      WHERE state IN ('emitted','cancelled','expired') AND updated_at<?`).bind(operationalCutoff),
    db.prepare(`DELETE FROM push_subscription
      WHERE state<>'active' AND revoked_at IS NOT NULL AND revoked_at<?`).bind(operationalCutoff),
    db.prepare('DELETE FROM notification_recipient WHERE created_at<?').bind(inboxCutoff),
    // Keep the event identity/dedupe horizon, but discard user-facing copies once the inbox row expires.
    db.prepare(`UPDATE notification_event SET data_json='{}'
      WHERE created_at<? AND projection_state IN ('projected','dead')
        AND NOT EXISTS(SELECT 1 FROM notification_recipient r
          WHERE r.office_id=notification_event.office_id AND r.event_id=notification_event.id)`).bind(inboxCutoff),
  ]);
  return results.reduce((total, result) => total + result.changes, 0);
}

export async function runNotificationPass(input: {
  db?: Database; sender?: PushSender; now?: string; maxPerQueue?: number;
} = {}) {
  const db = input.db ?? defaultDatabase;
  const now = input.now ?? new Date().toISOString();
  const max = input.maxPerQueue ?? 50;
  const retentionWindow = now.slice(0, 13);
  if (now.slice(14, 16) === '00' && lastRetentionWindow !== retentionWindow) {
    await cleanNotificationRetention(db, now);
    lastRetentionWindow = retentionWindow;
  }
  await reconcileNotificationReminders(db, now);
  const counts = { reminders: 0, projected: 0, delivered: 0 };
  for (let index = 0; index < max && await emitNextReminder(db, now); index++) counts.reminders++;
  for (let index = 0; index < max && await projectNextNotification(db, now); index++) counts.projected++;
  if (input.sender) {
    const sender = input.sender;
    for (let index = 0; index < max && await deliverNextNotification(db, sender, now); index++) counts.delivered++;
  }
  return counts;
}
