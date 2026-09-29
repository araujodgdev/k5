import { z } from 'zod';

export type FlagshipEnvironment = Partial<Record<'CLOUDFLARE_ACCOUNT_ID' | 'FLAGSHIP_APP_ID' | 'FLAGSHIP_EVALUATE_TOKEN', string>> & {
  FLAGS?: { getBooleanValue(key: string, fallback: boolean, context: Record<string, string>): Promise<boolean> };
};

export async function evaluateBooleanFlag(key: string, context: Record<string, string>, env: FlagshipEnvironment,
  fetchLike: (input: string | URL, init?: RequestInit) => Promise<Response> = globalThis.fetch): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<false>(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve(false); }, 1_500);
  });
  const evaluate = async () => {
    if (env.FLAGS) return await env.FLAGS.getBooleanValue(key, false, context) === true;
    if (!env.CLOUDFLARE_ACCOUNT_ID || !env.FLAGSHIP_APP_ID || !env.FLAGSHIP_EVALUATE_TOKEN) return false;
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/flagship/apps/${encodeURIComponent(env.FLAGSHIP_APP_ID)}/evaluate`);
    url.search = new URLSearchParams({ flagKey: key, ...context }).toString();
    const response = await fetchLike(url, { headers: { Authorization: `Bearer ${env.FLAGSHIP_EVALUATE_TOKEN}`, Accept: 'application/json' },
      cache: 'no-store', redirect: 'manual', signal: controller.signal });
    if (!response.ok || !response.body) { void response.body?.cancel().catch(() => undefined); return false; }
    const reader = response.body.getReader();
    let body = '';
    let size = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 16_384) { void reader.cancel().catch(() => undefined); return false; }
        body += decoder.decode(chunk.value, { stream: true });
      }
    } finally { reader.releaseLock(); }
    const parsed = z.object({ flagKey: z.literal(key), value: z.boolean() }).safeParse(JSON.parse(body + decoder.decode()));
    return parsed.success && parsed.data.value;
  };
  try { return await Promise.race([evaluate(), deadline]); }
  catch { return false; }
  finally { clearTimeout(timer); controller.abort(); }
}
