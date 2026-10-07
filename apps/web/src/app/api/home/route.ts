import { z } from 'zod';
import { apiPersonalWorkspace, apiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { homeOverview } from '@/lib/home-overview';

export async function GET(request: Request) {
  try {
    const workspace = await apiPersonalWorkspace(request);
    const today = z.iso.date().parse(new URL(request.url).searchParams.get('today'));
    return Response.json(await homeOverview(workspaceContext(workspace), today), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}
