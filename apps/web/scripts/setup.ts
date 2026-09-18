import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, readdirSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { getMigrations } from "better-auth/db/migration";

async function main() {
  const envFile = resolve(".env.local");
  if (!existsSync(envFile) && !process.env.BETTER_AUTH_SECRET) {
    if (process.env.NODE_ENV === "production") throw new Error("Configure as variáveis de ambiente antes de preparar o banco em produção.");
    writeFileSync(envFile, `BETTER_AUTH_URL=http://localhost:3000\nBETTER_AUTH_SECRET=${randomBytes(48).toString("base64url")}\nDATABASE_PATH=.data/k5.sqlite\nSESSION_IDLE_SECONDS=28800\n`, { mode: 0o600 });
    console.log("Ambiente local criado com segredo aleatório.");
  }
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  if (!process.env.K5_CREDENTIALS_KEY && process.env.NODE_ENV !== 'production') {
    const key = randomBytes(32).toString('base64');
    appendFileSync(envFile, `\nK5_CREDENTIALS_KEY=${key}\n`, { mode: 0o600 });
    process.env.K5_CREDENTIALS_KEY = key;
    console.log('Chave local de criptografia criada. Preserve seu backup junto aos dados.');
  }
  const { database } = await import("../src/lib/database");
  const { createAuth } = await import("../src/lib/auth-core");
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Defina BETTER_AUTH_SECRET com pelo menos 32 caracteres.");
  const auth = createAuth(database, { secret, baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000", idleSeconds: Number(process.env.SESSION_IDLE_SECONDS ?? 28800) });
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  // Each file runs once and is recorded; rebuild migrations cannot be replayed over their own result.
  database.exec('CREATE TABLE IF NOT EXISTS schema_migration (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const applied = new Set(database.prepare('SELECT name FROM schema_migration').all().map(row => String(row.name)));
  for (const name of readdirSync(resolve('db/migrations')).filter(name => name.endsWith('.sql')).sort()) {
    if (applied.has(name)) continue;
    database.exec(readFileSync(resolve('db/migrations', name), 'utf8'));
    database.prepare('INSERT INTO schema_migration (name) VALUES (?)').run(name);
  }
  console.log("SQLite pronto: autenticação, escritórios e vínculos de acesso.");
  try {
    const { parseCredentialKeyring } = await import("../src/lib/platform-crypto");
    const { countSecretsNeedingReencryption } = await import("../src/lib/ai-connections-core");
    const pending = countSecretsNeedingReencryption(database, parseCredentialKeyring());
    if (pending) console.log(`${pending} credenciais de IA usam uma chave mestra anterior. Execute pnpm platform:admin rotate-key --email <administrador>.`);
  } catch {
    console.log("Não foi possível verificar a chave mestra das credenciais de IA. Confira K5_CREDENTIALS_KEY e K5_CREDENTIALS_PREVIOUS_KEYS.");
  }
  database.close();
}

main().catch(() => {
  console.error("Não foi possível preparar o banco. Confira as variáveis de ambiente e a permissão de escrita em DATABASE_PATH.");
  process.exitCode = 1;
});
