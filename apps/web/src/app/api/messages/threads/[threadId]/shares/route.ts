import { apiError, apiPersonalWorkspace, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { apiPerson } from '@/lib/personal-chat/auth';
import { createShareInput } from '@/lib/personal-chat/domain';
import { createShare } from '@/lib/personal-chat/shares';
export const runtime = 'nodejs';
export async function POST(request: Request, { params }: {
  params: Promise<{
    threadId: string;
  }>;
}) {
  try {
    const [person, workspace] = await Promise.all([apiPerson(request, true), apiPersonalWorkspace(request, true)]);
    return Response.json(await createShare(person, workspaceContext(workspace), (await params).threadId, createShareInput.parse(await limitedJson(request, 16000))), { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
