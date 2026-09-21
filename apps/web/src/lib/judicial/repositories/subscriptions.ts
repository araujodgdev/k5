import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';

/**
 * Standing authorization for recurring collection. Section 7 step 3: recurring work runs against
 * this row and the current membership of the person who authorized it — not against a user
 * session kept artificially alive so a background job keeps passing an interactive check.
 */

export type Subscription = {
  id: string;
  officeId: string;
  installationId: string;
  connectionId: string | null;
  linkId: string | null;
  targetKind: 'case' | 'publications_by_case' | 'jurisprudence_collection';
  filters: Record<string, unknown>;
  intervalMinutes: number;
  dailyRequestBudget: number;
  watermark: string | null;
  status: 'active' | 'paused' | 'suspended' | 'cancelled';
  suspendedReason: string | null;
  nextRunAt: number;
  lastSuccessAt: string | null;
  authorizedBy: string;
  createdAt: string;
};

type SubscriptionRow = {
  id: string; office_id: string; installation_id: string; connection_id: string | null;
  link_id: string | null; target_kind: string; filters: string; interval_minutes: number;
  daily_request_budget: number; watermark: string | null; status: string;
  suspended_reason: string | null; next_run_at: number; last_success_at: string | null;
  authorized_by: string; created_at: string;
};

function toSubscription(row: SubscriptionRow): Subscription {
  let filters: Record<string, unknown> = {};
  try { filters = JSON.parse(row.filters) as Record<string, unknown>; } catch { filters = {}; }
  return {
    id: row.id,
    officeId: row.office_id,
    installationId: row.installation_id,
    connectionId: row.connection_id,
    linkId: row.link_id,
    targetKind: row.target_kind as Subscription['targetKind'],
    filters,
    intervalMinutes: row.interval_minutes,
    dailyRequestBudget: row.daily_request_budget,
    watermark: row.watermark,
    status: row.status as Subscription['status'],
    suspendedReason: row.suspended_reason,
    nextRunAt: row.next_run_at,
    lastSuccessAt: row.last_success_at,
    authorizedBy: row.authorized_by,
    createdAt: row.created_at,
  };
}

export async function findSubscription(officeId: string, id: string): Promise<Subscription | undefined> {
  const row = await database.prepare('SELECT * FROM judicial_subscription WHERE id = ? AND office_id = ?').get(id, officeId) as SubscriptionRow | undefined;
  return row ? toSubscription(row) : undefined;
}

export async function findSubscriptionById(id: string): Promise<Subscription | undefined> {
  const row = await database.prepare('SELECT * FROM judicial_subscription WHERE id = ?').get(id) as SubscriptionRow | undefined;
  return row ? toSubscription(row) : undefined;
}

export async function listSubscriptions(officeId: string, filter: { linkId?: string } = {}): Promise<Subscription[]> {
  const clauses = ['office_id = ?'];
  const params: (string | number | null)[] = [officeId];
  if (filter.linkId) { clauses.push('link_id = ?'); params.push(filter.linkId); }
  const rows = await database.prepare(
    `SELECT * FROM judicial_subscription WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`,
  ).all(...params) as SubscriptionRow[];
  return rows.map(toSubscription);
}

export type CreateSubscriptionInput = {
  officeId: string;
  installationId: string;
  linkId: string | null;
  connectionId?: string | null;
  targetKind: Subscription['targetKind'];
  filters?: Record<string, unknown>;
  intervalMinutes?: number;
  dailyRequestBudget?: number;
  authorizedBy: string;
};

