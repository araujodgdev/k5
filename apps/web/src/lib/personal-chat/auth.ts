import 'server-only';
import { auth } from '@/lib/auth';
import { database } from '@/lib/database';
import { ApiError } from '@/lib/workspace-api';
import { isTrustedOrigin } from '@/lib/trusted-origins';
import { assertTermsAccepted } from '@/lib/legal-acceptance';

export type PersonContext = { userId: string; email: string; name: string; sessionId: string | undefined };

export async function apiPerson(request: Request, write = false): Promise<PersonContext> {
  const session = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true, disableRefresh: true },
  });
  if (!session) throw new ApiError(401, 'Entre novamente para continuar.');
  await assertTermsAccepted(database, session.user.id);
  if (write && !isTrustedOrigin(request.headers.get('origin'))) throw new ApiError(403, 'Origem não autorizada.');
  return { userId: session.user.id, email: session.user.email, name: session.user.name, sessionId: session.session?.id };
}
