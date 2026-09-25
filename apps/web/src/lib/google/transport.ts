/**
 * The only way this application talks to Google. Hosts are a fixed map, paths are built by the
 * module code, and no caller (the agent included) can supply a URL. Tests replace the transport
 * with a simulated Google; nothing else can.
 */
export const googleHosts = {
  oauth: 'https://oauth2.googleapis.com',
  accounts: 'https://accounts.google.com',
  gmail: 'https://gmail.googleapis.com',
  calendar: 'https://www.googleapis.com/calendar/v3',
  drive: 'https://www.googleapis.com/drive/v3',
  upload: 'https://www.googleapis.com/upload/drive/v3',
  docs: 'https://docs.googleapis.com',
} as const;
export type GoogleService = keyof typeof googleHosts;

export type TransportRequest = {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs: number;
  maxBytes: number;
};
export type TransportResponse = { status: number; headers: Headers; body: Uint8Array };
export interface GoogleTransport { request(request: TransportRequest): Promise<TransportResponse> }

/** Thrown when the request may or may not have reached Google (timeout, reset). */
export class GoogleNetworkError extends Error {
  constructor(public readonly phase: 'connect' | 'response', message = 'Google não respondeu a tempo.', options?: ErrorOptions) { super(message, options); }
}

export class GoogleApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly reason: string,
    message: string,
  ) { super(message); }
  get retryable() { return this.status === 429 || this.status >= 500; }
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) { await response.body?.cancel(); throw new GoogleApiError(413, 'too_large', 'O arquivo excede o limite permitido.'); }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new GoogleApiError(413, 'too_large', 'O arquivo excede o limite permitido.'); }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

export const fetchTransport: GoogleTransport = {
  async request(request) {
    const allowed = Object.values(googleHosts).some(host => request.url === host || request.url.startsWith(`${host}/`) || request.url.startsWith(`${host}?`));
    if (!allowed) throw new Error('Destino Google não permitido.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    let response: Response;
    try {
      response = await fetch(request.url, {
        method: request.method, headers: request.headers,
        // Workers reject redirect: 'error' before sending; 'manual' plus the check below never follows.
        body: request.body as BodyInit | undefined, signal: controller.signal, redirect: 'manual',
      });
    } catch (error) {
      clearTimeout(timer);
      // The request may have been delivered; callers of writes treat this as an unknown outcome.
      throw new GoogleNetworkError('connect', undefined, { cause: error });
    }
    if (response.status >= 300 && response.status < 400) {
      clearTimeout(timer);
      await response.body?.cancel();
      throw new GoogleApiError(response.status, 'redirect', `Google recusou a operação (${response.status}).`);
    }
    try { return { status: response.status, headers: response.headers, body: await readLimited(response, request.maxBytes) }; }
    catch (error) {
      if (error instanceof GoogleApiError) throw error;
      throw new GoogleNetworkError('response', undefined, { cause: error });
    } finally { clearTimeout(timer); }
  },
};

const holder = globalThis as typeof globalThis & { k5GoogleTransport?: GoogleTransport };
export function googleTransport(): GoogleTransport { return holder.k5GoogleTransport ?? fetchTransport; }
/** Test seam. Production code never calls this. */
export function setGoogleTransport(transport: GoogleTransport | undefined) { holder.k5GoogleTransport = transport; }

export function decodeJson<T>(body: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(body)) as T;
}

/** Google error bodies can echo request data; only the status and the machine reason are kept. */
export function apiErrorFrom(response: TransportResponse): GoogleApiError {
  let reason = `http_${response.status}`;
  try {
    const value = decodeJson<{ error?: { errors?: { reason?: string }[]; status?: string } | string }>(response.body);
    if (typeof value.error === 'string') reason = value.error;
    else reason = value.error?.errors?.[0]?.reason ?? value.error?.status ?? reason;
  } catch { /* not JSON */ }
  return new GoogleApiError(response.status, String(reason).slice(0, 80), `Google recusou a operação (${response.status}).`);
}
