import { randomUUID } from 'node:crypto';
import { database, type Database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';

export type GoogleJobKind = 'calendar_list' | 'calendar_sync' | 'calendar_watch' | 'calendar_push' | 'drive_import' | 'operation_reconcile';
export type GoogleJob = {
  id: string; office_id: string; user_id: string; connection_id: string; kind: GoogleJobKind; runtime: 'edge' | 'node';
  subject_id: string | null; dedupe_key: string | null; status: string; attempts: number; lease_token: string;
  checkpoint_json: string | null; run_after: string;
};

/** Jobs are rows first; a queue message is only a hint carrying the id. Duplicates collapse on dedupe_key. */
export async function enqueueGoogleJob(input: {
  officeId: string; userId: string; connectionId: string; kind: GoogleJobKind; subjectId?: string | null;
  dedupeKey?: string | null; runtime?: 'edge' | 'node'; runAfter?: Date; id?: string;
}, db: Pick<Database, 'prepare'> = database) {
  const id = input.id ?? randomUUID();
  const inserted = await db.prepare(`INSERT INTO google_job(id,office_id,user_id,connection_id,kind,runtime,subject_id,dedupe_key,status,run_after)
    VALUES(?,?,?,?,?,?,?,?,'queued',?) ON CONFLICT DO NOTHING RETURNING id`)
    .get<{ id: string }>(id, input.officeId, input.userId, input.connectionId, input.kind, input.runtime ?? 'edge', input.subjectId ?? null,
      input.dedupeKey ?? null, (input.runAfter ?? new Date()).toISOString());
  if (inserted) return inserted.id;
  const existing = input.dedupeKey
    ? await db.prepare(`SELECT id FROM google_job WHERE dedupe_key=? AND status IN ('queued','running')`).get<{ id: string }>(input.dedupeKey)
    : undefined;
  return existing?.id ?? id;
}

/**
 * Claims the next due job. The member must still belong to the office and the connection must be
 * active; anything else is cancelled here instead of running with stale authority.
 */
export async function claimGoogleJob(runtime: 'edge' | 'node', db: Database = database, leaseMs = 120_000): Promise<GoogleJob | null> {
  await db.prepare(`UPDATE google_job j SET status='cancelled',lease_token=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE j.status IN ('queued','running') AND (
      NOT EXISTS(SELECT 1 FROM google_connection c WHERE c.id=j.connection_id AND c.status='active')
      OR NOT EXISTS(SELECT 1 FROM office_member m WHERE m.office_id=j.office_id AND m.user_id=j.user_id))`).run();
  const token = randomUUID();
  return await db.prepare(`UPDATE google_job SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=(SELECT id FROM google_job WHERE runtime=? AND run_after<=CURRENT_TIMESTAMP
      AND (status='queued' OR (status='running' AND lease_until<CURRENT_TIMESTAMP))
      ORDER BY run_after,id LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id,office_id,user_id,connection_id,kind,runtime,subject_id,dedupe_key,status,attempts,lease_token,checkpoint_json,run_after`)
    .get<GoogleJob>(token, new Date(Date.now() + leaseMs).toISOString(), runtime) ?? null;
}

export async function completeGoogleJob(job: GoogleJob, db: Database = database) {
  await db.prepare(`UPDATE google_job SET status='succeeded',lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?`).run(job.id, job.lease_token);
}

/** Retries with backoff; after `maxAttempts` the job is dead and the owner sees the failure where it matters. */
export async function failGoogleJob(job: GoogleJob, code: string, db: Database = database, maxAttempts = 6, retry = true) {
  const dead = !retry || job.attempts >= maxAttempts;
  const delay = Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, job.attempts - 1));
  await db.prepare(`UPDATE google_job SET status=?,last_error_code=?,run_after=?,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?`)
    .run(dead ? 'dead' : 'queued', code.slice(0, 80), new Date(Date.now() + delay).toISOString(), job.id, job.lease_token);
  return dead;
}

export async function checkpointGoogleJob(job: GoogleJob, checkpoint: unknown, db: Database = database) {
  const result = await db.prepare(`UPDATE google_job SET checkpoint_json=?,lease_until=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=? AND status='running' AND lease_until>CURRENT_TIMESTAMP`)
    .run(JSON.stringify(checkpoint), new Date(Date.now() + 120_000).toISOString(), job.id, job.lease_token);
  if (!result.changes) throw new CapabilityError('CONFLICT', 'A execução perdeu sua reserva na fila.');
}
