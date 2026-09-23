import type { Pool } from 'pg';

/** Keep the request pool alive until the response stream finishes, fails or is cancelled. */
export function closePoolWithResponse(response: Response, pool: Pool, waitUntil: (promise: Promise<unknown>) => void): Response {
  let closing = false;
  const close = () => { if (!closing) { closing=true; waitUntil(pool.end()); } };
  if (!response.body) { close(); return response; }
  const reader = response.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) { controller.close(); close(); }
        else controller.enqueue(result.value);
      } catch (error) { controller.error(error); close(); }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { close(); } },
  });
  return new Response(stream, { status:response.status, statusText:response.statusText, headers:response.headers });
}
