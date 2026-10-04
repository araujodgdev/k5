import { z } from 'zod';
import { auth } from '@/lib/auth';
import { database } from '@/lib/database';
import { ApiError, apiError, limitedJson } from '@/lib/workspace-api';
import { isTrustedOrigin } from '@/lib/trusted-origins';
import { portalInvitation, acceptPortalInvitation } from '@/lib/client-portal/invitations';
import { withClientRegistration } from '@/lib/client-portal/registration';
import { authErrorMessage } from '@/lib/auth-validation';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    if (!isTrustedOrigin(request.headers.get('origin'))) throw new ApiError(403, 'Origem não autorizada.');
    const { token } = await params;
    const invitation = await portalInvitation(database, token);
    const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
    if (session) { await acceptPortalInvitation(database, token, session.user); return Response.json({ accepted: true }); }
    const input = z.object({ name: z.string().trim().min(2).max(120), password: z.string().min(8).max(128), acceptedLegalVersion: z.string().max(20).optional() }).parse(await limitedJson(request, 4096));
    // The response carries Better Auth's signed session cookie; password hashing remains its responsibility.
    const headers = new Headers(request.headers); headers.delete('content-length'); headers.set('content-type', 'application/json');
    const response = await withClientRegistration(token, () => auth.handler(new Request(new URL('/api/auth/sign-up/email', request.url), {
      method: 'POST', headers, body: JSON.stringify({ ...input, email: invitation.email, officeName: 'Portal do cliente', callbackURL: '/client' }),
    })));
    if (!response.ok) { const failure = z.object({ code: z.string().optional() }).safeParse(await response.json().catch(() => null));
      return Response.json({ error: authErrorMessage(failure.success ? failure.data.code : undefined) }, { status: response.status }); }
    response.headers.set('Cache-Control', 'private, no-store'); return response;
  } catch (error) { return apiError(error); }
}
