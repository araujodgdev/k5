export async function tutorialVideoResponse(request: Request, assets: { fetch(request: Request): Promise<Response> }) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  const sourceHeaders = new Headers(request.headers);
  sourceHeaders.delete('Range');
  sourceHeaders.delete('If-Range');
  let source = await assets.fetch(new Request(request, { headers: sourceHeaders }));
  if (source.status !== 200) return source;
  const headers = new Headers(source.headers);
  headers.set('Accept-Ranges', 'bytes');
  const value = request.headers.get('Range');
  const validator = request.headers.get('If-Range');
  if (request.method === 'HEAD' || !value || (validator && validator !== headers.get('ETag'))) {
    return new Response(source.body, { status: 200, headers });
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!range || (!range[1] && !range[2])) return new Response(source.body, { headers });
  let size = Number(headers.get('Content-Length'));
  if (!size) {
    // This handler only serves the bundled tutorial, bounded by the static asset size limit.
    const bytes = await source.arrayBuffer();
    size = bytes.byteLength;
    source = new Response(bytes);
  }
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
    await source.body?.cancel();
    headers.set('Content-Range', `bytes */${size}`);
    headers.set('Content-Length', '0');
    return new Response(null, { status: 416, headers });
  }
  const reader = source.body?.getReader();
  if (!reader) return new Response(null, { status: 502 });
  let position = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (position <= end) {
        const { done, value } = await reader.read();
        if (done) { controller.close(); return; }
        const offset = position;
        position += value.byteLength;
        if (position <= start) continue;
        controller.enqueue(value.subarray(Math.max(0, start - offset), Math.min(value.byteLength, end + 1 - offset)));
        if (position > end) { controller.close(); await reader.cancel(); }
        return;
      }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(body, { status: 206, headers });
}
