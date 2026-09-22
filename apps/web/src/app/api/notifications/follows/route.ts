import { apiError, apiPersonalWorkspace, limitedJson } from '@/lib/workspace-api';
import { caseFollowInput, getCaseFollowState, setCaseFollowState } from '@/lib/application/notifications-service';
import { noStore } from '@/lib/notifications/repository';
import { workspaceContext } from '@/lib/application/context';

export async function GET(request: Request) {
  try {
    const workspace = await apiPersonalWorkspace(request);
    const caseId = new URL(request.url).searchParams.get('caseId') ?? '';
    const input = caseFollowInput.pick({ caseId: true }).parse({ caseId });
    return noStore(Response.json({ following: await getCaseFollowState(workspaceContext(workspace), input.caseId) }));
  } catch (error) { return noStore(apiError(error)); }
}

export async function PUT(request: Request) {
  try {
    const workspace = await apiPersonalWorkspace(request, true);
    const input = caseFollowInput.parse(await limitedJson(request, 2_000));
    return noStore(Response.json(await setCaseFollowState(workspaceContext(workspace), input.caseId, input.following)));
  } catch (error) { return noStore(apiError(error)); }
}
