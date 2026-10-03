import { database } from '@/lib/database';
import { ownedArtifact } from '@/lib/ai-store';
import { apiWorkspace, apiError, ApiError, limitedJson } from '@/lib/workspace-api';
import { humanChecklist, decideHumanReview } from '@/lib/document-human-review';
import { humanReviewInput } from '@/lib/document-human-review-contract';

type Context = { params: Promise<{ id: string }> };
async function owned(request: Request, context: Context, write: boolean) {
  const { office, user } = await apiWorkspace(request, write);
  const owner = { officeId: office.officeId, userId: user.id };
  const artifact = await ownedArtifact(database, owner, (await context.params).id);
  if (!artifact) throw new ApiError(404, 'Documento não encontrado.');
  return { owner, artifact };
}
export async function GET(request: Request, context: Context) {
  try { const { owner, artifact } = await owned(request, context, false); return Response.json(await humanChecklist(owner, artifact), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return apiError(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const { owner, artifact } = await owned(request, context, true);
    const parsed = humanReviewInput.safeParse(await limitedJson(request));
    if (!parsed.success) throw new ApiError(400, 'Decisão de revisão inválida.');
    return Response.json(await decideHumanReview(owner, artifact, parsed.data));
  } catch (error) { return apiError(error); }
}
