import { apiError } from '@/lib/workspace-api';
import { apiClientPortal, portalFileResponse } from '@/lib/client-portal/http';
import { downloadClientFile } from '@/lib/client-portal/service';
export async function GET(request: Request, { params }: { params: Promise<{ accessId: string; fileId: string }> }) {
  try { const context = await apiClientPortal(request); const { accessId, fileId } = await params; return portalFileResponse(await downloadClientFile(context, accessId, fileId)); }
  catch (error) { return apiError(error); }
}
