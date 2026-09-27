import { assignmentTestSchema, testModelAssignment } from "@/lib/ai-assignments-core";
import { probeTaskModel } from "@/lib/ai-runtime";
import { parseCredentialKeyring } from "@/lib/platform-crypto";
import { readPlatformJson } from "@/lib/platform-core";
import { requirePlatformRequest } from "@/lib/platform";
import { platformErrorResponse } from "../../../_shared";

/** Calls the model a group or task resolves to, the way its tasks do. It may cost a small amount. */
export async function POST(request: Request) {
  try {
    const { db, user } = await requirePlatformRequest(request, { mutation: true });
    const input = await readPlatformJson(request, assignmentTestSchema);
    const result = await testModelAssignment(db, parseCredentialKeyring(), user.id, input, probeTaskModel);
    return Response.json({ ok: true, ...result });
  } catch (error) { return platformErrorResponse(error); }
}
