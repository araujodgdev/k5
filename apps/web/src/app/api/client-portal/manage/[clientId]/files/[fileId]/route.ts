import { apiWorkspace, apiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { downloadManagedFile } from '@/lib/client-portal/service';
import { portalFileResponse } from '@/lib/client-portal/http';
export async function GET(request: Request, { params }: { params: Promise<{ clientId: string; fileId: string }> }) {
  try { const context = workspaceContext(await apiWorkspace(request)); const { clientId, fileId } = await params; return portalFileResponse(await downloadManagedFile(context, clientId, fileId)); }
  catch (error) { return apiError(error); }
}
