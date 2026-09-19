import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ConnectorError, type InstallationRef } from '../contracts';

/**
 * The only way a judicial connector reaches the network. Section 8 of the plan: URLs coming from
 * a source are untrusted, so every hop is checked against the installation's approved hosts,
 * private ranges are refused, redirects are followed by hand and the body is capped.
 *
 * Two switches must both be on before a byte leaves the process: the installation has to be
 * enabled and `live_transport_enabled` has to be set. A source that has not cleared F0 cannot be
 * contacted by accident, which is why the default for both columns is 0.
 */

export type TransportResponse = {
  status: number;
  contentType: string;
  body: string;
  /** Final URL after redirects, so the snapshot records where the bytes actually came from. */
  url: string;
};

export type Transport = {
  readonly mode: 'live' | 'fixture';
  request(installation: InstallationRef, path: string, init?: TransportRequestInit): Promise<TransportResponse>;
};

export type TransportRequestInit = {
  method?: 'GET' | 'POST';
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Overrides the default cap for an operation known to return a large document. */
  maxBytes?: number;
  timeoutMs?: number;
};

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

/** Only formats a parser in this repository can actually read. */
const ALLOWED_CONTENT_TYPES = [
  'application/json', 'application/xml', 'text/xml', 'application/soap+xml',
  'text/html', 'text/plain', 'application/pdf', 'application/octet-stream',
];

export class TransportBlockedError extends ConnectorError {
  constructor(message: string) {
    super('forbidden', message);
    this.name = 'TransportBlockedError';
  }
}

/**
 * Anything that is not a routable public address. Reaching a court never requires talking to
 * loopback, link-local, or a cloud metadata endpoint, so all of them are refused outright.
 */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const octets = address.split('.').map(Number);
    const [a, b] = octets;
    if (octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return true;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local, including 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a === 192 && b === 0) return true; // IETF protocol assignments
    if (a >= 224) return true; // multicast and reserved
    return false;
  }
  if (family === 6) {
    const value = address.toLowerCase();
    if (value === '::' || value === '::1') return true;
    if (value.startsWith('fe80') || value.startsWith('fc') || value.startsWith('fd')) return true;
    // IPv4-mapped addresses carry the v4 rules with them.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true;
}

function hostAllowed(installation: InstallationRef, hostname: string): boolean {
  const host = hostname.toLowerCase();
  return installation.allowedHosts.some((entry) => {
    const allowed = entry.trim().toLowerCase();
    if (!allowed) return false;
    // A leading dot is the only wildcard: ".tjam.jus.br" covers subdomains and nothing else.
    if (allowed.startsWith('.')) return host === allowed.slice(1) || host.endsWith(allowed);
    return host === allowed;
  });
}

/**
 * Resolves the hostname and refuses the request when any answer is private. A name can still be
 * re-resolved to a different address by the time the socket opens; closing that window needs a
 * pinned-IP agent, which is a deliberate follow-up rather than something this function pretends
 * to do. The allowlist above is what keeps the blast radius to hosts an operator approved.
 */
async function assertPublicHost(hostname: string): Promise<void> {
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new TransportBlockedError('Endereço de rede interna recusado.');
    return;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new ConnectorError('source_unavailable', 'Não foi possível resolver o endereço da fonte.');
  }
  if (!addresses.length) throw new ConnectorError('source_unavailable', 'A fonte não resolveu para nenhum endereço.');
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new TransportBlockedError('A fonte resolveu para um endereço de rede interna.');
  }
}

function assertUrlAllowed(installation: InstallationRef, url: URL): void {
  if (url.protocol !== 'https:') throw new TransportBlockedError('Somente HTTPS é aceito para fontes judiciais.');
  if (!hostAllowed(installation, url.hostname)) {
    throw new TransportBlockedError(`Host não autorizado para esta instalação: ${url.hostname}`);
  }
}

function assertContentType(contentType: string): void {
  const base = contentType.split(';')[0].trim().toLowerCase();
  if (!base) return;
  if (!ALLOWED_CONTENT_TYPES.includes(base)) {
    throw new ConnectorError('schema_changed', `Tipo de conteúdo inesperado da fonte: ${base}`);
  }
}

