import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { reindexKnowledge } from '@/lib/application/knowledge-service';
import { z } from 'zod';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const workspace = await apiWorkspace(request, true);
    const body = z.object({ documentId: z.string().min(1) }).parse(await limitedJson(request));
    const result = reindexKnowledge(workspaceContext(workspace), body);
    return Response.json(result);
  } catch (error) { return apiError(error); }
}
