import 'server-only';
import { auth } from '@/lib/auth';
import { ApiError } from '@/lib/workspace-api';
import { isTrustedOrigin } from '@/lib/trusted-origins';
import type { ClientContext } from './service';

export async function apiClientPortal(request: Request, write = false): Promise<ClientContext> {
  if (write && !isTrustedOrigin(request.headers.get('origin'))) throw new ApiError(403, 'Origem não autorizada.');
  const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true, disableRefresh: !write } });
  if (!session?.session.id) throw new ApiError(401, 'Entre novamente para continuar.');
  return { userId: session.user.id, sessionId: session.session.id, signal: request.signal };
}
export function portalFileResponse(file: { bytes: Uint8Array; name: string; mimeType: string }) {
  return new Response(new Uint8Array(file.bytes), { headers: { 'Content-Type': file.mimeType, 'Content-Disposition': `attachment; filename="documento"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
