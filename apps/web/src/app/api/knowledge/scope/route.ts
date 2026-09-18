import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { setScopeSources } from '@/lib/application/knowledge-service';
import { z } from 'zod';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const workspace = await apiWorkspace(request);
    const body = z.object({
      conversationId: z.string().optional(),
      documentIds: z.array(z.string().min(1)).min(1).max(100),
    }).parse(await limitedJson(request));
    const result = setScopeSources(workspaceContext(workspace), body);
    return Response.json(result);
  } catch (error) { return apiError(error); }
}
