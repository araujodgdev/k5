import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import { isRetryable, type ConnectorErrorCode, type ConnectorOperation } from '../contracts';

/**
 * Durable collection queue. Section 7: a job carries a lease, a cursor and a checkpoint, retrying
 * is allowed, and duplicating a visible effect is not. The counters here are the ones the
 * operations panel in section 13 reads.
 */

export const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60 * 1000;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;

export type SyncJob = {
  id: string;
  officeId: string;
  subscriptionId: string | null;
  installationId: string;
  linkId: string | null;
  kind: 'refresh' | 'backfill' | 'manual';
  operation: ConnectorOperation;
  request: Record<string, unknown>;
  windowFrom: string | null;
  windowTo: string | null;
  cursor: string | null;
  attempts: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'quarantined';
  pagesFetched: number;
  recordsAccepted: number;
  recordsRejected: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

type JobRow = {
  id: string; office_id: string; subscription_id: string | null; installation_id: string;
  link_id: string | null; kind: string; operation: string; request: string;
  window_from: string | null; window_to: string | null; cursor: string | null;
  attempts: number; status: string; pages_fetched: number; records_accepted: number;
  records_rejected: number; error_code: string | null; error_message: string | null;
  created_at: string; completed_at: string | null;
};

function toJob(row: JobRow): SyncJob {
  let request: Record<string, unknown> = {};
  try { request = JSON.parse(row.request) as Record<string, unknown>; } catch { request = {}; }
  return {
    id: row.id,
    officeId: row.office_id,
    subscriptionId: row.subscription_id,
    installationId: row.installation_id,
    linkId: row.link_id,
    kind: row.kind as SyncJob['kind'],
    operation: row.operation as ConnectorOperation,
    request,
    windowFrom: row.window_from,
    windowTo: row.window_to,
    cursor: row.cursor,
    attempts: row.attempts,
    status: row.status as SyncJob['status'],
    pagesFetched: row.pages_fetched,
    recordsAccepted: row.records_accepted,
    recordsRejected: row.records_rejected,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function findJob(officeId: string, jobId: string): SyncJob | undefined {
  const row = database.prepare('SELECT * FROM judicial_sync_job WHERE id = ? AND office_id = ?').get(jobId, officeId) as JobRow | undefined;
  return row ? toJob(row) : undefined;
}

export function listJobs(officeId: string, limit = 20): SyncJob[] {
  const rows = database.prepare(
    'SELECT * FROM judicial_sync_job WHERE office_id = ? ORDER BY created_at DESC LIMIT ?',
  ).all(officeId, Math.max(1, Math.min(limit, 100))) as JobRow[];
  return rows.map(toJob);
}

export type EnqueueInput = {
  officeId: string;
  installationId: string;
  subscriptionId?: string | null;
  linkId?: string | null;
  kind: SyncJob['kind'];
  operation: ConnectorOperation;
  request?: Record<string, unknown>;
  windowFrom?: string | null;
  windowTo?: string | null;
  /** Reuses a pending job instead of queueing a second one for the same target. */
  idempotencyKey?: string | null;
};

/**
 * Queues collection work. A manual "Atualizar" that arrives while a job for the same target is
 * still pending reuses that job (section 7): the person gets the result they asked for without a
 * second request being spent against the source's budget.
 */
export function enqueueJob(input: EnqueueInput): { job: SyncJob; created: boolean } {
  const key = input.idempotencyKey ?? null;
  if (key) {
    const pending = database.prepare(
      "SELECT * FROM judicial_sync_job WHERE office_id = ? AND idempotency_key = ? AND status IN ('queued','running')",
    ).get(input.officeId, key) as JobRow | undefined;
    if (pending) return { job: toJob(pending), created: false };
  }

  const id = randomUUID();
  database.prepare(`
    INSERT INTO judicial_sync_job (
      id, office_id, subscription_id, installation_id, link_id, kind, operation, request,
      window_from, window_to, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(office_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET
      status = CASE WHEN judicial_sync_job.status IN ('completed','failed','cancelled','quarantined') THEN 'queued' ELSE judicial_sync_job.status END,
      attempts = CASE WHEN judicial_sync_job.status IN ('completed','failed','cancelled','quarantined') THEN 0 ELSE judicial_sync_job.attempts END,
      cursor = CASE WHEN judicial_sync_job.status IN ('completed','failed','cancelled','quarantined') THEN NULL ELSE judicial_sync_job.cursor END,
      error_code = NULL, error_message = NULL, run_after = 0, updated_at = CURRENT_TIMESTAMP
  `).run(
    id, input.officeId, input.subscriptionId ?? null, input.installationId, input.linkId ?? null,
    input.kind, input.operation, JSON.stringify(input.request ?? {}),
    input.windowFrom ?? null, input.windowTo ?? null, key,
  );

  const row = key
    ? database.prepare('SELECT * FROM judicial_sync_job WHERE office_id = ? AND idempotency_key = ?').get(input.officeId, key) as JobRow
    : database.prepare('SELECT * FROM judicial_sync_job WHERE id = ?').get(id) as JobRow;
  return { job: toJob(row), created: row.id === id };
}

/**
 * Takes the next job with a lease. A worker that dies leaves its lease to expire, and the attempt
 * it already spent stays spent, so a job that keeps killing workers eventually stops instead of
 * looping forever.
 */
export function claimJob(now = Date.now()): { job: SyncJob; leaseOwner: string } | undefined {
  const owner = randomUUID();
  database.exec('BEGIN IMMEDIATE');
  try {
    // A job whose lease expired with its attempts already exhausted can never be claimed again by
    // the query below; without this it would sit in 'running' forever with nobody working it.
    database.prepare(`
      UPDATE judicial_sync_job
      SET status = 'failed', lease_owner = NULL, lease_until = 0, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
          error_code = COALESCE(error_code, 'source_unavailable'),
          error_message = COALESCE(error_message, 'A coleta esgotou as tentativas sem concluir.')
      WHERE status = 'running' AND lease_until < ? AND attempts >= ?
    `).run(now, MAX_ATTEMPTS);

    const row = database.prepare(`
      SELECT j.* FROM judicial_sync_job j
      JOIN judicial_source_installation i ON i.id = j.installation_id
      WHERE (j.status = 'queued' OR (j.status = 'running' AND j.lease_until < ?))
        AND j.attempts < ? AND j.run_after <= ? AND i.enabled = 1
      -- Routine refreshes go first: a long backfill must not starve today's publications.
      ORDER BY CASE j.kind WHEN 'manual' THEN 0 WHEN 'refresh' THEN 1 ELSE 2 END, j.created_at
      LIMIT 1
    `).get(now, MAX_ATTEMPTS, now) as JobRow | undefined;

    if (!row) { database.exec('COMMIT'); return undefined; }

    const claimed = database.prepare(`
      UPDATE judicial_sync_job
      SET status = 'running', lease_owner = ?, lease_until = ?, attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND (lease_until < ? OR lease_owner IS NULL)
    `).run(owner, now + LEASE_MS, row.id, now);
    if (!claimed.changes) { database.exec('COMMIT'); return undefined; }

    database.exec('COMMIT');
    return { job: { ...toJob(row), attempts: row.attempts + 1, status: 'running' }, leaseOwner: owner };
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

/** Extends the lease of a job still making progress, so a long sweep is not stolen mid-run. */
export function renewLease(jobId: string, leaseOwner: string, now = Date.now()): boolean {
  return database.prepare(
    'UPDATE judicial_sync_job SET lease_until = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND lease_owner = ?',
  ).run(now + LEASE_MS, jobId, leaseOwner).changes > 0;
}

/**
 * Advances the checkpoint. Only called after the data it covers is committed (section 7 step 6),
 * because a cursor saved before its records are durable is how a window gets skipped.
 */
export function checkpointJob(
  jobId: string,
  leaseOwner: string,
  progress: { cursor: string | null; pagesFetched: number; recordsAccepted: number; recordsRejected: number },
): boolean {
  return database.prepare(`
    UPDATE judicial_sync_job
    SET cursor = ?, pages_fetched = pages_fetched + ?, records_accepted = records_accepted + ?,
        records_rejected = records_rejected + ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND lease_owner = ?
  `).run(
    progress.cursor, progress.pagesFetched, progress.recordsAccepted, progress.recordsRejected,
    jobId, leaseOwner,
  ).changes > 0;
}

export function completeJob(jobId: string, leaseOwner: string): boolean {
  return database.prepare(`
    UPDATE judicial_sync_job
    SET status = 'completed', lease_owner = NULL, lease_until = 0, completed_at = CURRENT_TIMESTAMP,
        error_code = NULL, error_message = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND lease_owner = ?
  `).run(jobId, leaseOwner).changes > 0;
}

/** Exponential backoff with jitter, so a source coming back does not meet every worker at once. */
export function backoffDelayMs(attempts: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds && retryAfterSeconds > 0) return Math.min(retryAfterSeconds * 1000, MAX_BACKOFF_MS);
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

/**
 * Records a failure and decides whether it may be tried again. A rejected credential or a
 * forbidden source is not a transient condition: retrying it just burns the source's patience,
 * so those go straight to a terminal state that asks for a person.
 */
export function failJob(
  jobId: string,
  leaseOwner: string,
  error: { code: ConnectorErrorCode; message: string; retryAfterSeconds?: number },
  now = Date.now(),
): { owned: boolean; retrying: boolean; terminalStatus: SyncJob['status'] } {
  const row = database.prepare('SELECT attempts FROM judicial_sync_job WHERE id = ? AND lease_owner = ?')
    .get(jobId, leaseOwner) as { attempts: number } | undefined;
  if (!row) return { owned: false, retrying: false, terminalStatus: 'failed' };

  const needsPerson = error.code === 'unauthorized' || error.code === 'forbidden' || error.code === 'human_action_required';
  // A changed schema is quarantined rather than failed: the raw payloads are already stored, and
  // the fix is a parser change, not another attempt.
  const quarantine = error.code === 'schema_changed';
  const retrying = !needsPerson && !quarantine && isRetryable(error.code) && row.attempts < MAX_ATTEMPTS;

  const status: SyncJob['status'] = retrying ? 'queued' : quarantine ? 'quarantined' : 'failed';
  const updated = database.prepare(`
    UPDATE judicial_sync_job
    SET status = ?, lease_owner = NULL, lease_until = 0, run_after = ?,
        error_code = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP,
        completed_at = CASE WHEN ? = 'queued' THEN NULL ELSE CURRENT_TIMESTAMP END
    WHERE id = ? AND lease_owner = ?
  `).run(
    status,
    retrying ? now + backoffDelayMs(row.attempts, error.retryAfterSeconds) : 0,
    error.code, error.message, status, jobId, leaseOwner,
  );
  if (!updated.changes) return { owned: false, retrying: false, terminalStatus: 'failed' };

  // A credential that stopped working must stop the standing authorization too, rather than
  // letting the scheduler queue the same rejection every interval.
  if (needsPerson) {
    database.prepare(`
      UPDATE judicial_subscription SET status = 'suspended', suspended_reason = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = (SELECT subscription_id FROM judicial_sync_job WHERE id = ?) AND status = 'active'
    `).run(error.message, jobId);
  }

  return { owned: true, retrying, terminalStatus: status };
}

export function cancelJob(officeId: string, jobId: string): boolean {
  return database.prepare(`
    UPDATE judicial_sync_job
    SET status = 'cancelled', lease_owner = NULL, lease_until = 0, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND office_id = ? AND status IN ('queued','running')
  `).run(jobId, officeId).changes > 0;
}

/**
 * Reserves one request against both budgets before it is made. The counter lives in the database
 * precisely because a per-process limiter multiplied by the number of workers is not a limit.
 */
export function reserveRequestBudget(
  officeId: string,
  installation: { id: string; dailyRequestBudget: number; rateLimitPerMinute: number },
  now = Date.now(),
): { allowed: true } | { allowed: false; reason: 'daily_budget' | 'rate_limit'; retryAfterMs: number } {
  const day = new Date(now).toISOString().slice(0, 10);
  const minimumSpacingMs = Math.ceil(60_000 / installation.rateLimitPerMinute);

  database.exec('BEGIN IMMEDIATE');
  try {
    const row = database.prepare(
      'SELECT requests, last_request_at FROM judicial_rate_budget WHERE installation_id = ? AND office_id = ? AND day = ?',
    ).get(installation.id, officeId, day) as { requests: number; last_request_at: number } | undefined;

    if (row && row.requests >= installation.dailyRequestBudget) {
      database.exec('COMMIT');
      // Tomorrow, not in a minute: the day's allowance is spent.
      const midnight = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
      return { allowed: false, reason: 'daily_budget', retryAfterMs: Math.max(1000, midnight - now) };
    }
    if (row && now - row.last_request_at < minimumSpacingMs) {
      database.exec('COMMIT');
      return { allowed: false, reason: 'rate_limit', retryAfterMs: minimumSpacingMs - (now - row.last_request_at) };
    }

    database.prepare(`
      INSERT INTO judicial_rate_budget (installation_id, office_id, day, requests, last_request_at)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(installation_id, office_id, day) DO UPDATE SET
        requests = judicial_rate_budget.requests + 1, last_request_at = excluded.last_request_at
    `).run(installation.id, officeId, day, now);
    database.exec('COMMIT');
    return { allowed: true };
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function requestsUsedToday(officeId: string, installationId: string, now = Date.now()): number {
  const day = new Date(now).toISOString().slice(0, 10);
  const row = database.prepare(
    'SELECT requests FROM judicial_rate_budget WHERE installation_id = ? AND office_id = ? AND day = ?',
  ).get(installationId, officeId, day) as { requests: number } | undefined;
  return row?.requests ?? 0;
}
