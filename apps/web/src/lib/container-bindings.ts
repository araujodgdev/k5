/** Private host intercepted by the owning Cloudflare Container, never a public endpoint. */
export const CONTAINER_BINDINGS_HOST = 'k5-bindings';

export async function containerBindingFetch(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`http://${CONTAINER_BINDINGS_HOST}${path}`, {
    ...init,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Binding do processador indisponível (${response.status}).`);
  return response;
}

export async function containerVectorCall<T>(operation: string, payload: unknown): Promise<T> {
  const response = await containerBindingFetch(`/vectors/${operation}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return response.json() as Promise<T>;
}
