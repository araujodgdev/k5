import { assignmentOverview, assignmentUpdateSchema, updateModelAssignment } from "@/lib/ai-assignments-core";
import { readPlatformJson } from "@/lib/platform-core";
import { requirePlatformRequest } from "@/lib/platform";
import { platformErrorResponse } from "../../_shared";

/** Lume's models per group and task: one configuration serves every office. */
export async function GET(request: Request) {
  try {
    const { db } = await requirePlatformRequest(request);
    return Response.json(await assignmentOverview(db));
  } catch (error) { return platformErrorResponse(error); }
}

/** Saves one group's or task's model and effort; answers with the whole overview, since other tasks may follow it. */
export async function PUT(request: Request) {
  try {
    const { db, user } = await requirePlatformRequest(request, { mutation: true });
    const input = await readPlatformJson(request, assignmentUpdateSchema);
    await updateModelAssignment(db, user.id, input);
    return Response.json(await assignmentOverview(db));
  } catch (error) { return platformErrorResponse(error); }
}
