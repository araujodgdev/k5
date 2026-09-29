import { delegateTask } from '@/lib/application/task-delegation';
import { workspaceContext } from '@/lib/application/context';
import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';

export async function POST(request: Request) {
  try {
    const workspace = await apiWorkspace(request, true);
    return Response.json(await delegateTask(workspaceContext(workspace), await limitedJson(request, 2_000)), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}
