import { setTimeout } from 'node:timers/promises';

export const isStrongInpiEtag = (value: string | null): value is string => value !== null && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value);

export class InpiDownloadError extends Error {
  constructor(readonly code: 'INPI_SOURCE_CHANGED' | 'INPI_HTTP_INVALID' | 'INPI_TRUNCATED' | 'INPI_NETWORK', options?: ErrorOptions) {
    super({ INPI_SOURCE_CHANGED: 'A carga do INPI mudou durante o download.', INPI_HTTP_INVALID: 'Resposta HTTP inválida do INPI.',
      INPI_TRUNCATED: 'Trecho incompleto dos dados abertos.', INPI_NETWORK: 'Falha transitória ao acessar o INPI.' }[code], options);
  }
}

/** Only release a bounded, validated range. Offsets must come from CSV record checkpoints. */
export async function* downloadInpiCsv(url: string, metadata: { size: number; etag: string }, options: { offset?: number; signal?: AbortSignal } = {}) {
  let chunkSize = 8 * 1024 * 1024, start = options.offset ?? 0;
  if (!Number.isSafeInteger(start) || start < 0 || start > metadata.size || !isStrongInpiEtag(metadata.etag)) {
    throw new InpiDownloadError('INPI_HTTP_INVALID');
  }
  while (start < metadata.size) {
    let bytes: Uint8Array | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      options.signal?.throwIfAborted();
      const end = Math.min(start + chunkSize, metadata.size) - 1;
      try {
        const timeout = AbortSignal.timeout(30_000);
        const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}`, 'If-Range': metadata.etag, 'Accept-Encoding': 'identity' },
          signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout });
        const etag = response.headers.get('etag');
        let failure: InpiDownloadError['code'] | undefined;
        if ((response.status === 200 || response.status === 206) && isStrongInpiEtag(etag) && etag !== metadata.etag) failure = 'INPI_SOURCE_CHANGED';
        else if ([408,429,500,502,503,504].includes(response.status)) failure = 'INPI_NETWORK';
        else if (response.status !== 206 || !isStrongInpiEtag(etag) || etag !== metadata.etag || response.headers.get('content-range') !== `bytes ${start}-${end}/${metadata.size}`
          || ![null, 'identity'].includes(response.headers.get('content-encoding'))) failure = 'INPI_HTTP_INVALID';
        if (failure) { await response.body?.cancel(); throw new InpiDownloadError(failure); }
        if (!response.body) throw new InpiDownloadError('INPI_TRUNCATED');
        const reader = response.body.getReader(), expected = end - start + 1;
        const buffer = new Uint8Array(expected);
        let received = 0;
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (received + value.length > expected) throw new InpiDownloadError('INPI_HTTP_INVALID');
            buffer.set(value, received); received += value.length;
          }
        } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
        if (received !== expected) throw new InpiDownloadError('INPI_TRUNCATED');
        bytes = buffer;
        break;
      } catch (error) {
        options.signal?.throwIfAborted();
        const failure = error instanceof InpiDownloadError ? error : new InpiDownloadError('INPI_NETWORK', { cause: error });
        if (['INPI_SOURCE_CHANGED','INPI_HTTP_INVALID'].includes(failure.code) || attempt === 4) throw failure;
        chunkSize = Math.max(64 * 1024, Math.floor(chunkSize / 2));
        await setTimeout(100 * 2 ** attempt, undefined, { signal: options.signal });
      }
    }
    if (!bytes) throw new InpiDownloadError('INPI_NETWORK');
    start += bytes.length;
    yield bytes;
  }
}
