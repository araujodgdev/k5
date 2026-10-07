import { apiPersonalWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { getCasePolicy, setCasePolicy } from '@/lib/case-collaboration';
type Context = { params: Promise<{ caseId: string }> };
export async function GET(request: Request, context: Context) {
  try { const workspace=await apiPersonalWorkspace(request); return Response.json(await getCasePolicy(workspaceContext(workspace),(await context.params).caseId),{headers:{'Cache-Control':'private, no-store'}}); }
  catch(error) { return apiError(error); }
}
export async function PUT(request: Request, context: Context) {
  try { const workspace=await apiPersonalWorkspace(request,true); return Response.json(await setCasePolicy(workspaceContext(workspace),(await context.params).caseId,await limitedJson(request,2000)),{headers:{'Cache-Control':'private, no-store'}}); }
  catch(error) { return apiError(error); }
}
