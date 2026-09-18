import { apiWorkspace, apiError } from "@/lib/workspace-api";
import { listOfficeAvailableModels } from "@/lib/ai-connections";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { office } = await apiWorkspace(request, false);
    const models = listOfficeAvailableModels(office.officeId);
    return Response.json({
      models,
      defaultModel: models.find((m) => m.isDefault) ?? models[0] ?? null,
    });
  } catch (error) {
    return apiError(error);
  }
}
