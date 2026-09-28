import { apiError, apiPersonalWorkspace } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { revokeDocumentShare } from '@/lib/personal-chat/shares';
export const runtime = 'nodejs';
export async function DELETE(request: Request, { params }: {
  params: Promise<{
    shareId: string;
  }>;
}) {
  try {
    await revokeDocumentShare(workspaceContext(await apiPersonalWorkspace(request, true)), (await params).shareId);
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
