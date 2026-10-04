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

export async function verifyTurnstile(token: string, remoteIp: string | null) {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret || !token || token.length > 2048) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return false;
    const result = await response.json() as { success?: boolean };
    return result.success === true;
  } catch { return false; }
}
