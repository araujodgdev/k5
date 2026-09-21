import { listOfficesForPlatform } from "@/lib/ai-connections-core";
import { requirePlatformRequest } from "@/lib/platform";
import { platformErrorResponse } from "../_shared";

export async function GET(request: Request) {
  try {
    const { db } = await requirePlatformRequest(request);
    return Response.json({ offices: await listOfficesForPlatform(db) });
  } catch (error) { return platformErrorResponse(error); }
}
