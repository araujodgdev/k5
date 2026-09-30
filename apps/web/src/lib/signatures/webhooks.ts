import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, type Transaction } from '@/lib/database';
import { captureOperationalError } from '@/lib/observability/report';
import { reconcileSignatureWebhook } from './service';
import type { SignatureTransport } from './zapsign';

const payloadSchema = z.object({ event_type: z.string().max(40), token: z.string().uuid(), external_id: z.string().max(100), sandbox: z.boolean(),
  status: z.string().max(40), signer_who_signed: z.object({ token: z.string().uuid(), signed_at: z.string().max(64).nullable().optional() }).optional() });
const events = new Set(['doc_created','doc_signed','doc_deleted','doc_refused','doc_expired']);
type Job = { office_id: string; request_id: string; provider_token: string; event_type: string; generation: number; attempts: number; lease_token: string };

export async function acceptSignatureWebhook(request: Request) {
  const { ApiError, limitedJson } = await import('@/lib/workspace-api');
  const secret = new URL(request.url).searchParams.get('secret');
  if (!secret || !/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new ApiError(401, 'Webhook não autorizado.');
  const secretHash = createHash('sha256').update(secret).digest('hex');
  const connection = await database.prepare('SELECT office_id,environment FROM signature_connection WHERE webhook_secret_hash=?')
    .get<{ office_id: string; environment: 'sandbox' | 'production' }>(secretHash);
  if (!connection) throw new ApiError(401, 'Webhook não autorizado.');
  const body = await limitedJson(request, 512_000);
  const envelope = z.object({ event_type: z.string().max(40) }).parse(body);
  if (!events.has(envelope.event_type)) return { ok: true };
  const payload = payloadSchema.parse(body);
  const row = await database.prepare(`SELECT id FROM signature_request WHERE office_id=? AND id=? AND environment=?
    AND (provider_token IS NULL OR provider_token=?)`).get<{ id: string }>(connection.office_id, payload.external_id, payload.sandbox ? 'sandbox' : 'production', payload.token);
  if (!row || payload.sandbox !== (connection.environment === 'sandbox')) return { ok: true };
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  await database.prepare(`INSERT INTO signature_webhook_job(request_id,office_id,provider_token,event_type,payload_hash) VALUES(?,?,?,?,?)
    ON CONFLICT(request_id) DO UPDATE SET provider_token=EXCLUDED.provider_token,
      event_type=CASE WHEN EXCLUDED.event_type='doc_created' THEN signature_webhook_job.event_type ELSE EXCLUDED.event_type END,payload_hash=EXCLUDED.payload_hash,
      generation=signature_webhook_job.generation+1,state='pending',attempts=0,run_after=CURRENT_TIMESTAMP,lease_token=NULL,lease_until=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE signature_webhook_job.payload_hash<>EXCLUDED.payload_hash`).run(row.id, connection.office_id, payload.token, payload.event_type, digest);
  return { ok: true };
}

export async function processNextSignatureWebhook(transport?: SignatureTransport) {
  const lease = randomUUID();
  const job = await database.prepare(`UPDATE signature_webhook_job SET state='leased',lease_token=?,lease_until=CURRENT_TIMESTAMP+INTERVAL '3 minutes',attempts=attempts+1
    WHERE request_id=(SELECT request_id FROM signature_webhook_job WHERE (state='pending' AND run_after<=CURRENT_TIMESTAMP)
      OR (state='leased' AND lease_until<CURRENT_TIMESTAMP) ORDER BY run_after,request_id LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING office_id,request_id,provider_token,event_type,generation,attempts,lease_token`).get<Job>(lease);
  if (!job) return false;
  const guard = async (tx: Transaction) =>
    !!await tx.prepare(`SELECT 1 FROM signature_webhook_job WHERE office_id=? AND request_id=? AND generation=? AND lease_token=?
      AND state='leased' AND lease_until>CURRENT_TIMESTAMP FOR UPDATE`).get(job.office_id, job.request_id, job.generation, lease);
  const finish = async (retry: boolean, error: string | null) => database.prepare(`UPDATE signature_webhook_job SET
      state=?,run_after=CURRENT_TIMESTAMP+(? * INTERVAL '1 second'),lease_token=NULL,lease_until=NULL,last_error=?,updated_at=CURRENT_TIMESTAMP
      WHERE office_id=? AND request_id=? AND generation=? AND lease_token=? AND state='leased' AND lease_until>CURRENT_TIMESTAMP`)
    .run(retry ? job.attempts >= 8 ? 'dead' : 'pending' : 'done', Math.min(3600, 60 * 2 ** Math.min(job.attempts - 1, 6)), error,
      job.office_id, job.request_id, job.generation, lease);
  try {
    const state = await reconcileSignatureWebhook({ officeId: job.office_id, requestId: job.request_id, providerToken: job.provider_token, guard }, transport);
    const retry = job.event_type !== 'doc_created' && !['signed','cancelled'].includes(state);
    await finish(retry, retry ? 'awaiting_provider' : null);
  } catch (error) {
    const result = await finish(true, 'provider_unavailable');
    if (result.changes && job.attempts >= 8) captureOperationalError(error, 'signatures.webhook.reconcile');
  }
  return true;
}
