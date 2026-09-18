import "server-only";

import { VaultHttpError } from "@/lib/vault";

export function vaultErrorResponse(error: unknown) {
  if (error instanceof VaultHttpError) return Response.json({ error: error.message }, { status: error.status });
  console.error("Vault request failed", error);
  return Response.json({ error: "Não foi possível concluir esta operação." }, { status: 500 });
}
