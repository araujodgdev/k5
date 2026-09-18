import { database } from '@/lib/database';
import { apiWorkspace, apiError } from '@/lib/workspace-api';
import { createConversation } from '@/lib/ai-store';

export async function GET(request: Request) {
  try {
    const { user, office } = await apiWorkspace(request);
    const conversations = database.prepare('SELECT id,title,updated_at AS updatedAt FROM ai_conversation WHERE office_id=? AND user_id=? ORDER BY updated_at DESC LIMIT 100').all(office.officeId, user.id);
    return Response.json({ conversations });
  } catch (e) { return apiError(e); }
}
export async function POST(request: Request) {
  try {
    const { user, office } = await apiWorkspace(request, true);
    return Response.json({ conversation: createConversation(database, { officeId: office.officeId, userId: user.id }) }, { status: 201 });
  } catch (e) { return apiError(e); }
}
