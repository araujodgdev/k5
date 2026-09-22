import { apiError, apiPersonalWorkspace } from '@/lib/workspace-api';
import { unreadCount } from '@/lib/application/notifications-service';
import { noStore } from '@/lib/notifications/repository';
import { workspaceContext } from '@/lib/application/context';

export async function GET(request: Request) {
  try {
    const workspace = await apiPersonalWorkspace(request);
    return noStore(Response.json({ unread: await unreadCount(workspaceContext(workspace)) }));
  } catch (error) { return noStore(apiError(error)); }
}
