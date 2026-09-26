import { database } from '@/lib/database';
import { apiWorkspace, apiError, ApiError } from '@/lib/workspace-api';
import { chatRunResponse, followChatRun } from '@/lib/chat-run';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };

/**
 * Reconnects a reopened page to the turn still running in this conversation. `last` is the newest
 * message the page shows; when that is already the finished answer there is nothing to replay (204).
 */
export async function GET(request: Request, context: Context) {
  try {
    const { user, office } = await apiWorkspace(request);
    const id = (await context.params).id;
    const owned = await database.prepare('SELECT 1 AS found FROM ai_conversation WHERE id=? AND office_id=? AND user_id=?').get(id, office.officeId, user.id);
    if (!owned) throw new ApiError(404, 'Conversa não encontrada.');
    const last = new URL(request.url).searchParams.get('last')?.slice(0, 128) || undefined;
    const stream = await followChatRun(id, last);
    return stream ? chatRunResponse(stream) : new Response(null, { status: 204 });
  } catch (e) { return apiError(e); }
}
