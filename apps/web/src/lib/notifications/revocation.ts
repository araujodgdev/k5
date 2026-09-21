import type { BoundStatement, Database } from '@/lib/database';

/** Shared by Better Auth hooks, application logout, and account lifecycle code. */
export async function revokePushSubscriptionsForUser(db: Database, userId: string) {
  const now = new Date().toISOString();
  let subscriptions: Array<{ id: string; office_id: string }>;
  let preferences: Array<{ office_id: string }>;
  try {
    subscriptions = await db.prepare('SELECT id,office_id FROM push_subscription WHERE user_id=? AND state=\'active\'')
      .all<{ id: string; office_id: string }>(userId);
    preferences = await db.prepare('SELECT office_id FROM notification_preference WHERE user_id=?')
      .all<{ office_id: string }>(userId);
  } catch (error) {
    // Supports an additive rollout where an older application briefly runs before migration 0017.
    if (/no such table|does not exist/i.test(String(error))) return;
    throw error;
  }
  const statements: BoundStatement[] = [
    ...preferences.map(({ office_id }) => db.prepare(`UPDATE notification_preference
      SET revocation_generation=revocation_generation+1,updated_at=? WHERE office_id=? AND user_id=?`)
      .bind(now, office_id, userId)),
    ...subscriptions.flatMap(({ id, office_id }) => [
      db.prepare(`UPDATE push_subscription SET state='revoked',revoked_at=?,last_reconciled_at=?
        WHERE id=? AND office_id=? AND user_id=?`).bind(now, now, id, office_id, userId),
      db.prepare(`UPDATE notification_delivery SET state='cancelled',updated_at=?
        WHERE subscription_id=? AND office_id=? AND user_id=? AND state IN ('pending','retry','leased')`)
        .bind(now, id, office_id, userId),
    ]),
  ];
  if (statements.length) await db.batch(statements);
}
