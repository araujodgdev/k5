import { AsyncLocalStorage } from 'node:async_hooks';
import type { z } from 'zod';

export type WhatsAppFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
type ZernioErrorCode =
  | 'not_configured' | 'invalid_request' | 'network_error' | 'timeout'
  | 'response_too_large' | 'invalid_response' | 'redirect' | 'unauthorized'
  | 'forbidden' | 'not_found' | 'rate_limited' | 'conflict' | 'http_error'
  | 'account_mismatch' | 'partial_response' | 'unsafe_auth_url' | 'key_scope_mismatch';

export class ZernioError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: ZernioErrorCode,
    readonly isAmbiguous = status !== null && status >= 500,
  ) {
    super('Não foi possível concluir a operação com o WhatsApp.');
    this.name = 'ZernioError';
  }
}

const transport = new AsyncLocalStorage<WhatsAppFetch>();
const API_BASE = 'https://zernio.com/api/v1';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_048_576;

export function withWhatsAppTransport<T>(fetchLike: WhatsAppFetch, action: () => T): T {
  return transport.run(fetchLike, action);
}

export function whatsappTransport(): WhatsAppFetch {
  return transport.getStore() ?? globalThis.fetch;
}

export async function readLimitedJson(response: Response, maxBytes: number): Promise<unknown> {
  const oversized = () => new ZernioError(response.status, 'response_too_large', response.ok);
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw oversized();
  }
  if (!response.body) throw new ZernioError(response.status, 'invalid_response', response.ok);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw oversized();
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return value;
  } catch {
    throw new ZernioError(response.status, 'invalid_response', response.ok);
  }
}

function httpError(status: number) {
  switch (status) {
    case 401: return new ZernioError(status, 'unauthorized');
    case 403: return new ZernioError(status, 'forbidden');
    case 404: return new ZernioError(status, 'not_found');
    case 409: return new ZernioError(status, 'conflict');
    case 429: return new ZernioError(status, 'rate_limited');
    default: return new ZernioError(status, 'http_error');
  }
}

export async function zernioRequest<T>(key: string, path: string, options: {
  method?: 'GET' | 'POST' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  schema: z.ZodType<T>;
}): Promise<T> {
  if (!key || /[^\x21-\x7e]/.test(key) || !path.startsWith('/') || path.startsWith('//') || /[\\?#]/.test(path)) {
    throw new ZernioError(null, 'invalid_request');
  }
  const url = new URL(`${API_BASE}${path}`);
  if (url.origin !== 'https://zernio.com' || !url.pathname.startsWith('/api/v1/')) {
    throw new ZernioError(null, 'invalid_request');
  }
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }
  const headers = new Headers({ Authorization: `Bearer ${key}`, Accept: 'application/json' });
  if (options.idempotencyKey !== undefined) {
    if (!options.idempotencyKey || options.idempotencyKey.length > 255 || /[^\x21-\x7e]/.test(options.idempotencyKey)) {
      throw new ZernioError(null, 'invalid_request');
    }
    headers.set('Idempotency-Key', options.idempotencyKey);
  }
  let body: string | undefined;
  if (options.body !== undefined) {
    try { body = JSON.stringify(options.body); }
    catch { throw new ZernioError(null, 'invalid_request'); }
    headers.set('Content-Type', 'application/json');
  }

  const controller = new AbortController();
  const fetchLike = whatsappTransport();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new ZernioError(null, 'timeout', true));
    }, REQUEST_TIMEOUT_MS);
  });
  const request = async () => {
    const response = await fetchLike(url, {
      method: options.method ?? 'GET', headers, body, cache: 'no-store',
      redirect: 'manual', signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => undefined);
      throw new ZernioError(response.status, 'redirect');
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw httpError(response.status);
    }
    const parsed = options.schema.safeParse(await readLimitedJson(response, MAX_RESPONSE_BYTES));
    if (!parsed.success) throw new ZernioError(response.status, 'invalid_response', true);
    return parsed.data;
  };
  try {
    return await Promise.race([request(), deadline]);
  } catch (error) {
    if (error instanceof ZernioError) throw error;
    throw new ZernioError(null, controller.signal.aborted ? 'timeout' : 'network_error', true);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