/** One standing subscription per link and installation; asking again reactivates it. */
export async function createSubscription(input: CreateSubscriptionInput): Promise<{ subscription: Subscription; created: boolean }> {
  const existing = await database.prepare(
    `SELECT * FROM judicial_subscription
     WHERE office_id = ? AND installation_id = ? AND COALESCE(link_id,'') = ? AND target_kind = ? AND status <> 'cancelled'`,
  ).get(input.officeId, input.installationId, input.linkId ?? '', input.targetKind) as SubscriptionRow | undefined;

  if (existing) {
    if (existing.status !== 'active') {
      await database.prepare(
        "UPDATE judicial_subscription SET status = 'active', suspended_reason = NULL, next_run_at = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      ).run(existing.id);
    }
    if (existing.link_id) {
      await database.prepare(`INSERT INTO notification_follow(id,office_id,case_id,user_id,started_at)
        SELECT ?,l.office_id,l.case_id,?,CURRENT_TIMESTAMP FROM judicial_case_link l
        WHERE l.id=? AND l.office_id=?
          AND NOT EXISTS(SELECT 1 FROM notification_follow f WHERE f.office_id=l.office_id
            AND f.case_id=l.case_id AND f.user_id=? AND f.ended_at IS NULL)`)
        .run(randomUUID(), input.authorizedBy, existing.link_id, input.officeId, input.authorizedBy);
    }
    return { subscription: (await findSubscriptionById(existing.id))!, created: false };
  }

  const id = randomUUID();
  const writes = [database.prepare(`
    INSERT INTO judicial_subscription (
      id, office_id, installation_id, connection_id, link_id, target_kind, filters,
      interval_minutes, daily_request_budget, authorized_by, next_run_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).bind(
    id, input.officeId, input.installationId, input.connectionId ?? null, input.linkId,
    input.targetKind, JSON.stringify(input.filters ?? {}),
    input.intervalMinutes ?? 360, input.dailyRequestBudget ?? 50, input.authorizedBy,
  )];
  if (input.linkId) writes.push(database.prepare(`INSERT INTO notification_follow(id,office_id,case_id,user_id,started_at)
    SELECT ?,l.office_id,l.case_id,?,CURRENT_TIMESTAMP FROM judicial_case_link l
    WHERE l.id=? AND l.office_id=?
      AND NOT EXISTS(SELECT 1 FROM notification_follow f WHERE f.office_id=l.office_id
        AND f.case_id=l.case_id AND f.user_id=? AND f.ended_at IS NULL)`)
    .bind(randomUUID(), input.authorizedBy, input.linkId, input.officeId, input.authorizedBy));
  await database.batch(writes);
  return { subscription: (await findSubscriptionById(id))!, created: true };
}

export async function setSubscriptionStatus(
  officeId: string,
  id: string,
  status: Subscription['status'],
  reason: string | null = null,
): Promise<Subscription | undefined> {
  await database.prepare(
    'UPDATE judicial_subscription SET status = ?, suspended_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND office_id = ?',
  ).run(status, reason, id, officeId);
  return findSubscription(officeId, id);
}

/**
 * Moves the watermark and schedules the next run. Only called after a successful, committed
 * collection: advancing it on a failure would quietly skip the window that failed.
 */
export async function recordSubscriptionSuccess(id: string, watermark: string | null, now = Date.now()): Promise<void> {
  const row = await database.prepare('SELECT interval_minutes FROM judicial_subscription WHERE id = ?').get(id) as { interval_minutes: number } | undefined;
  if (!row) return;
  await database.prepare(`
    UPDATE judicial_subscription
    SET watermark = COALESCE(?, watermark), last_success_at = CURRENT_TIMESTAMP,
        next_run_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(watermark, now + row.interval_minutes * 60_000, id);
}

/** Pushes the next attempt out without touching the watermark. */
export async function deferSubscription(id: string, delayMs: number, now = Date.now()): Promise<void> {
  await database.prepare('UPDATE judicial_subscription SET next_run_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(now + delayMs, id);
}

export async function listDueSubscriptions(now = Date.now(), limit = 20): Promise<Subscription[]> {
  const rows = await database.prepare(`
    SELECT s.* FROM judicial_subscription s
    JOIN judicial_source_installation i ON i.id = s.installation_id
    WHERE s.status = 'active' AND s.next_run_at <= ? AND i.enabled = 1
    ORDER BY s.next_run_at LIMIT ?
  `).all(now, limit) as SubscriptionRow[];
  return rows.map(toSubscription);
}

/**
 * Section 7 step 3: before recurring work runs, the authorization behind it is re-read. A person
 * removed from the office no longer authorizes collection on that office's behalf, and the link
 * that justified the subscription has to still be active and confirmed.
 *
 * `waiting` separates "not authorized yet" from "no longer authorized". A link still awaiting
 * review is the first: suspending the subscription over it would mean that confirming the link
 * later silently fails to resume anything, because nothing reactivates a suspended row.
 */
export type AuthorizationCheck =
  | { ok: true }
  | { ok: false; reason: string; waiting: boolean };

export async function subscriptionStillAuthorized(subscription: Subscription): Promise<AuthorizationCheck> {
  const member = await database.prepare('SELECT role FROM office_member WHERE user_id = ? AND office_id = ?')
    .get(subscription.authorizedBy, subscription.officeId) as { role: string } | undefined;
  if (!member) return { ok: false, waiting: false, reason: 'Quem autorizou esta assinatura não faz mais parte do escritório.' };
  if (member.role === 'reviewer') return { ok: false, waiting: false, reason: 'Quem autorizou esta assinatura não tem mais permissão de escrita.' };

  if (subscription.linkId) {
    const link = await database.prepare(
      'SELECT status, confirmation FROM judicial_case_link WHERE id = ? AND office_id = ?',
    ).get(subscription.linkId, subscription.officeId) as { status: string; confirmation: string } | undefined;
    if (!link) return { ok: false, waiting: false, reason: 'O vínculo desta assinatura não existe mais.' };
    if (link.status !== 'active') return { ok: false, waiting: false, reason: 'O vínculo desta assinatura foi removido.' };
    if (link.confirmation === 'rejected') return { ok: false, waiting: false, reason: 'O vínculo desta assinatura foi rejeitado.' };
    if (link.confirmation !== 'confirmed') return { ok: false, waiting: true, reason: 'O vínculo desta assinatura aguarda confirmação.' };
  }

  if (subscription.connectionId) {
    const connection = await database.prepare('SELECT status FROM judicial_connection WHERE id = ? AND office_id = ?')
      .get(subscription.connectionId, subscription.officeId) as { status: string } | undefined;
    if (!connection) return { ok: false, waiting: false, reason: 'A conexão desta assinatura não existe mais.' };
    if (connection.status !== 'active') return { ok: false, waiting: false, reason: 'A conexão desta assinatura foi revogada ou expirou.' };
  }

  return { ok: true };
}
