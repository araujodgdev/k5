import { z } from 'zod';
import type { Database } from '../db/types';

export const QUEUE_HEALTH_POLICY = {
  staleAfterMinutes: 15,
  recentFailureMinutes: 24 * 60,
};

const queueName = z.enum([
  'vault.ingestion', 'vault.indexing', 'google.edge', 'google.node', 'research', 'judicial',
  'notifications.projection', 'notifications.delivery', 'ai.documents', 'chat',
  'whatsapp', 'personal.email', 'artifacts.verification', 'research.assessment', 'vault.deletion',
]);
const alertSchema = z.object({
  queue: queueName,
  reason: z.enum(['stale', 'failed']),
  count: z.number().int().positive(),
  oldestAgeMinutes: z.number().int().nonnegative(),
}).strict();

export type QueueHealthAlert = z.infer<typeof alertSchema>;

type Check = { predicate: string; since: string };
type Queue = {
  queue: QueueHealthAlert['queue'];
  from: string;
  stale: Check;
  failed: Check | null;
};

const millisecondTime = (column: string) => `to_timestamp(${column}::double precision / 1000)`;
const googleActive = `EXISTS (SELECT 1 FROM google_connection c WHERE c.id=j.connection_id AND c.status='active')
  AND EXISTS (SELECT 1 FROM office_member m WHERE m.office_id=j.office_id AND m.user_id=j.user_id)`;
const projectionActive = 'COALESCE((SELECT r.capture_enabled FROM notification_rollout r WHERE r.office_id=e.office_id),1)=1';
const whatsappActive = `(j.kind='revoke_key' OR EXISTS (
  SELECT 1 FROM whatsapp_connection c WHERE c.id=j.connection_id AND c.office_id=j.office_id AND (
    (j.kind='event' AND (c.status IN ('connected','reconnect_required') OR (c.status='pending' AND c.verified_at IS NOT NULL))) OR
    (j.kind='disconnect' AND c.status='disconnecting' AND c.generation=j.generation) OR
    (j.kind IN ('history','history_refresh','conversations','media') AND c.status='connected' AND c.generation=j.generation))))`;

