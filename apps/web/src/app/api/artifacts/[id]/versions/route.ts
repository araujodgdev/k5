import { apiWorkspace, apiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { listArtifactVersions } from '@/lib/application/artifacts-service';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const workspace = await apiWorkspace(request);
    const artifactId = (await context.params).id;
    const result = listArtifactVersions(workspaceContext(workspace), { artifactId });
    return Response.json(result);
  } catch (error) { return apiError(error); }
}
