import { ApiError, apiError, apiPersonalWorkspace } from '@/lib/workspace-api';
import { resolveNotificationDestination } from '@/lib/application/notifications-service';
import { workspaceContext } from '@/lib/application/context';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspace = await apiPersonalWorkspace(request);
    const { id } = await params;
    const path = await resolveNotificationDestination(workspaceContext(workspace), id);
    return Response.redirect(new URL(path ?? '/app/notifications', request.url), 303);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return Response.redirect(new URL('/sign-in?returnTo=%2Fapp%2Fnotifications', request.url), 303);
    }
    return apiError(error);
  }
}
