import { apiWorkspace, apiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { approvalPreview } from '@/lib/case-pages/service';
import { getApprovalProposal } from '@/lib/application/approvals-service';
import { researchApprovalPreview } from '@/lib/research/case-content';

export async function GET(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const context = workspaceContext(await apiWorkspace(request));
    const id = (await route.params).id;
    const row = await getApprovalProposal(context,id);
    return Response.json(await (row.capability_name.startsWith('k5_research_') ? researchApprovalPreview(context,id) : approvalPreview(context,id)), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}
