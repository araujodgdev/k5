import { connectionPatchSchema, deleteAiConnection, updateAiConnection } from "@/lib/ai-connections-core";
import { parseCredentialKeyring } from "@/lib/platform-crypto";
import { readPlatformJson } from "@/lib/platform-core";
import { requirePlatformRequest } from "@/lib/platform";
import { platformErrorResponse } from "../../../../_shared";

export async function PATCH(request: Request, context: RouteContext<"/api/platform/offices/[officeId]/connections/[connectionId]">) {
  try {
    const { db, user } = await requirePlatformRequest(request, { mutation: true });
    const { officeId, connectionId } = await context.params;
    const patch = await readPlatformJson(request, connectionPatchSchema);
    return Response.json({ connection: await updateAiConnection(db, parseCredentialKeyring(), user.id, officeId, connectionId, patch) });
  } catch (error) { return platformErrorResponse(error); }
}

export async function DELETE(request: Request, context: RouteContext<"/api/platform/offices/[officeId]/connections/[connectionId]">) {
  try {
    const { db, user } = await requirePlatformRequest(request, { mutation: true });
    const { officeId, connectionId } = await context.params;
    await deleteAiConnection(db, user.id, officeId, connectionId);
    return new Response(null, { status: 204 });
  } catch (error) { return platformErrorResponse(error); }
}
