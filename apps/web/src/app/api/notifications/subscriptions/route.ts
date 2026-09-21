import { apiError, apiPersonalWorkspace, limitedJson } from '@/lib/workspace-api';
import { listPushSubscriptions, pushSubscriptionInput, registerPushSubscription } from '@/lib/application/notifications-service';
import { noStore } from '@/lib/notifications/repository';
import { workspaceContext } from '@/lib/application/context';

export async function GET(request: Request) {
  try {
    const workspace = await apiPersonalWorkspace(request);
    return noStore(Response.json({ subscriptions: await listPushSubscriptions(workspaceContext(workspace)) }));
  } catch (error) { return noStore(apiError(error)); }
}

export async function POST(request: Request) {
  try {
    const workspace = await apiPersonalWorkspace(request, true);
    const input = pushSubscriptionInput.parse(await limitedJson(request, 10_000));
    return noStore(Response.json(await registerPushSubscription(workspaceContext(workspace), input)));
  } catch (error) { return noStore(apiError(error)); }
}
