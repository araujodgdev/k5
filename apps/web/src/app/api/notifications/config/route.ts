import { apiError, apiPersonalWorkspace } from '@/lib/workspace-api';
import { getNotificationPreferences, pushConfigurationView } from '@/lib/application/notifications-service';
import { noStore } from '@/lib/notifications/repository';
import { workspaceContext } from '@/lib/application/context';

export async function GET(request: Request) {
  try {
    const workspace = await apiPersonalWorkspace(request);
    return noStore(Response.json({
      ...pushConfigurationView(),
      authorizationGeneration: (await getNotificationPreferences(workspaceContext(workspace))).authorizationGeneration,
    }));
  } catch (error) { return noStore(apiError(error)); }
}
