import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { proposePageWrite, publishPage } from '@/lib/case-pages/service';
import { pagePublication } from '@/lib/case-pages/contracts';
import { approveProposal, getApprovalProposal } from '@/lib/application/approvals-service';
import { CapabilityError } from '@/lib/capabilities/errors';

export async function POST(request: Request, route: { params: Promise<{ caseId: string }> }) {
  try {
    const context = workspaceContext(await apiWorkspace(request, true));
    const input = pagePublication.parse({ ...await limitedJson(request) as object, ...await route.params });
    if (!input.approvalId) {
      return Response.json(await proposePageWrite(context, 'k5_case_pages_publish', input), { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const row = await getApprovalProposal(context, input.approvalId);
    if (row.capability_name !== 'k5_case_pages_publish') throw new CapabilityError('FORBIDDEN', 'Confirmação inválida.');
    if (row.status === 'pending') await approveProposal(context, input.approvalId);
    return Response.json(await publishPage(context, input), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}
