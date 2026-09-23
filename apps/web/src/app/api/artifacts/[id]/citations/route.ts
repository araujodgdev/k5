import { database } from '@/lib/database';
import { apiWorkspace, apiError, ApiError } from '@/lib/workspace-api';
import { ownedArtifact } from '@/lib/ai-store';
import { reviewArtifactCitations, storedCitationReview } from '@/lib/citations/artifact-review';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

async function owned(request: Request, context: Context, write: boolean) {
  const { office, user } = await apiWorkspace(request, write);
  const owner = { officeId: office.officeId, userId: user.id };
  const artifact = await ownedArtifact(database, owner, (await context.params).id);
  if (!artifact) throw new ApiError(404, 'Documento não encontrado.');
  return { owner, artifact };
}

/** The latest citation check and the version it ran on, so the page can tell a stale one apart. */
export async function GET(request: Request, context: Context) {
  try {
    const { owner, artifact } = await owned(request, context, false);
    return Response.json({ review: await storedCitationReview(owner, artifact.id), version: artifact.version }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}

/** Checks the current text again, e.g. after the lawyer edited it or added sources. */
export async function POST(request: Request, context: Context) {
  try {
    const { owner, artifact } = await owned(request, context, true);
    await reviewArtifactCitations(owner, artifact, { signal: request.signal });
    return Response.json({ review: await storedCitationReview(owner, artifact.id), version: artifact.version });
  } catch (error) { return apiError(error); }
}
