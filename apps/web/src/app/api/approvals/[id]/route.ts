import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { getApprovalProposal, approveProposal, rejectProposal, publicApproval } from '@/lib/application/approvals-service';
import { z } from 'zod';
import { googleApprovalReview } from '@/lib/google/approval-review';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const workspace = await apiWorkspace(request);
    const id = (await context.params).id;
    const proposal = await getApprovalProposal(workspaceContext(workspace), id);
    return Response.json({ proposal: publicApproval(proposal), review: googleApprovalReview(proposal) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const workspace = await apiWorkspace(request, true);
    const id = (await context.params).id;
    const body = z.object({ action: z.enum(['approve', 'reject']) }).parse(await limitedJson(request));

    const ctx = workspaceContext(workspace);
    const result = body.action === 'approve' ? await approveProposal(ctx, id) : await rejectProposal(ctx, id);
    return Response.json({ proposal: publicApproval(result) });
  } catch (error) { return apiError(error); }
}
