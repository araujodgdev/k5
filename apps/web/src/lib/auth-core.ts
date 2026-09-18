import type { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { z } from "zod";
import { signUpSchema } from "./auth-validation";
import { ensureOfficeForUser } from "./offices";

export function createAuth(db: DatabaseSync, settings: { secret: string; baseURL: string; idleSeconds: number; extraOrigins?: string[] }) {
  return betterAuth({
    appName: "K5",
    database: db,
    secret: settings.secret,
    baseURL: settings.baseURL,
    trustedOrigins: [settings.baseURL, ...(settings.extraOrigins ?? [])],
    emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128 },
    user: {
      additionalFields: {
        // Retained to recover office provisioning after an interrupted registration.
        officeName: { type: "string", required: true, validator: { input: z.string().trim().min(2).max(160) } },
      },
    },
    session: {
      expiresIn: settings.idleSeconds,
      updateAge: 0,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 10 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email") {
          const result = signUpSchema.safeParse(ctx.body);
          if (!result.success) throw new APIError("BAD_REQUEST", { code: "INVALID_SIGN_UP", message: "Confira os dados do cadastro." });
          return { context: { body: { ...ctx.body, ...result.data } } };
        }
        if (ctx.path === "/sign-out") {
          const session = await getSessionFromCtx(ctx, { disableCookieCache: true });
          if (session) await ctx.context.internalAdapter.deleteUserSessions(session.user.id);
        }
      }),
    },
    databaseHooks: {
      user: { create: { after: async (user) => {
        ensureOfficeForUser(db, { id: user.id, officeName: (user as typeof user & { officeName: string }).officeName });
      } } },
    },
  });
}
