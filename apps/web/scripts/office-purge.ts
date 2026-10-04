import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Operator tool for office deletion requests (docs/exclusao-de-escritorio.md). It connects to the
// database of K5_ENV_FILE (default .env.local); point it at production deliberately.
const envFile = resolve(process.env.K5_ENV_FILE ?? ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

function usage(): never {
  console.error("Uso: pnpm office:purge list | dry-run <pedido> | run <pedido>");
  console.error("run só executa pedidos cujo prazo de cancelamento terminou. Execute dry-run antes.");
  process.exit(1);
}

async function main() {
  const [action, id, ...extra] = process.argv.slice(2);
  if (!["list", "dry-run", "run"].includes(action) || (action !== "list" && !id) || extra.length) usage();
  const { database } = await import("../src/lib/database");
  const { purgeOffice } = await import("../src/lib/office-deletion");

  if (action === "list") {
    const rows = await database.prepare(`SELECT r.id, r.office_id AS "officeId", o.name AS office, r.requested_at AS "requestedAt", r.scheduled_for AS "scheduledFor",
        r.scheduled_for <= CURRENT_TIMESTAMP AS due
      FROM office_deletion_request r LEFT JOIN office o ON o.id = r.office_id WHERE r.status = 'scheduled' ORDER BY r.scheduled_for`).all();
    console.log(rows.length ? JSON.stringify(rows, null, 2) : "Nenhum pedido agendado.");
    return;
  }
  const request = await database.prepare("SELECT scheduled_for <= CURRENT_TIMESTAMP AS due FROM office_deletion_request WHERE id=? AND status='scheduled'").get<{ due: boolean }>(id);
  if (!request) { console.error("Pedido não encontrado ou já encerrado."); process.exit(1); }
  if (action === "run" && !request.due) { console.error("O prazo de cancelamento ainda não terminou."); process.exit(1); }
  const report = await purgeOffice(id, { dryRun: action === "dry-run" });
  console.log(JSON.stringify({ action, ...report }, null, 2));
  if (action === "run") console.log("Concluído. Os originais, vetores e a memória remota saem pelas filas dos processadores; acompanhe vault_deletion_queue e honcho_deletion.");
}

main().then(() => process.exit(0), error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
