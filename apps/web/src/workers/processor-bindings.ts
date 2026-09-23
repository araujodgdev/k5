import type { VectorizeBinding } from '../lib/knowledge/vector-index';

export interface ProcessorBindings {
  VAULT: {
    get(key: string): Promise<{ body: ReadableStream } | null>;
    put(key: string, value: ReadableStream): Promise<unknown>;
    delete(key: string): Promise<unknown>;
  };
  KNOWLEDGE: VectorizeBinding;
}

const OBJECT_KEY = /^(?:[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}(?:\.[a-z0-9]{1,8})?|research\/sha256\/[0-9a-f]{2}\/[0-9a-f]{64}\.(?:pdf|html|txt|json|zip))$/;

/** Called only by the Container outbound proxy, which supplies the Worker's capability bindings. */
export async function processorBindingRequest(request: Request, env: ProcessorBindings): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname !== 'k5-bindings') return new Response(null, { status: 404 });
  if (url.pathname.startsWith('/objects/')) {
    let key: string;
    try { key = decodeURIComponent(url.pathname.slice('/objects/'.length)); }
    catch { return new Response(null, { status: 400 }); }
    if (!OBJECT_KEY.test(key)) return new Response(null, { status: 400 });
    if (request.method === 'GET') {
      const object = await env.VAULT.get(key);
      return new Response(object?.body ?? null, { status: object ? 200 : 404 });
    }
    if (request.method === 'PUT' && request.body) {
      // Stream the object to R2; neither the Worker heap nor the container disk holds a second copy.
      await env.VAULT.put(key, request.body);
      return new Response(null, { status: 204 });
    }
    if (request.method === 'DELETE') {
      await env.VAULT.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  if (!['/vectors/upsert', '/vectors/query', '/vectors/delete'].includes(url.pathname)) return new Response(null, { status: 404 });
  const payload = await request.json();
  if (url.pathname === '/vectors/upsert') return Response.json(await env.KNOWLEDGE.upsert(payload as Parameters<VectorizeBinding['upsert']>[0]));
  if (url.pathname === '/vectors/delete') return Response.json(await env.KNOWLEDGE.deleteByIds(payload as string[]));
  const { vector, options } = payload as { vector: number[]; options: Parameters<VectorizeBinding['query']>[1] };
  return Response.json(await env.KNOWLEDGE.query(vector, options));
}
