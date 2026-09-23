import { database as defaultDatabase, type Database } from '@/lib/database';
import { captureOperationalError } from '@/lib/observability/report';
import { CapabilityError } from '@/lib/capabilities/errors';
import { claimGoogleJob, completeGoogleJob, failGoogleJob, type GoogleJob, type GoogleJobKind } from './jobs';
import { enqueueReconcile, reconcileOperationById, type Reconciler } from './operations';
import { sweepRemovedMembers } from './connections';
import type { GoogleAction } from './policy';

export type JobHandlers = Partial<Record<GoogleJobKind, (job: GoogleJob, db: Database) => Promise<void>>>;

/** Reconciliation handler over a set of module reconcilers. Unknown stays unknown until Google answers. */
export function reconcileHandler(reconcilers: Partial<Record<GoogleAction, Reconciler>>) {
  return async (job: GoogleJob, db: Database) => {
    const outcome = await reconcileOperationById(job.subject_id ?? '', reconcilers, db);
    if (outcome === 'unresolved') throw new CapabilityError('NOT_READY', 'unresolved');
  };
}

/** Runs one job. Authorization failures end the job; transient failures retry with backoff. */
export async function runNextGoogleJob(runtime: 'edge' | 'node', handlers: JobHandlers, db: Database = defaultDatabase): Promise<boolean> {
  const job = await claimGoogleJob(runtime, db);
  if (!job) return false;
  try {
    const handler = handlers[job.kind];
    if (!handler) throw new CapabilityError('INVALID', `Sem executor para ${job.kind} em ${runtime}.`);
    await handler(job, db);
    await completeGoogleJob(job, db);
  } catch (error) {
    const code = error instanceof CapabilityError ? error.code : error instanceof Error ? error.name : 'error';
    const retry = !(error instanceof CapabilityError && ['FORBIDDEN', 'SCOPE_REQUIRED', 'NOT_FOUND', 'INVALID'].includes(error.code));
    const dead = await failGoogleJob(job, code, db, job.kind === 'operation_reconcile' ? 12 : 6, retry);
    if (dead && !(error instanceof CapabilityError)) captureOperationalError(error, `google.job.${job.kind}`);
  }
  return true;
}

/**
 * Duties every runtime can do: departed members lose access, abandoned or unknown operations are
 * queued for a check, and short-lived rows are cleaned.
 */
export async function googleMaintenance(db: Database = defaultDatabase) {
  const removed = await sweepRemovedMembers(db);
  // A process can stop after admission but before claiming. No external effect occurred; release
  // every reserved action in the same statement as the pending → failed transition.
  await db.prepare(`WITH abandoned AS (
    UPDATE google_operation SET status='failed',error_code='not_started',error_message='A execução não foi iniciada. Tente novamente.',
      finished_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE status='pending' AND updated_at<CURRENT_TIMESTAMP-INTERVAL '5 minutes'
    RETURNING office_id,user_id,usage_day,actions_json
  ), units AS (
    SELECT office_id,user_id,usage_day,jsonb_array_elements_text(actions_json::jsonb) AS action FROM abandoned
  ), totals AS (SELECT office_id,user_id,usage_day,action,count(*) AS amount FROM units GROUP BY office_id,user_id,usage_day,action)
  UPDATE google_usage_counter c SET used=GREATEST(0,c.used-t.amount) FROM totals t
    WHERE c.office_id=t.office_id AND c.user_id=t.user_id AND c.usage_day=t.usage_day AND c.action=t.action`).run();
  const stuck = await db.prepare(`SELECT id,office_id,user_id,connection_id,action FROM google_operation o
    WHERE (status='unknown' OR (status='running' AND lease_until<CURRENT_TIMESTAMP))
      AND NOT EXISTS(SELECT 1 FROM google_job j WHERE j.dedupe_key='reconcile:'||o.id AND j.status IN ('queued','running'))
      AND updated_at>CURRENT_TIMESTAMP - INTERVAL '7 days' LIMIT 50`).all<{ id: string; office_id: string; user_id: string; connection_id: string; action: GoogleAction }>();
  for (const row of stuck) await enqueueReconcile(row, 0, db);
  await db.prepare('DELETE FROM google_oauth_state WHERE expires_at<CURRENT_TIMESTAMP').run();
  await db.prepare(`DELETE FROM google_job WHERE status IN ('succeeded','cancelled') AND updated_at<CURRENT_TIMESTAMP - INTERVAL '7 days'`).run();
  return { removed, reconciling: stuck.length };
}

export async function drainGoogleJobs(runtime: 'edge' | 'node', handlers: JobHandlers, db: Database, max: number, deadline = Number.POSITIVE_INFINITY) {
  let processed = 0;
  while (processed < max && Date.now() < deadline && await runNextGoogleJob(runtime, handlers, db)) processed++;
  return processed;
}
