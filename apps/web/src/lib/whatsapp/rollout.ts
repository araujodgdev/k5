import { z } from 'zod';
import { whatsappEnvironment } from './environment';
import { readLimitedJson, whatsappTransport } from './transport';

const FLAG_KEY = 'whatsapp-integration';
const TIMEOUT_MS = 1_500;
const evaluation = z.object({ flagKey: z.literal(FLAG_KEY), value: z.boolean() });

export async function isWhatsAppEnabled(officeId: string): Promise<boolean> {
  if (!officeId) return false;
  const env = whatsappEnvironment();
  const context = { office_id: officeId, targetingKey: officeId };
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<false>(resolve => {
    timeout = setTimeout(() => { controller.abort(); resolve(false); }, TIMEOUT_MS);
  });
  const evaluate = async () => {
    if (env.FLAGS) return await env.FLAGS.getBooleanValue(FLAG_KEY, false, context) === true;
    if (!env.CLOUDFLARE_ACCOUNT_ID || !env.FLAGSHIP_APP_ID || !env.FLAGSHIP_EVALUATE_TOKEN) return false;
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}` +
      `/flagship/apps/${encodeURIComponent(env.FLAGSHIP_APP_ID)}/evaluate`);
    url.search = new URLSearchParams({ flagKey: FLAG_KEY, ...context }).toString();
    const response = await whatsappTransport()(url, {
      headers: { Authorization: `Bearer ${env.FLAGSHIP_EVALUATE_TOKEN}`, Accept: 'application/json' },
      signal: controller.signal, cache: 'no-store', redirect: 'manual',
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      return false;
    }
    const parsed = evaluation.safeParse(await readLimitedJson(response, 16_384));
    return parsed.success && parsed.data.value;
  };
  try {
    return await Promise.race([evaluate(), deadline]);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
