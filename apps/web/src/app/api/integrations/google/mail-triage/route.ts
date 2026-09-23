import { workspaceContext } from '@/lib/application/context';
import { apiError, apiPersonalWorkspace, limitedJson } from '@/lib/workspace-api';
import { triageMail } from '@/lib/google/gmail/triage';

export async function POST(request: Request) {
  try {
    const workspace = await apiPersonalWorkspace(request, true);
    const result = await triageMail({ ...workspaceContext(workspace), signal: request.signal }, await limitedJson(request, 8_000));
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const response = apiError(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
