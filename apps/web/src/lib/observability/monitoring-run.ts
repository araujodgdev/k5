import type { Database } from '../db/types';

export type MonitoringRunName = 'queues' | 'journeys';

export async function claimMonitoringRun(db: Database, name: MonitoringRunName, now = Date.now()) {
  const token = crypto.randomUUID();
  const row = await db.prepare(`INSERT INTO monitoring_run(name,lease_token,lease_until,started_at,status)
    VALUES(?,?,?,?, 'running') ON CONFLICT(name) DO UPDATE SET
    lease_token=excluded.lease_token,lease_until=excluded.lease_until,started_at=excluded.started_at,status='running'
    WHERE monitoring_run.lease_until IS NULL OR monitoring_run.lease_until<? RETURNING lease_token`)
    .get<{ lease_token: string }>(name, token, new Date(now + 7 * 60_000).toISOString(), new Date(now).toISOString(), new Date(now).toISOString());
  return row?.lease_token;
}

export async function finishMonitoringRun(db: Database, name: MonitoringRunName, token: string, status: 'ok' | 'error', result: unknown) {
  return db.prepare(`UPDATE monitoring_run SET lease_token=NULL,lease_until=NULL,finished_at=CURRENT_TIMESTAMP,
    last_success_at=CASE WHEN ?='ok' THEN CURRENT_TIMESTAMP ELSE last_success_at END,status=?,result_json=?::jsonb
    WHERE name=? AND lease_token=?`).run(status, status, JSON.stringify(result), name, token);
}
