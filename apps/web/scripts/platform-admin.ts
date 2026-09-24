import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { AiConnectionError, reencryptAiConnectionSecrets } from "../src/lib/ai-connections-core";
import { CredentialKeyError, parseCredentialKeyring } from "../src/lib/platform-crypto";

if (existsSync(resolve(".env.local"))) process.loadEnvFile(resolve(".env.local"));

function usage(): never {
  console.error("Uso: pnpm platform:admin <grant|revoke|rotate-key> <--email endereco|--id usuario>");
  console.error("rotate-key recriptografa as credenciais com K5_CREDENTIALS_KEY; o usuário informado deve ser administrador da plataforma.");
  process.exit(1);
}

async function main() {
  const [action, flag, value, ...extra] = process.argv.slice(2);
  if (!(["grant", "revoke", "rotate-key"].includes(action)) || !(["--email", "--id"].includes(flag)) || !value || extra.length) usage();
  const { database } = await import("../src/lib/database");
  const { findUserForPlatformGrant, grantPlatformAdmin, isPlatformAdmin, revokePlatformAdmin } = await import("../src/lib/platform-core");

  const user = await findUserForPlatformGrant(database, flag === "--email" ? { email: value } : { id: value });
  if (!user) {
    console.error("Usuário não encontrado. O administrador deve ser um usuário já cadastrado.");
    process.exit(1);
  }

  if (action === "rotate-key") {
    if (!await isPlatformAdmin(database, user.id)) {
      console.error("A rotação exige um administrador da plataforma como responsável.");
      process.exit(1);
    }
    const result = await reencryptAiConnectionSecrets(database, parseCredentialKeyring(), user.id);
    const { reencryptGoogleSecrets } = await import('../src/lib/google/connections');
    const google = await reencryptGoogleSecrets(database, parseCredentialKeyring());
    console.log(`Chave ativa ${result.keyId}: ${result.reencrypted} de ${result.total} credenciais recriptografadas.`);
    console.log(`Google: ${google} registros recriptografados.`);
    if (process.env.K5_CREDENTIALS_PREVIOUS_KEYS) console.log("Após validar as conexões, remova K5_CREDENTIALS_PREVIOUS_KEYS do ambiente.");
    return;
  }

  const changed = action === "grant" ? await grantPlatformAdmin(database, user.id) : await revokePlatformAdmin(database, user.id);
  console.log(changed
    ? `${action === "grant" ? "Acesso concedido" : "Acesso revogado"}: ${user.email} (${user.id})`
    : `Nenhuma alteração: ${user.email} (${user.id})`);
}

main().catch((error) => {
  // Only fixed, secret-free messages are printed.
  const known = error instanceof CredentialKeyError || error instanceof AiConnectionError;
  console.error(known ? error.message : "Não foi possível concluir a operação. Nenhuma credencial foi alterada.");
  process.exitCode = 1;
});
