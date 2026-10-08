type OriginEnvironment = { NODE_ENV?: string; K5_RUNTIME?: string; BETTER_AUTH_URL?: string; BETTER_AUTH_TRUSTED_ORIGINS?: string };

/** Public deployments trust only their canonical HTTPS origin. Tunnels are development-only. */
export function authOrigins(env: OriginEnvironment = process.env): { baseURL: string; trustedOrigins: string[] } {
  const production = env.NODE_ENV === 'production' || env.K5_RUNTIME === 'cloudflare';
  if (production && !env.BETTER_AUTH_URL) throw new Error('Configure BETTER_AUTH_URL em produção.');
  const raw = env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error('BETTER_AUTH_URL deve ser uma origem HTTP ou HTTPS válida.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('BETTER_AUTH_URL deve conter somente a origem do aplicativo.');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (production && url.protocol !== 'https:' && !loopback)
    throw new Error('BETTER_AUTH_URL deve usar HTTPS em produção.');
  const extra = env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean) ?? [];
  if (production && extra.some(value => value.replace(/\/$/, '') !== url.origin))
    throw new Error('Produção aceita somente a origem definida em BETTER_AUTH_URL. Remova as origens adicionais.');
  return { baseURL: url.origin, trustedOrigins: production ? [url.origin] : [url.origin, ...extra] };
}
