import { apiPersonalWorkspace, apiError, ApiError } from '@/lib/workspace-api';
import { conversationCredits } from '@/lib/billing/credits';

export async function GET(request: Request) {
  try {
    const { user, office } = await apiPersonalWorkspace(request);
    const id = new URL(request.url).searchParams.get('conversationId');
    if (!id || id.length > 200) throw new ApiError(400, 'Selecione uma conversa.');
    const result = await conversationCredits({ officeId: office.officeId, userId: user.id }, id);
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const response = apiError(error); response.headers.set('Cache-Control', 'private, no-store'); return response;
  }
}
