import { verifyWebhook } from '@/lib/billing/abacatepay';
import { billingSettings, handleBillingWebhook } from '@/lib/billing/office-billing';

const MAX_BODY = 64_000;

/**
 * AbacatePay's webhook, registered as `/api/billing/webhook?webhookSecret=<ABACATEPAY_WEBHOOK_SECRET>`.
 * The secret and the HMAC signature are checked on the raw body before anything is read. A 2xx
 * tells AbacatePay the delivery is done; a failure answers 500 so it retries with the same id.
 */
export async function POST(request: Request) {
  const { webhookSecret } = billingSettings();
  if (!webhookSecret) return new Response(null, { status: 404 });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return new Response(null, { status: 413 });
  const url = new URL(request.url);
  if (!verifyWebhook(raw, request.headers.get('x-webhook-signature'), url.searchParams.get('webhookSecret'), webhookSecret)) {
    return new Response(null, { status: 401 });
  }
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
  try {
    await handleBillingWebhook(payload as Parameters<typeof handleBillingWebhook>[0]);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('[billing] webhook não processado', error instanceof Error ? error.name : typeof error);
    return new Response(null, { status: 500 });
  }
}
