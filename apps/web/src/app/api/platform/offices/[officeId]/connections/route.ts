import { AiConnectionError, connectionInputSchema, createAiConnection, getOfficeForPlatform, listAiConnections } from "@/lib/ai-connections-core";
import { parseCredentialKeyring } from "@/lib/platform-crypto";
import { readPlatformJson } from "@/lib/platform-core";
import { requirePlatformRequest } from "@/lib/platform";
import { platformErrorResponse } from "../../../_shared";

export async function GET(request: Request, context: RouteContext<"/api/platform/offices/[officeId]/connections">) {
  try {
    const { db } = await requirePlatformRequest(request);
    const { officeId } = await context.params;
    if (!getOfficeForPlatform(db, officeId)) throw new AiConnectionError("not_found", "Escritório não encontrado.");
    return Response.json({ connections: listAiConnections(db, officeId) });
  } catch (error) { return platformErrorResponse(error); }
}

export async function POST(request: Request, context: RouteContext<"/api/platform/offices/[officeId]/connections">) {
  try {
    const { db, user } = await requirePlatformRequest(request, { mutation: true });
    const { officeId } = await context.params;
    const input = await readPlatformJson(request, connectionInputSchema);
    const connection = createAiConnection(db, parseCredentialKeyring(), user.id, officeId, input);
    return Response.json({ connection }, { status: 201 });
  } catch (error) { return platformErrorResponse(error); }
}
