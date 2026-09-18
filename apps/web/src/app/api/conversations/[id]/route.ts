import { database } from '@/lib/database';
import { apiWorkspace, apiError, ApiError } from '@/lib/workspace-api';
import { conversation } from '@/lib/ai-store';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { user, office } = await apiWorkspace(request);
    const result = conversation(database, { officeId: office.officeId, userId: user.id }, (await context.params).id);
    if (!result) throw new ApiError(404, 'Conversa não encontrada.');
    return Response.json(result);
  } catch (e) { return apiError(e); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const { user, office } = await apiWorkspace(request, true);
    const id = (await context.params).id;
    const result = database.prepare('DELETE FROM ai_conversation WHERE id=? AND office_id=? AND user_id=? AND busy_until<?').run(id, office.officeId, user.id, Date.now());
    if (!result.changes) throw new ApiError(409, 'Conversa indisponível ou em processamento.');
    return new Response(null, { status: 204 });
  } catch (e) { return apiError(e); }
}
