import "server-only";
import { createAuth } from "./auth-core";
import { database } from "./database";

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 32) throw new Error("Configure BETTER_AUTH_SECRET com pelo menos 32 caracteres. Em dev, execute pnpm db:setup.");
const idleSeconds = Number(process.env.SESSION_IDLE_SECONDS ?? 28800);
if (!Number.isInteger(idleSeconds) || idleSeconds < 60) throw new Error("SESSION_IDLE_SECONDS deve ser um inteiro de pelo menos 60 segundos.");

export const auth = createAuth(database, {
  secret,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  idleSeconds,
  // Comma-separated extra origins, e.g. a dev tunnel URL.
  extraOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean),
});
