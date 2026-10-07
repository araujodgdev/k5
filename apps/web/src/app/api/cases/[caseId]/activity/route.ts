import { apiPersonalWorkspace, apiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { caseActivity } from '@/lib/case-collaboration';
export async function GET(request: Request, context: { params: Promise<{ caseId: string }> }) {
  try { const workspace=await apiPersonalWorkspace(request); return Response.json(await caseActivity(workspaceContext(workspace),(await context.params).caseId),{headers:{'Cache-Control':'private, no-store'}}); }
  catch(error) { return apiError(error); }
}
