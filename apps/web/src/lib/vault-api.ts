import "server-only";

import { VaultHttpError } from "@/lib/vault";
import { captureOperationalError } from "@/lib/observability/report";

export function vaultErrorResponse(error: unknown) {
  if (error instanceof VaultHttpError) {
    if (error.status >= 500) captureOperationalError(error, 'vault.api.operational');
    return Response.json({ error: error.message }, { status: error.status });
  }
  captureOperationalError(error, 'vault.api.unhandled');
  return Response.json({ error: "Não foi possível concluir esta operação." }, { status: 500 });
}
