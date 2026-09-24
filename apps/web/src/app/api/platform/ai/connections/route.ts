import { connectionInputSchema, createAiConnection, listAiConnections } from "@/lib/ai-connections-core";
import { parseCredentialKeyring } from "@/lib/platform-crypto";
import { readPlatformJson } from "@/lib/platform-core";
import { requirePlatformRequest } from "@/lib/platform";
import { platformErrorResponse } from "../../_shared";

/** The platform's AI connections: one configuration serves every office. */
export async function GET(request: Request) {
  try {
    const { db } = await requirePlatformRequest(request);
    return Response.json({ connections: await listAiConnections(db) });
  } catch (error) { return platformErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await requirePlatformRequest(request, { mutation: true });
    const input = await readPlatformJson(request, connectionInputSchema);
    const connection = await createAiConnection(db, parseCredentialKeyring(), user.id, input);
    return Response.json({ connection }, { status: 201 });
  } catch (error) { return platformErrorResponse(error); }
}
