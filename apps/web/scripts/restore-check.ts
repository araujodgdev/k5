import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Operator tool for the restore drill (docs/restauracao-ensaiada.md). It reads the restored copy
// named by K5_ENV_FILE (DATABASE_URL, R2_* or VAULT_STORAGE_PATH, K5_CREDENTIALS_KEY) and never writes.
const envFile = resolve(process.env.K5_ENV_FILE ?? ".env.restore");
if (!existsSync(envFile)) {
  console.error(`Arquivo de ambiente não encontrado: ${envFile}. Crie-o a partir do runbook (docs/restauracao-ensaiada.md).`);
  process.exit(1);
}
process.loadEnvFile(envFile);

const args = process.argv.slice(2);
const option = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const sample = option("--sample") === "all" ? 0 : Number(option("--sample") ?? 200);
if (!Number.isInteger(sample) || sample < 0) { console.error("Uso: pnpm restore:check [--sample <n>|all]"); process.exit(1); }

async function main() {
  const { database } = await import("../src/lib/database");
  const { objectStorage } = await import("../src/lib/storage");
  const { parseCredentialKeyring } = await import("../src/lib/platform-crypto");
  const { restoreCheck } = await import("../src/lib/restore-check");
  let keyring = null;
  try { keyring = parseCredentialKeyring(); } catch { console.error("K5_CREDENTIALS_KEY ausente ou inválida: as credenciais vão aparecer como falhas."); }
  const report = await restoreCheck({ database, storage: await objectStorage(), keyring, migrations: resolve("db/postgres"), sample });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main().then(() => process.exit(0), error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
