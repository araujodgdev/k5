import { apiPersonalWorkspace, apiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { refreshInbox } from '@/lib/whatsapp/history';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const context = workspaceContext(await apiPersonalWorkspace(request, true));
    return Response.json(await refreshInbox(context), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
