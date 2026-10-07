import { apiPersonalWorkspace, apiError } from '@/lib/workspace-api';
import { caseArtifacts } from '@/lib/case-artifacts';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, office } = await apiPersonalWorkspace(request);
    const { id } = await context.params;
    return Response.json({ artifacts: await caseArtifacts({ userId: user.id, officeId: office.officeId }, id) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}
