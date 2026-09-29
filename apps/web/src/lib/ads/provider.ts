import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { adsAccount } from './contracts';

export class AdsProviderError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
type AdsFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
const transport = new AsyncLocalStorage<AdsFetch>();
export function withAdsTransport<T>(fetchLike: AdsFetch, action: () => T): T { return transport.run(fetchLike, action); }

export async function verifyAdsAccount(key: string) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new AdsProviderError(504, 'A OpenAI demorou para responder. Tente verificar a conta novamente.')); }, 10_000);
  });
  const request = async () => {
    const response = await (transport.getStore() ?? globalThis.fetch)('https://api.ads.openai.com/v1/ad_account', {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      cache: 'no-store', redirect: 'manual', signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      void response.body?.cancel().catch(() => undefined);
      if (response.status === 401 || response.status === 403) throw new AdsProviderError(422, 'A chave não tem acesso à Ads API. Confira a conta e a chave no OpenAI Ads.');
      if (response.status === 429) throw new AdsProviderError(429, 'O limite de consultas da OpenAI foi atingido. Aguarde antes de tentar novamente.');
      throw new AdsProviderError(502, 'Não foi possível consultar a OpenAI Ads. Tente novamente.');
    }
    const reader = response.body.getReader();
    let size = 0;
    let body = '';
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 65_536) { void reader.cancel().catch(() => undefined); throw new AdsProviderError(502, 'A OpenAI retornou uma resposta inválida.'); }
        body += decoder.decode(chunk.value, { stream: true });
      }
    } finally { reader.releaseLock(); }
    const value: unknown = JSON.parse(body + decoder.decode());
    const result = adsAccount.safeParse(value);
    if (!result.success) throw new AdsProviderError(502, 'A OpenAI não retornou os dados necessários para verificar a conta.');
    return result.data;
  };
  try { return await Promise.race([request(), deadline]); }
  catch (error) {
    if (error instanceof AdsProviderError) throw error;
    throw new AdsProviderError(502, 'Não foi possível consultar a OpenAI Ads. Tente novamente.');
  } finally { clearTimeout(timer); controller.abort(); }
}
