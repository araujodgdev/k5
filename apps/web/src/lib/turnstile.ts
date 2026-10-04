import 'server-only';

/**
 * Cloudflare Turnstile on sign-up: TURNSTILE_SITE_KEY is public and goes to the form;
 * TURNSTILE_SECRET_KEY stays on the server and checks each token once. Without both keys the
 * challenge is off, as in local development and the e2e runner.
 */
export function turnstileSiteKey() {
  return process.env.TURNSTILE_SECRET_KEY?.trim() ? process.env.TURNSTILE_SITE_KEY?.trim() || undefined : undefined;
}
export const turnstileEnabled = () => Boolean(turnstileSiteKey());

/** The action the sign-up widget declares; a token minted for another form does not count here. */
export const SIGN_UP_ACTION = 'sign-up';

/**
 * Frontend hostnames this deployment accepts tokens from (TURNSTILE_HOSTNAMES, comma separated).
 * The widget may also list localhost for development; production names only its own domain.
 */
const expectedHostnames = () => new Set((process.env.TURNSTILE_HOSTNAMES ?? '').split(',').map(name => name.trim().toLowerCase()).filter(Boolean));

/** Siteverify fails closed: an unreachable service, another action or another hostname refuses the token. */
export async function verifyTurnstile(token: string, remoteIp: string | null, expectedAction = SIGN_UP_ACTION) {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  const hostnames = expectedHostnames();
  if (!secret || !token || token.length > 2048 || !hostnames.size) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const result = await response.json() as { success?: boolean; action?: string; hostname?: string };
    return result.success === true && result.action === expectedAction && hostnames.has(String(result.hostname ?? '').toLowerCase());
  } catch { return false; }
}
