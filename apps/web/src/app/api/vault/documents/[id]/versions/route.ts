import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { addDocumentVersion } from '@/lib/application/vault-service';
import { z } from 'zod';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const workspace = await apiWorkspace(request, true);
    const documentId = (await context.params).id;
    const body = z.object({ uploadRef: z.string().min(1) }).parse(await limitedJson(request));
    const result = addDocumentVersion(workspaceContext(workspace), { documentId, uploadRef: body.uploadRef });
    return Response.json(result, { status: 201 });
  } catch (error) { return apiError(error); }
}
