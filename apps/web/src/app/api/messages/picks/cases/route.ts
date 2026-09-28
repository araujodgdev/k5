import { apiError, apiPersonalWorkspace } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { casePickQuery } from '@/lib/personal-chat/domain';
import { listCasePicks } from '@/lib/personal-chat/shares';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return Response.json(await listCasePicks(workspaceContext(await apiPersonalWorkspace(request)), casePickQuery.parse(Object.fromEntries(url.searchParams))), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
