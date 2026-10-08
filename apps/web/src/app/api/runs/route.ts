import { z } from 'zod';
import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { runInputSchema } from '@/lib/document-workflows';
import { workspaceContext } from '@/lib/application/context';
import { listRuns, startRun } from '@/lib/application/runs-service';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const workspace = await apiWorkspace(request);
    const context = workspaceContext(workspace);
    const url = new URL(request.url);
    const limit = z.coerce.number().int().min(1).max(100).default(100).parse(url.searchParams.get('limit') || undefined);
    return Response.json(await listRuns(context, { limit }));
  } catch (e) { return apiError(e); }
}

export async function POST(request: Request) {
  try {
    const workspace = await apiWorkspace(request, true);
    const input = runInputSchema.parse(await limitedJson(request));
    const context = workspaceContext(workspace);
    const result = await startRun(context, input);
    return Response.json(result, { status: 202 });
  } catch (e) { return apiError(e); }
}
