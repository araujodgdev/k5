import { authorizedCanvasResource } from '@/lib/canvas-resources';
import { workspaceContext } from '@/lib/application/context';
import { apiError, apiWorkspace } from '@/lib/workspace-api';

export async function GET(request: Request) {
  try {
    const workspace = await apiWorkspace(request);
    return Response.json({ resource: await authorizedCanvasResource(workspaceContext(workspace), new URL(request.url).searchParams.get('href') ?? '') }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
