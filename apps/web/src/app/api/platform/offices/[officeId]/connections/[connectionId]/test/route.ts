import { connectionTestSchema, testAiConnection } from "@/lib/ai-connections-core";
import { testModelCredential } from "@/lib/ai-runtime";
import { parseCredentialKeyring } from "@/lib/platform-crypto";
import { readPlatformJson } from "@/lib/platform-core";
import { requirePlatformRequest } from "@/lib/platform";
import { platformErrorResponse } from "../../../../../_shared";

export async function POST(request: Request, context: RouteContext<"/api/platform/offices/[officeId]/connections/[connectionId]/test">) {
  try {
    const { db, user } = await requirePlatformRequest(request, { mutation: true });
    const { officeId, connectionId } = await context.params;
    const { task } = await readPlatformJson(request, connectionTestSchema);
    const result = await testAiConnection(db, parseCredentialKeyring(), user.id, officeId, connectionId, task, testModelCredential);
    return Response.json({ ok: true, ...result });
  } catch (error) { return platformErrorResponse(error); }
}
