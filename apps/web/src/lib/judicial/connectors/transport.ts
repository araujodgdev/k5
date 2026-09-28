import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
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
  /** Original bytes, populated by binary requests without a UTF-8 round trip. */
  bytes?: Buffer;
};

export type Transport = {
  readonly mode: 'live' | 'fixture';
  request(installation: InstallationRef, path: string, init?: TransportRequestInit): Promise<TransportResponse>;
  requestBinary?(installation: InstallationRef, path: string, init?: TransportRequestInit): Promise<TransportResponse & { bytes: Buffer }>;
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

function isPrivateIPv4(clean: string): boolean {
  const octets = clean.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16.0.0/12
  if (a === 192 && b === 168) return true; // private 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments 192.0.0.0/24
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1 192.0.2.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18.0.0/15
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2 198.51.100.0/24
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3 203.0.113.0/24
  if (a >= 224) return true; // multicast 224.0.0.0/4 and reserved 240.0.0.0/4
  return false;
}

function parseIpv6Hextets(clean: string): number[] | null {
  const zoneIndex = clean.indexOf('%');
  let normalized = (zoneIndex >= 0 ? clean.slice(0, zoneIndex) : clean).toLowerCase();

  const lastColon = normalized.lastIndexOf(':');
  if (lastColon >= 0) {
    const tail = normalized.slice(lastColon + 1);
    if (tail.includes('.')) {
      const parts = tail.split('.').map(Number);
      if (parts.length === 4 && parts.every((p) => !Number.isNaN(p) && p >= 0 && p <= 255)) {
        const h1 = (((parts[0] << 8) | parts[1]) >>> 0).toString(16);
        const h2 = (((parts[2] << 8) | parts[3]) >>> 0).toString(16);
        normalized = normalized.slice(0, lastColon) + ':' + h1 + ':' + h2;
      } else {
        return null;
      }
    }
  }

  const halves = normalized.split('::');
  if (halves.length > 2) return null;

  const left = halves[0] ? halves[0].split(':').map((h) => parseInt(h, 16)) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').map((h) => parseInt(h, 16)) : [];

  if (left.some(Number.isNaN) || right.some(Number.isNaN)) return null;

  if (halves.length === 2) {
    const fill = 8 - (left.length + right.length);
    if (fill < 0) return null;
    return [...left, ...new Array(fill).fill(0), ...right];
  }
  if (left.length !== 8) return null;
  return left;
}

/**
 * Anything that is not a routable public address. Reaching a court never requires talking to
 * loopback, link-local, or a cloud metadata endpoint, so all of them are refused outright.
 */
export function isPrivateAddress(address: string): boolean {
  const clean = address.replace(/^\[|\]$/g, '');
  const family = isIP(clean);
  if (family === 4) {
    return isPrivateIPv4(clean);
  }
  if (family === 6) {
    const hextets = parseIpv6Hextets(clean);
    if (!hextets) return true;

    // Unspecified (::)
    if (hextets.every((h) => h === 0)) return true;
    // Loopback (::1)
    if (hextets.slice(0, 7).every((h) => h === 0) && hextets[7] === 1) return true;

    const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets;

    // IPv4-mapped (::ffff:0:0/96), IPv4-compatible (::/96), or SIIT (::ffff:0:0:0/96)
    const isIpv4Mapped = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff;
    const isIpv4Compatible = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0;
    const isIpv4Translated = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0xffff && h5 === 0;
    if (isIpv4Mapped || isIpv4Compatible || isIpv4Translated) {
      const ipv4Str = [(h6 >> 8) & 0xff, h6 & 0xff, (h7 >> 8) & 0xff, h7 & 0xff].join('.');
      return isPrivateIPv4(ipv4Str);
    }

    // IPv6 link-local fe80::/10 (fe80 through febf)
    if ((h0 & 0xffc0) === 0xfe80) return true;
    // IPv6 unique-local fc00::/7 (fc00 through fdff)
    if ((h0 & 0xfe00) === 0xfc00) return true;
    // IPv6 multicast ff00::/8
    if ((h0 & 0xff00) === 0xff00) return true;
    // IPv6 site-local deprecated fec0::/10
    if ((h0 & 0xffc0) === 0xfec0) return true;
    // Documentation 2001:db8::/32
    if (h0 === 0x2001 && h1 === 0x0db8) return true;
    // Discard prefix 100::/64
    if (h0 === 0x0100 && h1 === 0 && h2 === 0 && h3 === 0) return true;

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
 * Resolves the hostname and refuses the request when any answer is private. Returns the
 * validated public address so the socket is pinned directly to it, eliminating DNS rebinding.
 */
async function assertPublicHost(hostname: string): Promise<string> {
  const clean = hostname.replace(/^\[|\]$/g, '');
  if (isIP(clean)) {
    if (isPrivateAddress(clean)) throw new TransportBlockedError('Endereço de rede interna recusado.');
    return clean;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(clean, { all: true });
  } catch {
    throw new ConnectorError('source_unavailable', 'Não foi possível resolver o endereço da fonte.');
  }
  if (!addresses.length) throw new ConnectorError('source_unavailable', 'A fonte não resolveu para nenhum endereço.');
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new TransportBlockedError('A fonte resolveu para um endereço de rede interna.');
  }
  return addresses[0].address;
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

function executeHttpsRequest(
  url: URL,
  validatedIp: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
    maxBytes: number;
  },
): Promise<{ status: number; headers: IncomingHttpHeaders; bytes: Buffer }> {
  return new Promise((resolve, reject) => {
    const rawHostname = url.hostname.replace(/^\[|\]$/g, '');
    const isIpHost = Boolean(isIP(rawHostname));
    const ipFamily = isIP(validatedIp);

    const req = https.request({
      protocol: 'https:',
      hostname: rawHostname,
      port: url.port ? Number(url.port) : 443,
      path: `${url.pathname}${url.search}`,
      method: options.method,
      headers: {
        host: url.host,
        accept: 'application/json, application/xml;q=0.9, text/plain;q=0.8',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' }),
        'user-agent': 'Lume-Judicial/0.1 (+contato: suporte@k5.app)',
        ...options.headers,
      },
      servername: isIpHost ? undefined : rawHostname,
      lookup: (_host, lookupOpts, callback) => {
        const cb = typeof lookupOpts === 'function' ? lookupOpts : callback;
        const opts = typeof lookupOpts === 'object' && lookupOpts !== null ? lookupOpts : {};
        if (opts.all) {
          cb(null, [{ address: validatedIp, family: ipFamily }]);
        } else {
          cb(null, validatedIp, ipFamily);
        }
      },
      signal: options.signal,
    });

    req.on('error', (err: Error & { code?: string }) => {
      if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
        reject(new ConnectorError('source_unavailable', 'A fonte não respondeu dentro do tempo limite.'));
      } else if (err instanceof ConnectorError) {
        reject(err);
      } else {
        reject(new ConnectorError('source_unavailable', 'Falha de rede ao contatar a fonte.'));
      }
    });

    req.on('response', (res) => {
      const declared = Number(res.headers['content-length'] ?? '0');
      if (declared > options.maxBytes) {
        req.destroy();
        reject(new ConnectorError('partial', 'Resposta da fonte acima do limite configurado.'));
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;

      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > options.maxBytes) {
          res.destroy();
          reject(new ConnectorError('partial', 'Resposta da fonte acima do limite configurado.'));
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        const bytes = Buffer.concat(chunks);
        resolve({
          status: res.statusCode ?? 200,
          headers: res.headers,
          bytes,
        });
      });

      res.on('error', () => {
        reject(new ConnectorError('source_unavailable', 'Falha de rede ao ler a resposta da fonte.'));
      });
    });

    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}

export const liveTransport: Transport = {
  mode: 'live',
  async request(installation, path, init = {}) {
    const result = await this.requestBinary!(installation, path, init);
    return { status: result.status, contentType: result.contentType, body: result.bytes.toString('utf8'), url: result.url };
  },
  async requestBinary(installation, path, init = {}) {
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
        const validatedIp = await assertPublicHost(url.hostname);

        const response = await executeHttpsRequest(url, validatedIp, {
          method: init.method ?? 'GET',
          headers: init.headers ?? {},
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: controller.signal,
          maxBytes,
        });

        if (response.status >= 300 && response.status < 400) {
          const rawLocation = response.headers.location;
          const location = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation;
          if (!location) throw new ConnectorError('schema_changed', 'A fonte redirecionou sem destino.');
          url = new URL(location, url);
          continue;
        }

        if (response.status < 200 || response.status >= 300) {
          const rawRetryAfter = response.headers['retry-after'];
          const retryAfter = Array.isArray(rawRetryAfter) ? rawRetryAfter[0] : (rawRetryAfter ?? null);
          throw statusToError(response.status, retryAfter);
        }

        const rawContentType = response.headers['content-type'];
        const contentType = Array.isArray(rawContentType) ? rawContentType[0] : (rawContentType ?? '');
        assertContentType(contentType);
        return { status: response.status, contentType, body: '', bytes: response.bytes, url: url.toString() };
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
  fixtures: Map<string, { contentType?: string; body: string | Buffer; status?: number }>,
  /**
   * Awaited before the fixture is answered, so a test can make something happen mid-request —
   * another worker taking the lease, for instance. It has to be a hook here rather than a wrapper
   * around `fixtures.get`, because the database is asynchronous and work started from a
   * synchronous `get` would not have landed by the time the response is handled.
   */
  onRequest?: () => Promise<void> | void,
): Transport {
  const requestFixture = async (installation: InstallationRef, path: string, init: TransportRequestInit = {}) => {
      await onRequest?.();
      const key = fixtureKey(installation.id, init.method ?? 'GET', path, init.query);
      const fixture = fixtures.get(key);
      if (!fixture) throw new ConnectorError('not_found_in_source', `Sem fixture para ${key}`);
      const status = fixture.status ?? 200;
      if (status >= 400) throw statusToError(status, null);
      const bytes = Buffer.isBuffer(fixture.body) ? fixture.body : Buffer.from(fixture.body);
      if (bytes.length > (init.maxBytes ?? DEFAULT_MAX_BYTES)) throw new ConnectorError('partial', 'Resposta da fonte acima do limite configurado.');
      return { status, contentType: fixture.contentType ?? 'application/json', body: bytes.toString('utf8'), bytes, url: `fixture://${key}` };
  };
  return {
    mode: 'fixture',
    async request(installation, path, init = {}) {
      const { bytes: _bytes, ...response } = await requestFixture(installation, path, init);
      return response;
    },
    requestBinary: requestFixture,
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
