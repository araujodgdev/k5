import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { getApprovalProposal, approveProposal, rejectProposal } from '@/lib/application/approvals-service';
import { z } from 'zod';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const workspace = await apiWorkspace(request);
    const id = (await context.params).id;
    const proposal = getApprovalProposal(workspaceContext(workspace), id);
    return Response.json({ proposal });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const workspace = await apiWorkspace(request, true);
    const id = (await context.params).id;
    const body = z.object({ action: z.enum(['approve', 'reject']) }).parse(await limitedJson(request));

    const ctx = workspaceContext(workspace);
    const result = body.action === 'approve' ? approveProposal(ctx, id) : rejectProposal(ctx, id);
    return Response.json({ proposal: result });
  } catch (error) { return apiError(error); }
}
