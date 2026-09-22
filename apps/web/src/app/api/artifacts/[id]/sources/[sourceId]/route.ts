import { apiWorkspace, apiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { resolveArtifactResearchSource } from '@/lib/ai-sources';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string; sourceId: string }> }) {
  try {
    const workspace = await apiWorkspace(request);
    const { id, sourceId } = await params;
    const source = await resolveArtifactResearchSource(workspaceContext(workspace), id, sourceId);
    return Response.json({ source }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}
