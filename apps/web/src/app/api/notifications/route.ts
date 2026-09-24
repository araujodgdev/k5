import { apiError, apiPersonalWorkspace } from '@/lib/workspace-api';
import { listNotifications } from '@/lib/application/notifications-service';
import { noStore } from '@/lib/notifications/repository';
import { workspaceContext } from '@/lib/application/context';

export async function GET(request: Request) {
  try {
    const workspace = await apiPersonalWorkspace(request);
    const url = new URL(request.url);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? 25) || 25, 50));
    return noStore(Response.json(await listNotifications(workspaceContext(workspace), {
      unreadOnly: url.searchParams.get('unreadOnly') === 'true',
      archived: url.searchParams.get('archived') === 'true',
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit,
    })));
  } catch (error) { return noStore(apiError(error)); }
}
