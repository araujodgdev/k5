import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { ingestUpload } from '@/lib/application/vault-service';
import { z } from 'zod';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const workspace = await apiWorkspace(request, true);
    const body = z.object({
      uploadRef: z.string().min(1),
      scope: z.enum(['library', 'case']),
      caseId: z.string().optional(),
    }).parse(await limitedJson(request));
    const result = ingestUpload(workspaceContext(workspace), body);
    return Response.json(result, { status: 201 });
  } catch (error) { return apiError(error); }
}
