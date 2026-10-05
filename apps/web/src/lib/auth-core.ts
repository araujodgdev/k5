import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { z } from "zod";
import { signUpSchema } from "./auth-validation";
import type { Database } from "./database";
import { ensureOfficeForUser } from "./offices";
import { revokePushSubscriptionsForUser } from "./notifications/revocation";
import { clientRegistration } from './client-portal/registration';
import { portalInvitation, acceptPortalInvitation } from './client-portal/invitations';
import { recordAcceptance } from './legal-acceptance';
import { LEGAL_VERSION } from './legal-version';

/** Better Auth uses the same PostgreSQL pool as the business-data adapter. */
export type AuthStore = NonNullable<BetterAuthOptions["database"]>;

/**
 * Better Auth owns its own tables and reaches them through `store`, while the office provisioning
 * hook writes Lume's tables through `db`. They are the same database; the two handles exist because
 * Better Auth needs a backend it recognises and Lume needs the async seam in `db/types.ts`.
 */
export function createAuth(store: AuthStore, db: Database, settings: { secret: string; baseURL: string; idleSeconds: number; extraOrigins?: string[]; ipHeaders?: string[];
  passwordReset?: { enabled: () => boolean; send: (input: { user: { id: string; email: string }; url: string }) => Promise<void> };
  /** A human check on the sign-up form (Turnstile); the portal invitation is already bound to a token. */
  signUpChallenge?: { enabled: () => boolean; verify: (token: string, remoteIp: string | null) => Promise<boolean> };
  /** `change` is set when the link confirms a new address for an existing account. */
  emailVerification?: { enabled: () => boolean; send: (input: { user: { id: string; email: string }; url: string; change?: { previousEmail: string } }) => Promise<void> } }) {
  // Verification is required wherever e-mail can actually be delivered. Without a sender (local
  // development, the e2e runner) nobody could ever confirm, so sign-up keeps working as before.
  const verifyEmail = settings.emailVerification?.enabled() ?? false;
  return betterAuth({
    appName: "Lume",
    database: store,
    secret: settings.secret,
    baseURL: settings.baseURL,
    trustedOrigins: [settings.baseURL, ...(settings.extraOrigins ?? [])],
    emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128, revokeSessionsOnPasswordReset: true,
      requireEmailVerification: verifyEmail,
      sendResetPassword: settings.passwordReset ? settings.passwordReset.send : undefined },
    emailVerification: verifyEmail && settings.emailVerification ? {
      // A change of address reaches here with the new address; the account still has the old one
      // until the link is opened, which tells the two messages apart.
      sendVerificationEmail: async ({ user, url }) => {
        const current = await db.prepare('SELECT email FROM "user" WHERE id=?').get<{ email: string }>(user.id);
        const change = current && current.email.toLowerCase() !== user.email.toLowerCase() ? { previousEmail: current.email } : undefined;
        await settings.emailVerification!.send({ user: { id: user.id, email: user.email }, url, ...(change ? { change } : {}) });
      },
      sendOnSignUp: true,
      // Signing in with an unconfirmed address sends a fresh link instead of a dead end.
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 24 * 60 * 60,
    } : undefined,
    user: {
      // With e-mail delivery, a confirmed account keeps its address until the new one opens the
      // link sent to it. Without delivery (local, e2e) the address changes at once. Either way the
      // hook below asks for the current password, so a borrowed session cannot move the account.
      changeEmail: { enabled: true, updateEmailWithoutVerification: true },
      additionalFields: {
        // Retained to recover office provisioning after an interrupted registration.
        officeName: { type: "string", required: true, validator: { input: z.string().trim().min(2).max(160) } },
        accountKind: { type: 'string', required: false, defaultValue: 'office', input: false },
      },
    },
    session: {
      expiresIn: settings.idleSeconds,
      updateAge: 5 * 60,
      cookieCache: { enabled: false },
    },
    advanced: {
      ipAddress: {
        // Only a header the edge overwrites is safe for per-client rate limits. An empty list
        // means no trusted header: every client shares one bucket instead of spoofing its own.
        ipAddressHeaders: settings.ipHeaders ?? ["cf-connecting-ip"],
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        // Each sign-up and each verification request sends an e-mail against a daily sending quota.
        "/sign-up/email": { window: 60, max: 10 },
        '/send-verification-email': { window: 60, max: 3 },
        '/request-password-reset': { window: 60, max: 5 },
        '/reset-password': { window: 60, max: 10 },
        // Both check the current password, so they get the sign-in budget.
        "/change-password": { window: 60, max: 10 },
        "/change-email": { window: 60, max: 10 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/request-password-reset' && !settings.passwordReset?.enabled())
          throw new APIError('SERVICE_UNAVAILABLE', { message: 'A recuperação por e-mail está indisponível. Entre em contato com o escritório.' });
        if (ctx.path === "/sign-up/email") {
          const result = signUpSchema.safeParse(ctx.body);
          if (!result.success) throw new APIError("BAD_REQUEST", { code: "INVALID_SIGN_UP", message: "Confira os dados do cadastro." });
          const registration = clientRegistration();
          if (!registration && settings.signUpChallenge?.enabled()) {
            const token = ctx.headers?.get('x-captcha-response') ?? '';
            const ip = settings.ipHeaders?.map(header => ctx.headers?.get(header)).find(Boolean) ?? null;
            if (!token || !await settings.signUpChallenge.verify(token, ip))
              throw new APIError('BAD_REQUEST', { code: 'CAPTCHA_FAILED', message: 'Não foi possível confirmar a verificação. Tente de novo.' });
          }
          if (registration) {
            const invitation = await portalInvitation(db, registration.token);
            if (invitation.email.toLowerCase() !== result.data.email) throw new APIError('FORBIDDEN', { message: 'Use o e-mail do convite.' });
          }
          return { context: { body: { ...ctx.body, ...result.data } } };
        }
        if (ctx.path === "/change-email") {
          const currentPassword = typeof ctx.body?.currentPassword === "string" ? ctx.body.currentPassword : "";
          const session = await getSessionFromCtx(ctx, { disableCookieCache: true });
          const account = session && await ctx.context.internalAdapter.findCredentialAccount(session.user.id);
          if (!currentPassword || !account?.password || !await ctx.context.password.verify({ hash: account.password, password: currentPassword }))
            throw new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD", message: "Senha atual incorreta." });
        }
        if (ctx.path === "/sign-out") {
          const session = await getSessionFromCtx(ctx, { disableCookieCache: true });
          if (session) {
            // Server revocation wins the race with a stale in-flight subscription request because
            // it advances the authorization generation before deleting every session.
            try {
              await revokePushSubscriptionsForUser(db, session.user.id);
            } finally {
              await ctx.context.internalAdapter.deleteUserSessions(session.user.id);
            }
          }
        }
      }),
    },
    databaseHooks: {
      user: { create: { before: async (user) => ({ data: { ...user, accountKind: clientRegistration() ? 'client' : 'office' } }), after: async (user, ctx) => {
        // The sign-up forms send the version the person ticked; the app asks anyone else on entry.
        if ((ctx?.body as { acceptedLegalVersion?: unknown } | undefined)?.acceptedLegalVersion === LEGAL_VERSION)
          await recordAcceptance(db, user.id, 'terms', ctx?.request?.headers ?? ctx?.headers);
        const registration = clientRegistration();
        if (registration) { await acceptPortalInvitation(db, registration.token, user); return; }
        await ensureOfficeForUser(db, { id: user.id, officeName: (user as typeof user & { officeName: string }).officeName });
      } } },
    },
  });
}
