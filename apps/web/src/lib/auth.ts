import 'server-only';
import type { Pool } from 'pg';
import { createAuth } from './auth-core';
import { databaseBackend, database } from './database';
import { after } from 'next/server';
import { personalEmailSettings, sendPersonalEmail } from './personal-chat/email-transport';
import { captureOperationalError } from './observability/report';

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 32) throw new Error('Configure BETTER_AUTH_SECRET com pelo menos 32 caracteres. Em dev, execute pnpm db:setup.');
const idleSeconds = Number(process.env.SESSION_IDLE_SECONDS ?? 28800);
if (!Number.isInteger(idleSeconds) || idleSeconds < 60) throw new Error('SESSION_IDLE_SECONDS deve ser um inteiro de pelo menos 60 segundos.');
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const settings = {
  emailVerification: { enabled: () => Boolean(personalEmailSettings()), send: async ({ user, url }: { user: { id: string; email: string }; url: string }) => {
    after(async () => {
      const link = escapeHtml(url);
      const result = await sendPersonalEmail({ to: user.email, subject: 'Confirme seu e-mail no Lume',
        text: `Para confirmar seu e-mail e entrar no Lume, abra este link em até 24 horas:\n${url}\n\nSe você não criou uma conta no Lume, ignore esta mensagem.`,
        html: `<p>Para confirmar seu e-mail e entrar no Lume, use o link abaixo em até 24 horas.</p><p><a href="${link}">Confirmar e-mail</a></p><p>Se o botão não abrir, copie este endereço no navegador:<br>${link}</p><p>Se você não criou uma conta no Lume, ignore esta mensagem.</p>` });
      if (result.state !== 'accepted') captureOperationalError(new Error('Verification email was not accepted.'), 'auth.email-verification.delivery', { code: result.code });
    });
  } },
  passwordReset: { enabled: () => Boolean(personalEmailSettings()), send: async ({ user, url }: { user: { id: string; email: string }; url: string }) => {
    after(async () => {
      const result = await sendPersonalEmail({ to: user.email, subject: 'Redefina sua senha no Lume', text: `Para redefinir sua senha, abra este link: ${url}\nSe não fez o pedido, ignore esta mensagem.`,
        html: `<p>Para redefinir sua senha, abra: ${url.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')}</p><p>Se não fez o pedido, ignore esta mensagem.</p>` });
      if (result.state !== 'accepted') captureOperationalError(new Error('Password reset email was not accepted.'), 'auth.password-reset.delivery');
    });
  } },
  secret, baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000', idleSeconds,
  extraOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',').map(origin=>origin.trim()).filter(Boolean),
  // Cloudflare overwrites cf-connecting-ip at the edge. Anywhere else a client can send it, so the
  // header is only trusted when the operator names the one their own proxy overwrites.
  ipHeaders: process.env.K5_RUNTIME === 'cloudflare' ? ['cf-connecting-ip']
    : process.env.K5_CLIENT_IP_HEADER ? [process.env.K5_CLIENT_IP_HEADER.trim().toLowerCase()] : [],
};
const instances = new WeakMap<Pool, ReturnType<typeof createAuth>>();
function currentAuth() {
  const pool = databaseBackend().store;
  let instance = instances.get(pool);
  if (!instance) { instance=createAuth(pool,database,settings); instances.set(pool,instance); }
  return instance;
}
// No sockets, promises or auth adapter state cross Cloudflare request boundaries.
export const auth = {
  get api() { return currentAuth().api; },
  handler(request: Request) { return currentAuth().handler(request); },
};
