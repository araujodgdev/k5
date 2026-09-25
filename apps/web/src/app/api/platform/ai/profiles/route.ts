import { listProfileOverrides } from "@/lib/ai-profiles-core";
import { requirePlatformRequest } from "@/lib/platform";
import { platformErrorResponse } from "../../_shared";

/** Per-step model settings of the Lume; a step without settings inherits its task's model. */
export async function GET(request: Request) {
  try {
    const { db } = await requirePlatformRequest(request);
    return Response.json({ profiles: await listProfileOverrides(db) });
  } catch (error) { return platformErrorResponse(error); }
}
