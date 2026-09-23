import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import type { InstallationRef } from '@/lib/judicial/contracts';
import { ResearchError } from './contracts';

export type ResearchJobRow = {
  id: string; office_id: string; user_id: string; search_id: string | null; page_id: string | null;
  installation_id: string; material_id: string | null; kind: 'search_page' | 'fetch_material' | 'extract_material' | 'stj_resource';
  request_json: string; status: string; attempts: number; lease_owner: string | null; lease_until: number;
  run_after: number; error_code: string | null;
};
const MAX_ATTEMPTS = 5;
const LEASE_MS = 90_000;

export async function enqueueResearchJob(input: {
  officeId: string; userId: string; searchId?: string | null; pageId?: string | null;
  installationId: string; materialId?: string | null; kind: ResearchJobRow['kind']; request?: unknown; idempotencyKey: string;
}): Promise<string> {
  const id = randomUUID();
  await database.prepare(`INSERT INTO research_job
    (id,office_id,user_id,search_id,page_id,installation_id,material_id,kind,request_json,idempotency_key)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(office_id,user_id,idempotency_key) DO NOTHING`)
    .run(id,input.officeId,input.userId,input.searchId ?? null,input.pageId ?? null,input.installationId,
      input.materialId ?? null,input.kind,JSON.stringify(input.request ?? {}),input.idempotencyKey);
  const existing = await database.prepare(`SELECT id FROM research_job WHERE office_id=? AND user_id=? AND idempotency_key=?`)
    .get<{ id: string }>(input.officeId,input.userId,input.idempotencyKey);
  if (!existing) throw new Error('Falha ao enfileirar pesquisa.');
  return existing.id;
}

export async function claimResearchJob(workerId: string, kinds: ResearchJobRow['kind'][]): Promise<ResearchJobRow | null> {
  const now = Date.now();
  await database.prepare(`UPDATE research_job SET status='failed',error_code='lease_exhausted',
    lease_owner=NULL,lease_until=0,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE status='running' AND lease_until<? AND attempts>=?`).run(now,MAX_ATTEMPTS);
  await database.prepare(`UPDATE research_search_page SET status='partial',source_error='lease_exhausted',
    updated_at=CURRENT_TIMESTAMP WHERE id IN
      (SELECT page_id FROM research_job WHERE kind='search_page' AND status='failed' AND error_code='lease_exhausted')
    AND NOT EXISTS (SELECT 1 FROM research_job active WHERE active.page_id=research_search_page.id
      AND active.kind='search_page' AND active.status IN ('queued','running'))`).run();
  const placeholders = kinds.map(() => '?').join(',');
  const row = await database.prepare(`UPDATE research_job SET status='running',attempts=attempts+1,
    lease_owner=?,lease_until=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=(SELECT id FROM research_job WHERE kind IN (${placeholders}) AND attempts<?
      AND ((status='queued' AND run_after<=?) OR (status='running' AND lease_until<?))
      ORDER BY CASE kind WHEN 'search_page' THEN 0 WHEN 'fetch_material' THEN 1 WHEN 'stj_resource' THEN 2 ELSE 3 END,
        created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING *`).get<ResearchJobRow>(workerId,now+LEASE_MS,...kinds,MAX_ATTEMPTS,now,now);
  return row ?? null;
}
export async function renewResearchLease(job: ResearchJobRow, workerId: string): Promise<boolean> {
  const now = Date.now();
  const result = await database.prepare(`UPDATE research_job SET lease_until=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status='running' AND lease_owner=? AND lease_until>?`).run(now+LEASE_MS,job.id,workerId,now);
  return result.changes === 1;
}
export async function assertResearchLease(job: ResearchJobRow, workerId: string): Promise<void> {
  const current = await database.prepare(`SELECT 1 FROM research_job WHERE id=? AND status='running'
    AND lease_owner=? AND lease_until>?`).get(job.id,workerId,Date.now());
  if (!current) throw new ResearchError('forbidden','Lease da pesquisa expirado ou assumido por outro worker.');
}
export async function completeResearchJob(job: ResearchJobRow, workerId: string): Promise<void> {
  const now = Date.now();
  await database.prepare(`UPDATE research_job SET status='completed',lease_owner=NULL,lease_until=0,
    completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status='running' AND lease_owner=? AND lease_until>?`).run(job.id,workerId,now);
}
export async function deferResearchJob(job: ResearchJobRow, workerId: string, reason: string, waitMs: number): Promise<void> {
  const now = Date.now();
  await database.prepare(`UPDATE research_job SET status='queued',attempts=CASE WHEN attempts>0 THEN attempts-1 ELSE 0 END,
    lease_owner=NULL,lease_until=0,run_after=?,error_code=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status='running' AND lease_owner=? AND lease_until>?`).run(now+waitMs,reason,job.id,workerId,now);
}
export async function failResearchJob(job: ResearchJobRow, workerId: string, code: string, retryable: boolean, retryAfterMs?: number): Promise<void> {
  const now = Date.now();
  const retry = retryable && job.attempts < MAX_ATTEMPTS;
  const backoff = Math.max(retryAfterMs ?? 0, Math.min(15*60_000, 2 ** job.attempts * 1000));
  await database.prepare(`UPDATE research_job SET status=?,lease_owner=NULL,lease_until=0,
    run_after=?,error_code=?,updated_at=CURRENT_TIMESTAMP,completed_at=CASE WHEN ?='failed' THEN CURRENT_TIMESTAMP ELSE completed_at END
    WHERE id=? AND status='running' AND lease_owner=? AND lease_until>?`)
    .run(retry ? 'queued' : 'failed',retry ? now+backoff : 0,code,retry ? 'queued' : 'failed',job.id,workerId,now);
}

