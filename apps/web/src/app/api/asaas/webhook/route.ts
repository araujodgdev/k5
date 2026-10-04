import { captureOperationalError } from '@/lib/observability/report';
import { handleAsaasWebhook } from '@/lib/asaas/webhooks';

export const runtime = 'nodejs';
const MAX_BODY = 512_000;

/**
 * The webhook each connected office's Asaas account calls. The `asaas-access-token` header names the
 * office; an unknown token answers 401. Asaas retries anything but a 2xx and interrupts the queue
 * after 15 failures in a row, so only a database failure answers 500.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return new Response(null, { status: 413 });
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { body = null; }
  try {
    const accepted = await handleAsaasWebhook(request.headers.get('asaas-access-token'), body);
    return new Response(null, { status: accepted ? 200 : 401, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    captureOperationalError(error, 'asaas.webhook');
    return new Response(null, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
