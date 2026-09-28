import { apiError, apiPersonalWorkspace } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { documentPickQuery } from '@/lib/personal-chat/domain';
import { listDocumentPicks } from '@/lib/personal-chat/shares';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return Response.json(await listDocumentPicks(workspaceContext(await apiPersonalWorkspace(request)), documentPickQuery.parse(Object.fromEntries(url.searchParams))), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
