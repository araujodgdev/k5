import { apiWorkspace, apiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { getPage } from '@/lib/case-pages/service';
export async function GET(request: Request, context: { params: Promise<{ caseId: string; pageId: string }> }) {
  try {
    await getPage(workspaceContext(await apiWorkspace(request)), await context.params);
    return Response.json({ typography: null, templateName: null }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}
