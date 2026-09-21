import { apiError, apiPersonalWorkspace } from '@/lib/workspace-api';
import { markNotificationRead } from '@/lib/application/notifications-service';
import { noStore } from '@/lib/notifications/repository';
import { workspaceContext } from '@/lib/application/context';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspace = await apiPersonalWorkspace(request, true);
    const { id } = await params;
    return noStore(Response.json({ updated: await markNotificationRead(workspaceContext(workspace), id) }));
  } catch (error) { return noStore(apiError(error)); }
}
