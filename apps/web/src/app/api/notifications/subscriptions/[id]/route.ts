import { apiError, apiPersonalWorkspace } from '@/lib/workspace-api';
import { revokePushSubscription } from '@/lib/application/notifications-service';
import { noStore } from '@/lib/notifications/repository';
import { workspaceContext } from '@/lib/application/context';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspace = await apiPersonalWorkspace(request, true);
    const { id } = await params;
    return noStore(Response.json({ revoked: await revokePushSubscription(workspaceContext(workspace), id) }));
  } catch (error) { return noStore(apiError(error)); }
}
