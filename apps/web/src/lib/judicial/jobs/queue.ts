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

export async function findJob(officeId: string, jobId: string): Promise<SyncJob | undefined> {
  const row = await database.prepare('SELECT * FROM judicial_sync_job WHERE id = ? AND office_id = ?').get(jobId, officeId) as JobRow | undefined;
  return row ? toJob(row) : undefined;
}

export async function listJobs(
  officeId: string,
  filter: {
    caseId?: string;
    linkId?: string;
    installationId?: string;
    status?: SyncJob['status'];
    limit?: number;
  } = {},
): Promise<SyncJob[]> {
  const clauses = ['j.office_id = ?'];
  const params: (string | number)[] = [officeId];
  if (filter.caseId) { clauses.push('l.case_id = ?'); params.push(filter.caseId); }
  if (filter.linkId) { clauses.push('j.link_id = ?'); params.push(filter.linkId); }
  if (filter.installationId) { clauses.push('j.installation_id = ?'); params.push(filter.installationId); }
  if (filter.status) { clauses.push('j.status = ?'); params.push(filter.status); }
  const limit = Math.max(1, Math.min(filter.limit ?? 20, 100));
  const rows = await database.prepare(`
    SELECT j.* FROM judicial_sync_job j
    LEFT JOIN judicial_case_link l ON l.id = j.link_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY j.created_at DESC, j.sequence_no DESC LIMIT ?
  `).all(...params, limit) as JobRow[];
  return rows.map(toJob);
}

