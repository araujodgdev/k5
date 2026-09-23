import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { database } from '@/lib/database';
import { ensureOfficeForUser } from '@/lib/offices';
import { completeGoogleConnect } from '@/lib/google/connections';
import { googleOAuthConfig } from '@/lib/google/config';
import { captureOperationalError } from '@/lib/observability/report';

/**
 * Google redirects here. The only destination is the fixed Integrações page, so no parameter can
 * turn this into an open redirect; the result travels as a short code, never as token data.
 */
function back(request: Request, outcome: string, missing: string[] = []) {
  const url = new URL('/app/integrations', process.env.BETTER_AUTH_URL ?? request.url);
  url.searchParams.set('google', outcome);
  if (missing.length) url.searchParams.set('missing', missing.join(','));
  const response = NextResponse.redirect(url, 303);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export async function GET(request: Request) {
  if (!googleOAuthConfig()) return back(request, 'not_configured');
  const session = await getSession();
  // Logging out between consent and callback invalidates the state: its session is gone.
  if (!session?.session?.id) return back(request, 'invalid');
  const url = new URL(request.url);
  try {
    const office = await ensureOfficeForUser(database, session.user);
    const result = await completeGoogleConnect({ officeId: office.officeId, userId: session.user.id, sessionId: session.session.id }, {
      code: url.searchParams.get('code'), state: url.searchParams.get('state'), error: url.searchParams.get('error'),
    });
    return back(request, result.outcome, result.missing);
  } catch (error) {
    captureOperationalError(error, 'google.oauth.callback');
    return back(request, 'failed');
  }
}
