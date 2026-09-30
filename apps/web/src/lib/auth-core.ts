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

/** Better Auth uses the same PostgreSQL pool as the business-data adapter. */
export type AuthStore = NonNullable<BetterAuthOptions["database"]>;

/**
 * Better Auth owns its own tables and reaches them through `store`, while the office provisioning
 * hook writes Lume's tables through `db`. They are the same database; the two handles exist because
 * Better Auth needs a backend it recognises and Lume needs the async seam in `db/types.ts`.
 */
export function createAuth(store: AuthStore, db: Database, settings: { secret: string; baseURL: string; idleSeconds: number; extraOrigins?: string[]; ipHeaders?: string[];
  passwordReset?: { enabled: () => boolean; send: (input: { user: { id: string; email: string }; url: string }) => Promise<void> } }) {
  return betterAuth({
    appName: "Lume",
    database: store,
    secret: settings.secret,
    baseURL: settings.baseURL,
    trustedOrigins: [settings.baseURL, ...(settings.extraOrigins ?? [])],
    emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128, revokeSessionsOnPasswordReset: true,
      sendResetPassword: settings.passwordReset ? settings.passwordReset.send : undefined },
    user: {
      // There is no e-mail delivery, so the address changes at once; the hook below asks for the
      // current password first, so a borrowed session cannot move the account to another address.
      changeEmail: { enabled: true, updateEmailWithoutVerification: true },
      additionalFields: {
        // Retained to recover office provisioning after an interrupted registration.
        officeName: { type: "string", required: true, validator: { input: z.string().trim().min(2).max(160) } },
        accountKind: { type: 'string', required: false, defaultValue: 'office', input: false },
      },
    },
    session: {
      expiresIn: settings.idleSeconds,
      updateAge: 0,
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
        "/sign-up/email": { window: 60, max: 10 },
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
      user: { create: { before: async (user) => ({ data: { ...user, accountKind: clientRegistration() ? 'client' : 'office' } }), after: async (user) => {
        const registration = clientRegistration();
        if (registration) { await acceptPortalInvitation(db, registration.token, user); return; }
        await ensureOfficeForUser(db, { id: user.id, officeName: (user as typeof user & { officeName: string }).officeName });
      } } },
    },
  });
}
