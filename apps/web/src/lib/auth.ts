import 'server-only';
import type { Pool } from 'pg';
import { createAuth } from './auth-core';
import { databaseBackend, database } from './database';

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 32) throw new Error('Configure BETTER_AUTH_SECRET com pelo menos 32 caracteres. Em dev, execute pnpm db:setup.');
const idleSeconds = Number(process.env.SESSION_IDLE_SECONDS ?? 28800);
if (!Number.isInteger(idleSeconds) || idleSeconds < 60) throw new Error('SESSION_IDLE_SECONDS deve ser um inteiro de pelo menos 60 segundos.');
const settings = {
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
