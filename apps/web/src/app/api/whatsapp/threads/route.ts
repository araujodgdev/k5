import { apiPersonalWorkspace, apiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { listThreads } from '@/lib/whatsapp/history';
import { listInput } from '@/lib/whatsapp/domain';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const context = workspaceContext(await apiPersonalWorkspace(request));
    return Response.json(await listThreads(context, listInput.parse({ ...Object.fromEntries(new URL(request.url).searchParams), limit: Number(new URL(request.url).searchParams.get('limit') ?? 30) })), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
