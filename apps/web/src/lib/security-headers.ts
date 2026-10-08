/**
 * Headers every response from the web Worker carries. `next.config.ts` `headers()` does not reach
 * production: vinext serves pages through `src/workers/web.ts` and static files through the
 * assets binding (`public/_headers` covers those). Before this, lume.software sent none of them,
 * so another site could frame the approval screens that send e-mail or delete documents.
 *
 * Framing stays allowed for the same origin because the app previews its own PDFs in an iframe.
 * A route that already set one of these keeps its own value; a route's own CSP (the sandboxed
 * document previews) is kept and `frame-ancestors` is added as a second policy beside it.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // The chat records voice and takes photos; nothing in Lume reads location or payment APIs.
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(), payment=()',
};

const FRAME_ANCESTORS = "frame-ancestors 'self'";

export function withSecurityHeaders(response: Response, request?: Request): Response {
  // An upgrade cannot be rebuilt, and its headers are not a document's.
  if (response.status === 101) return response;
  let secured = response;
  try {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) if (!response.headers.has(name)) response.headers.set(name, value);
  } catch {
    // Redirects and fetched responses have immutable headers; copy them into a response we own.
    secured = new Response(response.body, response);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) if (!secured.headers.has(name)) secured.headers.set(name, value);
  }
  const policy = secured.headers.get('Content-Security-Policy');
  if (!policy?.includes('frame-ancestors')) {
    if (policy) secured.headers.append('Content-Security-Policy', FRAME_ANCESTORS);
    else secured.headers.set('Content-Security-Policy', FRAME_ANCESTORS);
  }
  // API responses can contain private data even when an individual route forgot cache headers.
  if (request && new URL(request.url).pathname.startsWith('/api/')) {
    secured.headers.set('Cache-Control', 'private, no-store');
    secured.headers.set('CDN-Cache-Control', 'no-store');
    secured.headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
  }
  return secured;
}
