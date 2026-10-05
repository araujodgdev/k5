import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import type { AsaasAccount, AsaasEnvironment } from './contracts';

/**
 * `kind` tells callers what the failure means for a write: `rejected` and `unauthorized` mean
 * Asaas refused it, `unavailable` means the request may or may not have taken effect.
 */
export class AsaasProviderError extends Error {
  constructor(readonly status: number, message: string, readonly kind: 'rejected' | 'unauthorized' | 'unavailable', readonly upstream?: number) { super(message); }
}
type AsaasFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
const transport = new AsyncLocalStorage<AsaasFetch>();
export function withAsaasTransport<T>(fetchLike: AsaasFetch, action: () => T): T { return transport.run(fetchLike, action); }

const baseUrls: Record<AsaasEnvironment, string> = {
  production: 'https://api.asaas.com/v3', sandbox: 'https://api-sandbox.asaas.com/v3',
};
const MAX_BODY = 262_144;
const TIMEOUT_MS = 15_000;

/** Keys issued since 2025 name their environment; older ones are tried in production first. */
export function environmentsForKey(key: string): AsaasEnvironment[] {
  if (key.startsWith('$aact_prod_')) return ['production'];
  if (key.startsWith('$aact_hmlg_')) return ['sandbox'];
  return ['production', 'sandbox'];
}

const asaasErrors = z.object({ errors: z.array(z.object({ description: z.string().max(1_000) })).min(1) });

async function readBounded(response: Response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY) { void reader.cancel().catch(() => undefined); throw new AsaasProviderError(502, 'O Asaas retornou uma resposta inválida.', 'unavailable'); }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally { reader.releaseLock(); }
  return text + decoder.decode();
}

function failure(status: number, text: string): AsaasProviderError {
  if (status === 401) return new AsaasProviderError(422, 'O Asaas não aceitou a chave. Confira se ela foi copiada completa, começando por $aact_.', 'unauthorized');
  if (status === 403) return new AsaasProviderError(422, 'O Asaas recusou a operação para esta chave. Confira as permissões da chave e os IPs autorizados na conta.', 'rejected');
  if (status === 429) return new AsaasProviderError(429, 'O Asaas limitou as consultas. Aguarde um instante e tente novamente.', 'rejected');
  if (status >= 400 && status < 500) {
    let parsed: z.infer<typeof asaasErrors> | undefined;
    try { parsed = asaasErrors.safeParse(JSON.parse(text)).data; } catch { parsed = undefined; }
    // Asaas writes these validation messages in Portuguese for the account holder (CPF inválido, data no passado…).
    const detail = parsed?.errors.map(error => error.description.trim()).filter(Boolean).join(' ').slice(0, 300);
    return new AsaasProviderError(422, detail ? `O Asaas recusou a solicitação: ${detail}` : 'O Asaas recusou a solicitação. Confira os dados e tente novamente.', 'rejected', status);
  }
  return new AsaasProviderError(502, 'O Asaas não respondeu como esperado. Tente novamente em instantes.', 'unavailable');
}

export async function asaasRequest<T extends z.ZodType>(environment: AsaasEnvironment, apiKey: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string, schema: T, body?: unknown): Promise<z.output<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new AsaasProviderError(504, 'O Asaas demorou para responder. Tente novamente.', 'unavailable')); }, TIMEOUT_MS);
  });
  const request = async () => {
    const response = await (transport.getStore() ?? globalThis.fetch)(`${baseUrls[environment]}${path}`, {
      method, cache: 'no-store', redirect: 'manual', signal: controller.signal,
      headers: { access_token: apiKey, Accept: 'application/json', 'User-Agent': 'Lume/1.0 (lume.software)', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await readBounded(response);
    if (!response.ok) throw failure(response.status, text);
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new AsaasProviderError(502, 'O Asaas retornou uma resposta inválida.', 'unavailable'); }
    const result = schema.safeParse(value);
    if (!result.success) throw new AsaasProviderError(502, 'O Asaas não retornou os dados esperados.', 'unavailable');
    return result.data;
  };
  try { return await Promise.race([request(), deadline]); }
  catch (error) {
    if (error instanceof AsaasProviderError) throw error;
    throw new AsaasProviderError(502, 'Não foi possível falar com o Asaas. Tente novamente.', 'unavailable');
  } finally { clearTimeout(timer); controller.abort(); }
}

const commercialInfo = z.object({
  name: z.string().max(500).nullish(), companyName: z.string().max(500).nullish(), email: z.string().max(320).nullish(),
  cpfCnpj: z.string().max(40).nullish(), personType: z.string().max(40).nullish(), status: z.string().max(60).nullish(),
});
const wallets = z.object({ data: z.array(z.object({ id: z.string().min(1).max(100) })).min(1) });

function maskDocument(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, '') ?? '';
  if (digits.length === 11) return `***.***.${digits.slice(6, 9)}-${digits.slice(9)}`;
  if (digits.length === 14) return `**.***.***/${digits.slice(8, 12)}-${digits.slice(12)}`;
  return null;
}

export type VerifiedAsaasAccount = { environment: AsaasEnvironment; walletId: string; account: AsaasAccount };

/** Reads the account behind a key. A key without an environment prefix falls back to the sandbox once. */
export async function verifyAsaasAccount(apiKey: string): Promise<VerifiedAsaasAccount> {
  const candidates = environmentsForKey(apiKey);
  for (const [index, environment] of candidates.entries()) {
    try {
      const [info, wallet] = await Promise.all([
        asaasRequest(environment, apiKey, 'GET', '/myAccount/commercialInfo/', commercialInfo),
        asaasRequest(environment, apiKey, 'GET', '/wallets/', wallets),
      ]);
      const name = info.companyName?.trim() || info.name?.trim() || 'Conta Asaas';
      return { environment, walletId: wallet.data[0].id, account: {
        name: name.slice(0, 500), email: info.email?.trim() || null, document: maskDocument(info.cpfCnpj),
        personType: info.personType ?? null, status: info.status ?? null,
      } };
    } catch (error) {
      if (error instanceof AsaasProviderError && error.kind === 'unauthorized' && index < candidates.length - 1) continue;
      throw error;
    }
  }
  throw new AsaasProviderError(422, 'O Asaas não aceitou a chave.', 'unauthorized');
}
