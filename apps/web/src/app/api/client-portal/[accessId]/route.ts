import { apiError } from '@/lib/workspace-api';
import { apiClientPortal } from '@/lib/client-portal/http';
import { clientPortal } from '@/lib/client-portal/service';
export async function GET(request: Request, { params }: { params: Promise<{ accessId: string }> }) {
  try { return Response.json(await clientPortal(await apiClientPortal(request), (await params).accessId), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return apiError(error); }
}