const queues: Queue[] = [
  {
    queue: 'vault.ingestion', from: 'vault_document d',
    stale: { predicate: "d.deleted_at IS NULL AND d.status IN ('queued','processing')",
      since: 'GREATEST(d.updated_at,d.lease_expires_at)' },
    failed: { predicate: "d.deleted_at IS NULL AND d.status='failed'", since: 'd.updated_at' },
  },
  {
    queue: 'vault.indexing',
    from: 'knowledge_index_job j JOIN vault_document d ON d.id=j.document_id AND d.office_id=j.office_id',
    stale: { predicate: "d.deleted_at IS NULL AND j.status IN ('queued','running')",
      since: `GREATEST(j.updated_at,${millisecondTime('j.lease_until')})` },
    failed: { predicate: "d.deleted_at IS NULL AND j.status='failed'", since: 'j.updated_at' },
  },
  ...(['edge', 'node'] satisfies Array<'edge' | 'node'>).map((runtime): Queue => ({
    queue: runtime === 'edge' ? 'google.edge' : 'google.node', from: 'google_job j',
    stale: {
      predicate: `j.runtime='${runtime}' AND j.status IN ('queued','running') AND ${googleActive}`,
      since: 'GREATEST(j.updated_at,j.run_after,j.lease_until)',
    },
    failed: { predicate: `j.runtime='${runtime}' AND j.status IN ('failed','dead') AND ${googleActive}`, since: 'j.updated_at' },
  })),
  {
    queue: 'research', from: 'research_job j',
    stale: { predicate: "j.status IN ('queued','running')",
      since: `GREATEST(j.updated_at,${millisecondTime('j.run_after')},${millisecondTime('j.lease_until')})` },
    failed: { predicate: "j.status='failed'", since: 'j.updated_at' },
  },
  {
    queue: 'judicial', from: 'judicial_sync_job j JOIN judicial_source_installation i ON i.id=j.installation_id',
    stale: { predicate: "i.enabled=1 AND j.status IN ('queued','running')",
      since: `GREATEST(j.updated_at,${millisecondTime('j.run_after')},${millisecondTime('j.lease_until')})` },
    failed: { predicate: "i.enabled=1 AND j.status IN ('failed','quarantined')", since: 'j.updated_at' },
  },
  {
    queue: 'notifications.projection', from: 'notification_event e',
    stale: {
      predicate: `e.projection_state IN ('pending','leased') AND ${projectionActive}`,
      since: 'GREATEST(e.created_at,e.lease_until)',
    },
    failed: { predicate: `e.projection_state='dead' AND ${projectionActive}`, since: 'COALESCE(e.projection_failed_at,e.created_at)' },
  },
  {
    queue: 'notifications.delivery', from: 'notification_delivery d',
    stale: { predicate: "d.state IN ('pending','retry','leased') AND d.expires_at>b.now_at",
      since: 'GREATEST(d.updated_at,d.next_attempt_at,d.lease_until)' },
    failed: { predicate: "d.state='dead'", since: 'd.updated_at' },
  },
  {
    queue: 'ai.documents', from: 'ai_run r',
    stale: { predicate: "r.status IN ('queued','running')",
      since: `GREATEST(r.updated_at,${millisecondTime('r.lease_until')})` },
    failed: { predicate: "r.status='failed'", since: 'r.updated_at' },
  },
  {
    queue: 'chat', from: 'ai_conversation c',
    stale: { predicate: 'c.busy_until>0', since: millisecondTime('c.busy_until') },
    failed: null,
  },
  {
    queue: 'whatsapp', from: 'whatsapp_job j',
    stale: { predicate: `j.status IN ('queued','running') AND ${whatsappActive}`, since: 'GREATEST(j.updated_at,j.available_at,j.locked_until)' },
    failed: { predicate: `j.status='failed' AND ${whatsappActive}`, since: 'j.updated_at' },
  },
  {
    queue: 'personal.email', from: 'personal_email_outbox e',
    stale: { predicate: "e.state IN ('pending','retry','leased')", since: 'GREATEST(e.updated_at,e.next_attempt_at,e.lease_until)' },
    failed: { predicate: "e.state IN ('failed','unknown')", since: 'e.updated_at' },
  },
  {
    queue: 'artifacts.verification', from: 'artifact_verification v',
    stale: { predicate: "v.mode<>'off' AND v.status IN ('queued','running')", since: `GREATEST(v.updated_at,${millisecondTime('v.lease_until')})` },
    failed: { predicate: "v.mode<>'off' AND v.status='incomplete' AND v.attempts>=5", since: 'v.updated_at' },
  },
  {
    queue: 'research.assessment', from: 'research_case_assessment a JOIN vault_case c ON c.id=a.case_id AND c.office_id=a.office_id',
    stale: { predicate: "c.deleted_at IS NULL AND a.mode<>'off' AND a.status IN ('queued','running')", since: `GREATEST(a.updated_at,${millisecondTime('a.lease_until')})` },
    failed: { predicate: "c.deleted_at IS NULL AND a.mode<>'off' AND a.status='unavailable'", since: 'a.updated_at' },
  },
  {
    queue: 'vault.deletion', from: 'vault_deletion_queue d',
    stale: { predicate: 'd.completed_at IS NULL AND d.attempts<5', since: 'd.updated_at' },
    failed: { predicate: 'd.completed_at IS NULL AND d.attempts>=5', since: 'd.updated_at' },
  },
];

function aggregate(queue: Queue, reason: QueueHealthAlert['reason'], check: Check) {
  const timeWindow = reason === 'stale'
    ? `${check.since}<=b.stale_before`
    : `${check.since}>=b.failed_after AND ${check.since}<=b.now_at`;
  return `SELECT '${queue.queue}' AS queue,'${reason}' AS reason,COUNT(*) AS count,
    FLOOR(EXTRACT(EPOCH FROM (MAX(b.now_at)-MIN(${check.since})))/60)::integer AS oldestAgeMinutes
    FROM ${queue.from} CROSS JOIN bounds b
    WHERE ${check.predicate} AND ${timeWindow}
    HAVING COUNT(*)>0`;
}

const query = `WITH bounds AS (
  SELECT ?::timestamptz AS now_at,?::timestamptz AS stale_before,?::timestamptz AS failed_after
)
${queues.flatMap(queue => [
  aggregate(queue, 'stale', queue.stale),
  ...(queue.failed ? [aggregate(queue, 'failed', queue.failed)] : []),
]).join('\nUNION ALL\n')}
ORDER BY queue,reason`;

/** Operator-only aggregate scan. No office IDs, job IDs, payloads, or stored errors leave the database. */
export async function inspectQueueHealth(db: Database, now: number): Promise<QueueHealthAlert[]> {
  const rows = await db.prepare(query).all<unknown>(
    new Date(now).toISOString(),
    new Date(now - QUEUE_HEALTH_POLICY.staleAfterMinutes * 60_000).toISOString(),
    new Date(now - QUEUE_HEALTH_POLICY.recentFailureMinutes * 60_000).toISOString(),
  );
  return z.array(alertSchema).parse(rows);
}
