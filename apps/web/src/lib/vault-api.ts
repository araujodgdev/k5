import "server-only";

import { CapabilityError, statusForCapabilityError } from "@/lib/capabilities/errors";
import { VaultHttpError } from "@/lib/vault";
import { captureOperationalError } from "@/lib/observability/report";

export function vaultErrorResponse(error: unknown) {
  if (error instanceof VaultHttpError) {
    if (error.status >= 500) captureOperationalError(error, 'vault.api.operational');
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof CapabilityError) return Response.json({ error: error.message, code: error.code }, { status: statusForCapabilityError(error) });
  captureOperationalError(error, 'vault.api.unhandled');
  return Response.json({ error: "Não foi possível concluir esta operação." }, { status: 500 });
}
