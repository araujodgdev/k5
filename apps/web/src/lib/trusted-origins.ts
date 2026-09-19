/**
 * Which browser origins may perform a write.
 *
 * `BETTER_AUTH_TRUSTED_ORIGINS` is the same list Better Auth is given, and Better Auth accepts a
 * wildcard host (`https://*.trycloudflare.com`, the documented dev-tunnel default). K5's own CSRF
 * checks compared the header to that string literally, so on a tunnel every write was refused
 * while signing in worked — the two checks have to read the configuration the same way.
 *
 * The matching is deliberately narrow: same scheme, same port, and `*` stands for exactly one DNS
 * label. `https://*.example.com` covers `https://a.example.com` and neither `https://example.com`,
 * `https://a.b.example.com` nor `https://evil-example.com`.
 */

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

function matchesPattern(pattern: string, candidate: URL): boolean {
  const raw = pattern.trim();
  if (!raw) return false;
  // A bare host in the configuration means https; a tunnel or a proxy that is not TLS has to say so.
  let allowed: URL;
  try {
    allowed = new URL(HAS_SCHEME.test(raw) ? raw : `https://${raw}`);
  } catch {
    return false;
  }
  if (allowed.protocol !== candidate.protocol || allowed.port !== candidate.port) return false;

  const host = allowed.hostname;
  if (!host.startsWith("*.")) return host === candidate.hostname;

  const suffix = host.slice(2);
  if (!suffix || suffix.includes("*")) return false;
  if (!candidate.hostname.endsWith(`.${suffix}`)) return false;
  const label = candidate.hostname.slice(0, -(suffix.length + 1));
  return label.length > 0 && !label.includes(".");
}

/** The configured list: the canonical URL of the app plus any extra origins. */
export function trustedOriginPatterns(): string[] {
  return [
    process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",") ?? []),
  ].map((value) => value.trim()).filter(Boolean);
}

export function isTrustedOrigin(origin: string | null | undefined, patterns: readonly string[] = trustedOriginPatterns()): boolean {
  if (!origin) return false;
  let candidate: URL;
  try {
    candidate = new URL(origin);
  } catch {
    return false;
  }
  // An Origin header is scheme://host[:port] and nothing more; anything else is not one.
  if (candidate.origin !== origin) return false;
  return patterns.some((pattern) => matchesPattern(pattern, candidate));
}
