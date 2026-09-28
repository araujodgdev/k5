import { apiPersonalWorkspace, apiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { whatsappStatus } from '@/lib/whatsapp/connection';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const context = workspaceContext(await apiPersonalWorkspace(request));
    return Response.json(await whatsappStatus(context), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
