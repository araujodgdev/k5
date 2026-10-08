import 'server-only';
import type { Pool } from 'pg';
import { createAuth } from './auth-core';
import { databaseBackend, database } from './database';
import { after } from 'next/server';
import { personalEmailSettings, sendPersonalEmail } from './personal-chat/email-transport';
import { captureOperationalError } from './observability/report';
import { turnstileEnabled, verifyTurnstile } from './turnstile';
import { authOrigins } from './auth-origins';

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 32) throw new Error('Configure BETTER_AUTH_SECRET com pelo menos 32 caracteres. Em dev, execute pnpm db:setup.');
const idleSeconds = Number(process.env.SESSION_IDLE_SECONDS ?? 28800);
if (!Number.isInteger(idleSeconds) || idleSeconds < 60) throw new Error('SESSION_IDLE_SECONDS deve ser um inteiro de pelo menos 60 segundos.');
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const origins = authOrigins();

const settings = {
  emailVerification: { enabled: () => Boolean(personalEmailSettings()), send: async ({ user, url, change }: { user: { id: string; email: string }; url: string; change?: { previousEmail: string } }) => {
    after(async () => {
      const link = escapeHtml(url);
      const result = change
        ? await sendPersonalEmail({ to: user.email, subject: 'Confirme seu novo e-mail no Lume',
          text: `Para passar a entrar no Lume com este endereço, abra este link em até 24 horas:
${url}

Até lá, a conta continua com o e-mail anterior. Se você não pediu a troca, ignore esta mensagem.`,
          html: `<p>Para passar a entrar no Lume com este endereço, use o link abaixo em até 24 horas.</p><p><a href="${link}">Confirmar novo e-mail</a></p><p>Se o botão não abrir, copie este endereço no navegador:<br>${link}</p><p>Até lá, a conta continua com o e-mail anterior. Se você não pediu a troca, ignore esta mensagem.</p>` })
        : await sendPersonalEmail({ to: user.email, subject: 'Confirme seu e-mail no Lume',
          text: `Para confirmar seu e-mail e entrar no Lume, abra este link em até 24 horas:
${url}

Se você não criou uma conta no Lume, ignore esta mensagem.`,
          html: `<p>Para confirmar seu e-mail e entrar no Lume, use o link abaixo em até 24 horas.</p><p><a href="${link}">Confirmar e-mail</a></p><p>Se o botão não abrir, copie este endereço no navegador:<br>${link}</p><p>Se você não criou uma conta no Lume, ignore esta mensagem.</p>` });
      if (result.state !== 'accepted') captureOperationalError(new Error('Verification email was not accepted.'), 'auth.email-verification.delivery', { code: result.code });
      // The current address hears about the request, so a change nobody asked for is noticed.
      if (change) {
        const notice = await sendPersonalEmail({ to: change.previousEmail, subject: 'Pedido de troca do seu e-mail no Lume',
          text: `Pediram para trocar o e-mail da sua conta no Lume para ${user.email}. Nada muda até esse endereço confirmar a troca.

Se não foi você, troque sua senha em Perfil e encerre as outras sessões.`,
          html: `<p>Pediram para trocar o e-mail da sua conta no Lume para ${escapeHtml(user.email)}. Nada muda até esse endereço confirmar a troca.</p><p>Se não foi você, troque sua senha em Perfil e encerre as outras sessões.</p>` });
        if (notice.state !== 'accepted') captureOperationalError(new Error('Email change notice was not accepted.'), 'auth.email-change.notice', { code: notice.code });
      }
    });
  } },
  passwordReset: { enabled: () => Boolean(personalEmailSettings()), send: async ({ user, url }: { user: { id: string; email: string }; url: string }) => {
    after(async () => {
      const result = await sendPersonalEmail({ to: user.email, subject: 'Redefina sua senha no Lume', text: `Para redefinir sua senha, abra este link: ${url}\nSe não fez o pedido, ignore esta mensagem.`,
        html: `<p>Para redefinir sua senha, abra: ${url.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')}</p><p>Se não fez o pedido, ignore esta mensagem.</p>` });
      if (result.state !== 'accepted') captureOperationalError(new Error('Password reset email was not accepted.'), 'auth.password-reset.delivery');
    });
  } },
  signUpChallenge: { enabled: turnstileEnabled, verify: verifyTurnstile },
  secret, baseURL: origins.baseURL, idleSeconds,
  extraOrigins: origins.trustedOrigins.slice(1),
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

/** Checks the person's current password with Better Auth's own hashing, for steps that cannot be undone. */
export async function verifyCurrentPassword(userId: string, password: string) {
  const context = await currentAuth().$context;
  const account = await context.internalAdapter.findCredentialAccount(userId);
  return Boolean(account?.password && password && await context.password.verify({ hash: account.password, password }));
}
