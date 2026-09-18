import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { restoreArtifactVersion } from '@/lib/application/artifacts-service';
import { z } from 'zod';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const workspace = await apiWorkspace(request, true);
    const artifactId = (await context.params).id;
    const body = z.object({ version: z.number().int().positive() }).parse(await limitedJson(request));
    const result = restoreArtifactVersion(workspaceContext(workspace), { artifactId, version: body.version });
    return Response.json(result);
  } catch (error) { return apiError(error); }
}
