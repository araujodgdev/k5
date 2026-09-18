import { apiWorkspace, apiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { endGlobalSession } from '@/lib/application/ui-service';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const workspace = await apiWorkspace(request);
    const result = endGlobalSession(workspaceContext(workspace));
    return Response.json(result);
  } catch (error) { return apiError(error); }
}