/** Reads at most `maxBytes` and aborts rather than buffering whatever the source decided to send. */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new ConnectorError('partial', 'Resposta da fonte acima do limite configurado.');
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ConnectorError('partial', 'Resposta da fonte acima do limite configurado.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function statusToError(status: number, retryAfter: string | null): ConnectorError {
  const retrySeconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined;
  if (status === 401) return new ConnectorError('unauthorized', 'A fonte recusou a credencial.');
  if (status === 403) return new ConnectorError('forbidden', 'A fonte bloqueou o acesso.');
  if (status === 404) return new ConnectorError('not_found_in_source', 'Registro não encontrado nesta fonte.');
  if (status === 429) return new ConnectorError('rate_limited', 'Limite de requisições da fonte atingido.', retrySeconds);
  if (status >= 500) return new ConnectorError('source_unavailable', 'A fonte está indisponível.', retrySeconds);
  return new ConnectorError('schema_changed', `A fonte respondeu ${status}.`);
}

function buildUrl(base: string, path: string, query?: TransportRequestInit['query']): URL {
  const url = new URL(path, base.endsWith('/') ? base : `${base}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

export const liveTransport: Transport = {
  mode: 'live',
  async request(installation, path, init = {}) {
    if (!installation.enabled) {
      throw new ConnectorError('unsupported', 'Esta instalação não está habilitada.');
    }
    // The gate the plan asks for: documentation and permitted use are cleared by a person before
    // any real request, and until then the connector can only run against fixtures.
    if (!installation.liveTransportEnabled) {
      throw new ConnectorError('human_action_required', 'O acesso real a esta fonte ainda não foi liberado. Conclua a descoberta e habilite o transporte.');
    }
    if (!installation.baseUrl) {
      throw new ConnectorError('unsupported', 'Esta instalação não tem endereço configurado.');
    }

    const maxBytes = init.maxBytes ?? DEFAULT_MAX_BYTES;
    let url = buildUrl(installation.baseUrl, path, init.query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        assertUrlAllowed(installation, url);
        await assertPublicHost(url.hostname);

        let response: Response;
        try {
          response = await fetch(url, {
            method: init.method ?? 'GET',
            // Following by hand is the point: `redirect: 'follow'` would hand the next hop to the
            // runtime, past the allowlist and past the private-address check.
            redirect: 'manual',
            signal: controller.signal,
            headers: {
              accept: 'application/json, application/xml;q=0.9, text/plain;q=0.8',
              'user-agent': 'K5-Judicial/0.1 (+contato: suporte@k5.app)',
              ...init.headers,
            },
            body: init.body === undefined ? undefined : JSON.stringify(init.body),
          });
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            throw new ConnectorError('source_unavailable', 'A fonte não respondeu dentro do tempo limite.');
          }
          throw new ConnectorError('source_unavailable', 'Falha de rede ao contatar a fonte.');
        }

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) throw new ConnectorError('schema_changed', 'A fonte redirecionou sem destino.');
          url = new URL(location, url);
          continue;
        }

        if (!response.ok) throw statusToError(response.status, response.headers.get('retry-after'));

        const contentType = response.headers.get('content-type') ?? '';
        assertContentType(contentType);
        return { status: response.status, contentType, body: await readCapped(response, maxBytes), url: url.toString() };
      }
      throw new ConnectorError('source_unavailable', 'A fonte excedeu o número de redirecionamentos permitido.');
    } finally {
      clearTimeout(timer);
    }
  },
};

/**
 * Deterministic transport for tests, local development and every source still waiting on F0.
 * Keyed by `installationId + method + path`, so a fixture is tied to the installation it was
 * captured from and cannot be silently reused for a different court.
 */
export function fixtureTransport(
  fixtures: Map<string, { contentType?: string; body: string; status?: number }>,
): Transport {
  return {
    mode: 'fixture',
    async request(installation, path, init = {}) {
      const key = fixtureKey(installation.id, init.method ?? 'GET', path, init.query);
      const fixture = fixtures.get(key);
      if (!fixture) throw new ConnectorError('not_found_in_source', `Sem fixture para ${key}`);
      const status = fixture.status ?? 200;
      if (status >= 400) throw statusToError(status, null);
      return {
        status,
        contentType: fixture.contentType ?? 'application/json',
        body: fixture.body,
        url: `fixture://${key}`,
      };
    },
  };
}

/** Query keys are sorted so a caller reordering its arguments still hits the same fixture. */
export function fixtureKey(
  installationId: string,
  method: string,
  path: string,
  query?: TransportRequestInit['query'],
): string {
  const entries = Object.entries(query ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .sort();
  return `${installationId}|${method}|${path}${entries.length ? `?${entries.join('&')}` : ''}`;
}