/** One durable status row per visible link, used to restore collection state after a reload. */
export async function latestJobsForLinks(
  officeId: string,
  linkIds: string[],
  completedOnly = false,
): Promise<SyncJob[]> {
  if (linkIds.length === 0) return [];
  const placeholders = linkIds.map(() => '?').join(', ');
  const statusClause = completedOnly ? "AND j.status = 'completed'" : '';
  const rows = await database.prepare(`
    SELECT ranked.* FROM (
      SELECT j.*, ROW_NUMBER() OVER (
        PARTITION BY j.link_id ORDER BY j.created_at DESC, j.sequence_no DESC
      ) AS row_number
      FROM judicial_sync_job j
      WHERE j.office_id = ? AND j.link_id IN (${placeholders}) ${statusClause}
    ) ranked
    WHERE ranked.row_number = 1
    ORDER BY ranked.created_at DESC, ranked.id DESC
  `).all(officeId, ...linkIds) as JobRow[];
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
export async function enqueueJob(input: EnqueueInput): Promise<{ job: SyncJob; created: boolean }> {
  const key = input.idempotencyKey ?? null;
  if (key) {
    const pending = await database.prepare(
      "SELECT * FROM judicial_sync_job WHERE office_id = ? AND idempotency_key = ? AND status IN ('queued','running')",
    ).get(input.officeId, key) as JobRow | undefined;
    if (pending) return { job: toJob(pending), created: false };
  }

  const id = randomUUID();
  await database.prepare(`
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
    ? await database.prepare('SELECT * FROM judicial_sync_job WHERE office_id = ? AND idempotency_key = ?').get(input.officeId, key) as JobRow
    : await database.prepare('SELECT * FROM judicial_sync_job WHERE id = ?').get(id) as JobRow;
  return { job: toJob(row), created: row.id === id };
}

/**
 * Takes the next job with a lease. A worker that dies leaves its lease to expire, and the attempt
 * it already spent stays spent, so a job that keeps killing workers eventually stops instead of
 * looping forever.
 */
export async function claimJob(now = Date.now()): Promise<{ job: SyncJob; leaseOwner: string } | undefined> {
  const owner = randomUUID();

  // A job whose lease expired with its attempts already exhausted can never be claimed again by
  // the statement below; without this it would sit in 'running' forever with nobody working it.
  // It runs on its own because it touches different rows than the claim and needs no ordering
  // with it: at worst a sweep and a claim interleave and the next call finishes the job off.
  await database.prepare(`
    UPDATE judicial_sync_job
    SET status = 'failed', lease_owner = NULL, lease_until = 0, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
        error_code = COALESCE(error_code, 'source_unavailable'),
        error_message = COALESCE(error_message, 'A coleta esgotou as tentativas sem concluir.')
    WHERE status = 'running' AND lease_until < ? AND attempts >= ?
  `).run(now, MAX_ATTEMPTS);

  // The claim is one conditional UPDATE: the sub-select picks the job and the outer WHERE
  // re-checks the same eligibility, inside a single statement. Two workers racing here cannot
  // both take the lease — the loser updates no rows and gets nothing back — and that holds
  // without the interactive transaction D1 does not offer.
  const eligible = "(status = 'queued' OR (status = 'running' AND lease_until < ?)) AND attempts < ? AND run_after <= ?";
  const row = await database.prepare(`
    UPDATE judicial_sync_job
    SET status = 'running', lease_owner = ?, lease_until = ?, attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = (
      SELECT j.id FROM judicial_sync_job j
      JOIN judicial_source_installation i ON i.id = j.installation_id
      WHERE (j.status = 'queued' OR (j.status = 'running' AND j.lease_until < ?))
        AND j.attempts < ? AND j.run_after <= ? AND i.enabled = 1
      -- Routine refreshes go first: a long backfill must not starve today's publications.
      ORDER BY CASE j.kind WHEN 'manual' THEN 0 WHEN 'refresh' THEN 1 ELSE 2 END, j.created_at
      LIMIT 1 FOR UPDATE OF j SKIP LOCKED
    )
      AND ${eligible}
    RETURNING *
  `).get<JobRow>(owner, now + LEASE_MS, now, MAX_ATTEMPTS, now, now, MAX_ATTEMPTS, now);

  // RETURNING hands back the row as it now stands, so the attempt is already counted.
  return row ? { job: toJob(row), leaseOwner: owner } : undefined;
}

/** Extends the lease of a job still making progress, so a long sweep is not stolen mid-run. */
export async function renewLease(jobId: string, leaseOwner: string, now = Date.now()): Promise<boolean> {
  return (await database.prepare(
    'UPDATE judicial_sync_job SET lease_until = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND lease_owner = ?',
  ).run(now + LEASE_MS, jobId, leaseOwner)).changes > 0;
}

/**
 * Advances the checkpoint. Only called after the data it covers is committed (section 7 step 6),
 * because a cursor saved before its records are durable is how a window gets skipped.
 */
export async function checkpointJob(
  jobId: string,
  leaseOwner: string,
  progress: { cursor: string | null; pagesFetched: number; recordsAccepted: number; recordsRejected: number },
): Promise<boolean> {
  return (await database.prepare(`
    UPDATE judicial_sync_job
    SET cursor = ?, pages_fetched = pages_fetched + ?, records_accepted = records_accepted + ?,
        records_rejected = records_rejected + ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND lease_owner = ?
  `).run(
    progress.cursor, progress.pagesFetched, progress.recordsAccepted, progress.recordsRejected,
    jobId, leaseOwner,
  )).changes > 0;
}

export async function completeJob(jobId: string, leaseOwner: string): Promise<boolean> {
  return (await database.prepare(`
    UPDATE judicial_sync_job
    SET status = 'completed', lease_owner = NULL, lease_until = 0, completed_at = CURRENT_TIMESTAMP,
        error_code = NULL, error_message = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND lease_owner = ?
  `).run(jobId, leaseOwner)).changes > 0;
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
export async function failJob(
  jobId: string,
  leaseOwner: string,
  error: { code: ConnectorErrorCode; message: string; retryAfterSeconds?: number },
  now = Date.now(),
): Promise<{ owned: boolean; retrying: boolean; terminalStatus: SyncJob['status'] }> {
  const row = await database.prepare('SELECT attempts FROM judicial_sync_job WHERE id = ? AND lease_owner = ?')
    .get(jobId, leaseOwner) as { attempts: number } | undefined;
  if (!row) return { owned: false, retrying: false, terminalStatus: 'failed' };

  const needsPerson = error.code === 'unauthorized' || error.code === 'forbidden' || error.code === 'human_action_required';
  // A changed schema is quarantined rather than failed: the raw payloads are already stored, and
  // the fix is a parser change, not another attempt.
  const quarantine = error.code === 'schema_changed';
  const retrying = !needsPerson && !quarantine && isRetryable(error.code) && row.attempts < MAX_ATTEMPTS;

  const status: SyncJob['status'] = retrying ? 'queued' : quarantine ? 'quarantined' : 'failed';
  const updated = await database.prepare(`
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
    await database.prepare(`
      UPDATE judicial_subscription SET status = 'suspended', suspended_reason = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = (SELECT subscription_id FROM judicial_sync_job WHERE id = ?) AND status = 'active'
    `).run(error.message, jobId);
  }

  return { owned: true, retrying, terminalStatus: status };
}

export async function cancelJob(officeId: string, jobId: string): Promise<boolean> {
  return (await database.prepare(`
    UPDATE judicial_sync_job
    SET status = 'cancelled', lease_owner = NULL, lease_until = 0, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND office_id = ? AND status IN ('queued','running')
  `).run(jobId, officeId)).changes > 0;
}

/**
 * Reserves one request against both budgets before it is made. The counter lives in the database
 * precisely because a per-process limiter multiplied by the number of workers is not a limit.
 */
export async function reserveRequestBudget(
  officeId: string,
  installation: { id: string; dailyRequestBudget: number; rateLimitPerMinute: number },
  now = Date.now(),
): Promise<{ allowed: true } | { allowed: false; reason: 'daily_budget' | 'rate_limit'; retryAfterMs: number }> {
  const day = new Date(now).toISOString().slice(0, 10);
  const minimumSpacingMs = Math.ceil(60_000 / installation.rateLimitPerMinute);

  // Both limits are enforced inside the upsert, so the check and the increment are one statement.
  // Reading first and writing after would let two workers both see room and both spend it, and a
  // lock held across the two is the thing D1 has no answer for. A refused reservation writes
  // nothing and returns no row; only then is the stored row read, to say which limit refused.
  const granted = await database.prepare(`
    INSERT INTO judicial_rate_budget (installation_id, office_id, day, requests, last_request_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(installation_id, office_id, day) DO UPDATE SET
      requests = judicial_rate_budget.requests + 1, last_request_at = excluded.last_request_at
    WHERE judicial_rate_budget.requests < ?
      AND excluded.last_request_at - judicial_rate_budget.last_request_at >= ?
    RETURNING requests
  `).get<{ requests: number }>(
    installation.id, officeId, day, now, installation.dailyRequestBudget, minimumSpacingMs,
  );
  if (granted) return { allowed: true };

  const row = await database.prepare(
    'SELECT requests, last_request_at FROM judicial_rate_budget WHERE installation_id = ? AND office_id = ? AND day = ?',
  ).get(installation.id, officeId, day) as { requests: number; last_request_at: number } | undefined;

  if (row && row.requests >= installation.dailyRequestBudget) {
    // Tomorrow, not in a minute: the day's allowance is spent.
    const midnight = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
    return { allowed: false, reason: 'daily_budget', retryAfterMs: Math.max(1000, midnight - now) };
  }
  const since = row ? now - row.last_request_at : minimumSpacingMs;
  return { allowed: false, reason: 'rate_limit', retryAfterMs: Math.max(1, minimumSpacingMs - since) };
}

export async function requestsUsedToday(officeId: string, installationId: string, now = Date.now()): Promise<number> {
  const day = new Date(now).toISOString().slice(0, 10);
  const row = await database.prepare(
    'SELECT requests FROM judicial_rate_budget WHERE installation_id = ? AND office_id = ? AND day = ?',
  ).get(installationId, officeId, day) as { requests: number } | undefined;
  return row?.requests ?? 0;
}
