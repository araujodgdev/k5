import { apiPersonalWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { collaborationAction, collaborationOverview, invitationForToken, invite, respond, changeAccess } from '@/lib/collaboration/service';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
  try {
    const context = workspaceContext(await apiPersonalWorkspace(request));
    const params = new URL(request.url).searchParams;
    const token = params.get('token');
    return Response.json(token ? { invitation: await invitationForToken(context.userId, token) }
      : await collaborationOverview(context, params.get('caseId') ?? undefined), { headers });
  } catch (error) { const result = apiError(error); result.headers.set('Cache-Control', 'private, no-store'); return result; }
}
export async function POST(request: Request) {
  try {
    const context = workspaceContext(await apiPersonalWorkspace(request, true));
    const input = collaborationAction.parse(await limitedJson(request, 8000));
    const result = input.action === 'invite' ? await invite(context, input.invitation)
      : input.action === 'respond' ? await respond(context, input.id, input.accept, input.token)
      : await changeAccess(context, input);
    return Response.json(result, { headers });
  } catch (error) { const result = apiError(error); result.headers.set('Cache-Control', 'private, no-store'); return result; }
}
