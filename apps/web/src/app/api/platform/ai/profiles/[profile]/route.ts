import { AiConnectionError } from "@/lib/ai-connections-core";
import { isAiProfile, profileOverrideSchema } from "@/lib/ai-profiles";
import { updateProfileOverride } from "@/lib/ai-profiles-core";
import { readPlatformJson } from "@/lib/platform-core";
import { requirePlatformRequest } from "@/lib/platform";
import { platformErrorResponse } from "../../../_shared";

export async function PATCH(request: Request, context: RouteContext<"/api/platform/ai/profiles/[profile]">) {
  try {
    const { db, user } = await requirePlatformRequest(request, { mutation: true });
    const { profile } = await context.params;
    if (!isAiProfile(profile)) throw new AiConnectionError("not_found", "Etapa não encontrada.");
    const patch = await readPlatformJson(request, profileOverrideSchema);
    return Response.json({ profile: await updateProfileOverride(db, user.id, profile, patch) });
  } catch (error) { return platformErrorResponse(error); }
}
