import type { Database } from './db/types';

/** Cheap queue inspection keeps idle OCR containers asleep. Claiming remains in each processor. */
export async function dueProcessors(db: Database, now: number, maintenance: boolean) {
  const row = await db.prepare(`SELECT
    (? OR
      EXISTS(SELECT 1 FROM vault_document WHERE deleted_at IS NULL AND
        (status='queued' OR (status='processing' AND lease_expires_at<CURRENT_TIMESTAMP))) OR
      EXISTS(SELECT 1 FROM knowledge_index_job WHERE status='queued' OR (status='running' AND lease_until<?)) OR
      EXISTS(SELECT 1 FROM ai_run WHERE status='queued' OR (status='running' AND lease_until<?)) OR
      EXISTS(SELECT 1 FROM artifact_verification WHERE status='queued' OR (status='running' AND lease_until<?)) OR
      EXISTS(SELECT 1 FROM research_case_assessment WHERE status='queued' OR (status='running' AND lease_until<?)) OR
      EXISTS(SELECT 1 FROM vault_deletion_queue WHERE completed_at IS NULL AND attempts<5) OR
      EXISTS(SELECT 1 FROM research_job WHERE kind='extract_material' AND
        ((status='queued' AND run_after<=?) OR (status='running' AND lease_until<?)))
    ) AS documents,
    (EXISTS(SELECT 1 FROM judicial_subscription WHERE status='active' AND next_run_at<=?) OR
      EXISTS(SELECT 1 FROM judicial_sync_job WHERE
        (status='queued' AND run_after<=?) OR (status='running' AND lease_until<?)) OR
      EXISTS(SELECT 1 FROM research_job WHERE kind<>'extract_material' AND
        ((status='queued' AND run_after<=?) OR (status='running' AND lease_until<?)))
    ) AS judicial`).get<{ documents: boolean; judicial: boolean }>(maintenance, now, now, now, now, now, now, now, now, now, now, now);
  return row ?? { documents: false, judicial: false };
}