/** All three counters change in one batch; CHECK(max_count) aborts the whole debit on a limit. */
export async function debitResearchRequest(installation: InstallationRef, officeId: string): Promise<void> {
  const now = Date.now();
  const minute = Math.floor(now / 60_000) * 60_000;
  const day = Math.floor(now / 86_400_000) * 86_400_000;
  const officeLimit = Math.max(1,Math.min(100,Math.floor(installation.dailyRequestBudget / 5)));
  const sql = `INSERT INTO research_source_budget
    (installation_id,office_id,window_kind,period_start,request_count,max_count)
    VALUES(?,?,?,?,1,?) ON CONFLICT(installation_id,office_id,window_kind,period_start)
    DO UPDATE SET request_count=research_source_budget.request_count+1,max_count=excluded.max_count`;
  try {
    await database.batch([
      database.prepare(sql).bind(installation.id,'','minute',minute,installation.rateLimitPerMinute),
      database.prepare(sql).bind(installation.id,'','day',day,installation.dailyRequestBudget),
      database.prepare(sql).bind(installation.id,officeId,'day',day,officeLimit),
    ]);
  } catch (error) {
    if (!/constraint|check/i.test(error instanceof Error ? error.message : String(error))) throw error;
    throw new ResearchError('budget_exceeded', 'Limite de consultas da fonte atingido.');
  }
}

/** One globally reserved download per material and at most two in flight per installation. */
export async function claimResearchMaterial(materialId: string, installationId: string, workerId: string): Promise<boolean> {
  const now = Date.now();
  const result = await database.prepare(`INSERT INTO research_material_claim(material_id,lease_owner,lease_until)
    SELECT ?,?,? WHERE
      (SELECT COUNT(*) FROM research_material_claim c
        JOIN research_material m ON m.id=c.material_id
        JOIN research_judgment j ON j.id=m.judgment_id
        WHERE j.installation_id=? AND c.lease_until>?) < 2
    ON CONFLICT(material_id) DO UPDATE SET lease_owner=excluded.lease_owner,
      lease_until=excluded.lease_until,updated_at=CURRENT_TIMESTAMP
      WHERE research_material_claim.lease_until<?`)
    .run(materialId,workerId,now+LEASE_MS,installationId,now,now);
  return result.changes === 1;
}
export async function releaseResearchMaterial(materialId: string, workerId: string): Promise<void> {
  await database.prepare('DELETE FROM research_material_claim WHERE material_id=? AND lease_owner=?').run(materialId,workerId);
}
export async function cancelPendingResearchDownloads(officeId: string, userId: string, searchId: string): Promise<number> {
  const result = await database.prepare(`UPDATE research_job SET status='cancelled',completed_at=CURRENT_TIMESTAMP,
    updated_at=CURRENT_TIMESTAMP WHERE office_id=? AND user_id=? AND search_id=? AND kind IN ('fetch_material','extract_material') AND status='queued'`)
    .run(officeId,userId,searchId);
  return result.changes;
}
