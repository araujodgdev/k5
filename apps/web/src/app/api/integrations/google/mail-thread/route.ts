import { z } from 'zod';
import { workspaceContext } from '@/lib/application/context';
import { apiError, apiPersonalWorkspace, limitedJson } from '@/lib/workspace-api';
import { getThreadForReading } from '@/lib/google/gmail/service';

const input = z.object({ threadId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/) }).strict();

/** The reader's thread, with each message's HTML for the sandboxed frame. Not an agent capability. */
export async function POST(request: Request) {
  try {
    const workspace = await apiPersonalWorkspace(request, true);
    const { threadId } = input.parse(await limitedJson(request, 2_000));
    const result = await getThreadForReading({ ...workspaceContext(workspace), signal: request.signal }, threadId);
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const response = apiError(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
