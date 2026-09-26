import { database } from '@/lib/database';
import { apiWorkspace, apiError, ApiError } from '@/lib/workspace-api';
import { cancelChatRun } from '@/lib/chat-run';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };

/** Parar: the only way a turn ends early now that closing the page leaves it running. */
export async function POST(request: Request, context: Context) {
  try {
    const { user, office } = await apiWorkspace(request, true);
    const id = (await context.params).id;
    const owned = await database.prepare('SELECT 1 AS found FROM ai_conversation WHERE id=? AND office_id=? AND user_id=?').get(id, office.officeId, user.id);
    if (!owned) throw new ApiError(404, 'Conversa não encontrada.');
    return Response.json({ stopped: await cancelChatRun(id) });
  } catch (e) { return apiError(e); }
}
