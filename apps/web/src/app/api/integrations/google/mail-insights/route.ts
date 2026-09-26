import { workspaceContext } from '@/lib/application/context';
import { apiError, apiPersonalWorkspace, limitedJson } from '@/lib/workspace-api';
import { emailInsight } from '@/lib/google/gmail/insights';

/** Smart options of the e-mail module: a period overview, or one conversation's overview and replies. */
export async function POST(request: Request) {
  try {
    const workspace = await apiPersonalWorkspace(request, true);
    const result = await emailInsight({ ...workspaceContext(workspace), signal: request.signal }, await limitedJson(request, 2_000));
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const response = apiError(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
