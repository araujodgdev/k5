import { z } from 'zod';
import { apiPersonalWorkspace, apiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { caseHonorarios } from '@/lib/case-collaboration';
export async function GET(request: Request, context: { params: Promise<{ caseId: string }> }) {
  try {
    const workspace=await apiPersonalWorkspace(request),url=new URL(request.url);
    const query=z.object({view:z.enum(['pending','received','cancelled']).default('pending'),offset:z.coerce.number().int().nonnegative().default(0)})
      .parse(Object.fromEntries(url.searchParams));
    return Response.json(await caseHonorarios(workspaceContext(workspace),(await context.params).caseId,query),{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) { return apiError(error); }
}
