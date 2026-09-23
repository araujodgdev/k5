import "server-only";

import { CapabilityError, statusForCapabilityError } from "@/lib/capabilities/errors";
import { VaultHttpError } from "@/lib/vault";

export function vaultErrorResponse(error: unknown) {
  if (error instanceof VaultHttpError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof CapabilityError) return Response.json({ error: error.message, code: error.code }, { status: statusForCapabilityError(error) });
  console.error("Vault request failed", error);
  return Response.json({ error: "Não foi possível concluir esta operação." }, { status: 500 });
}
