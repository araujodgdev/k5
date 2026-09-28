import { apiPersonalWorkspace, apiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { historyInput } from '@/lib/whatsapp/domain';
import { readThread } from '@/lib/whatsapp/history';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = workspaceContext(await apiPersonalWorkspace(request));
    const { id } = await params;
    const query = new URL(request.url).searchParams;
    const input = historyInput.parse({ ...Object.fromEntries(query), threadId: id, limit: Number(query.get('limit') ?? 30) });
    return Response.json(await readThread(context, input), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
