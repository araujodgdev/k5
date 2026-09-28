import 'server-only';
import { randomUUID } from 'node:crypto';
import { database, type Transaction } from '@/lib/database';

export type WhatsAppJobKind = 'event' | 'history' | 'history_refresh' | 'conversations' | 'disconnect' | 'revoke_key' | 'media';
export type WhatsAppJob = {
  id: string; office_id: string; connection_id: string; generation: number;
  kind: WhatsAppJobKind; subject_id: string | null; dedupe_key: string;
  attempts: number; locked_until: string;
};

const MAX_ATTEMPTS = 6;
const LEASE_MS = 120_000;

export async function enqueueWhatsAppJob(db: Transaction, input: {
  officeId: string; connectionId: string; generation: number; kind: WhatsAppJobKind;
  subjectId?: string | null; dedupeKey: string;
}) {
  const inserted = await db.prepare(`INSERT INTO whatsapp_job
    (id,office_id,connection_id,generation,kind,subject_id,dedupe_key)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING id`)
    .get<{ id: string }>(randomUUID(), input.officeId, input.connectionId, input.generation,
      input.kind, input.subjectId ?? null, input.dedupeKey);
  if (inserted) return inserted.id;
  const existing = await db.prepare(`SELECT id FROM whatsapp_job WHERE dedupe_key=?
    AND office_id=? AND connection_id=? AND status IN ('queued','running')`)
    .get<{ id: string }>(input.dedupeKey, input.officeId, input.connectionId);
  if (!existing) throw new Error('Não foi possível reservar a sincronização do WhatsApp.');
  return existing.id;
}

export async function claimWhatsAppJob(): Promise<WhatsAppJob | null> {
  await database.prepare(`UPDATE whatsapp_job j SET status='done',locked_until=NULL,
    last_error='connection_changed',updated_at=CURRENT_TIMESTAMP
    WHERE j.status IN ('queued','running') AND j.kind<>'revoke_key' AND NOT EXISTS (
      SELECT 1 FROM whatsapp_connection c WHERE c.id=j.connection_id AND c.office_id=j.office_id AND (
        (j.kind='event' AND (c.status IN ('connected','reconnect_required') OR (c.status='pending' AND c.verified_at IS NOT NULL))) OR
        (j.kind='disconnect' AND c.status='disconnecting' AND c.generation=j.generation) OR
        (j.kind IN ('history','history_refresh','conversations','media') AND c.status='connected' AND c.generation=j.generation)))`).run();
  await database.prepare(`UPDATE whatsapp_job SET status='failed',locked_until=NULL,
    last_error='attempts_exhausted',updated_at=CURRENT_TIMESTAMP
    WHERE attempts>=? AND (status='queued' OR (status='running' AND locked_until<CURRENT_TIMESTAMP))`)
    .run(MAX_ATTEMPTS);
  return await database.prepare(`UPDATE whatsapp_job SET status='running',attempts=attempts+1,
    locked_until=?,updated_at=CURRENT_TIMESTAMP WHERE id=(
      SELECT id FROM whatsapp_job WHERE available_at<=CURRENT_TIMESTAMP AND attempts<?
        AND (status='queued' OR (status='running' AND locked_until<CURRENT_TIMESTAMP))
      ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id,office_id,connection_id,generation,kind,subject_id,dedupe_key,attempts,locked_until`)
    .get<WhatsAppJob>(new Date(Date.now() + LEASE_MS).toISOString(), MAX_ATTEMPTS) ?? null;
}

export async function ownsWhatsAppJob(tx: Transaction, job: WhatsAppJob) {
  return Boolean(await tx.prepare(`SELECT 1 FROM whatsapp_job
    WHERE id=? AND status='running' AND attempts=? AND locked_until>CURRENT_TIMESTAMP FOR UPDATE`)
    .get(job.id, job.attempts));
}

export async function completeWhatsAppJob(job: WhatsAppJob, db: Transaction = database) {
  await db.prepare(`UPDATE whatsapp_job SET status='done',locked_until=NULL,last_error=NULL,
    updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='running' AND attempts=? AND locked_until>CURRENT_TIMESTAMP`)
    .run(job.id, job.attempts);
}

export async function failWhatsAppJob(job: WhatsAppJob, code: string, retry = true) {
  const dead = !retry || job.attempts >= MAX_ATTEMPTS;
  const delay = Math.min(3_600_000, 30_000 * 2 ** Math.max(0, job.attempts - 1));
  const result = await database.prepare(`UPDATE whatsapp_job SET status=?,last_error=?,available_at=?,
    locked_until=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status='running' AND attempts=? AND locked_until>CURRENT_TIMESTAMP`)
    .run(dead ? 'failed' : 'queued', code, new Date(Date.now() + delay).toISOString(), job.id, job.attempts);
  return { dead, changed: result.changes > 0 };
}
