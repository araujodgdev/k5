import { apiError, apiPersonalWorkspace, limitedJson } from '@/lib/workspace-api';
import { queueTestNotification, testInput } from '@/lib/application/notifications-service';
import { noStore } from '@/lib/notifications/repository';
import { workspaceContext } from '@/lib/application/context';

export async function POST(request: Request) {
  try {
    const workspace = await apiPersonalWorkspace(request, true);
    const input = testInput.parse(await limitedJson(request, 2_000));
    return noStore(Response.json(await queueTestNotification(workspaceContext(workspace), input.subscriptionId), { status: 202 }));
  } catch (error) { return noStore(apiError(error)); }
}
