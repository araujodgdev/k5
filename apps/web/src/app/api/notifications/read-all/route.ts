import { apiError, apiPersonalWorkspace, limitedJson } from '@/lib/workspace-api';
import { cutoffInput, markAllNotificationsRead } from '@/lib/application/notifications-service';
import { noStore } from '@/lib/notifications/repository';
import { workspaceContext } from '@/lib/application/context';

export async function POST(request: Request) {
  try {
    const workspace = await apiPersonalWorkspace(request, true);
    const input = cutoffInput.parse(await limitedJson(request, 2_000));
    return noStore(Response.json({ updated: await markAllNotificationsRead(workspaceContext(workspace), input) }));
  } catch (error) { return noStore(apiError(error)); }
}
