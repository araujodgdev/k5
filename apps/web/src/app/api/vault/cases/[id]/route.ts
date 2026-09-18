import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { updateCase, deleteCase } from '@/lib/application/vault-service';
import { z } from 'zod';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const workspace = await apiWorkspace(request, true);
    const body = z.object({ name: z.string().trim().min(2).max(180) }).parse(await limitedJson(request));
    const caseId = (await context.params).id;
    const result = updateCase(workspaceContext(workspace), { caseId, name: body.name });
    return Response.json(result);
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const workspace = await apiWorkspace(request, true);
    const caseId = (await context.params).id;
    let body: { targetCaseId?: string; approvalId?: string } = {};
    try {
      body = z.object({ targetCaseId: z.string().optional(), approvalId: z.string().optional() }).parse(await limitedJson(request));
    } catch {
      // Empty body is allowed if no targetCaseId/approvalId yet provided
    }
    const result = deleteCase(workspaceContext(workspace), { caseId, targetCaseId: body.targetCaseId, approvalId: body.approvalId });
    return Response.json(result);
  } catch (error) { return apiError(error); }
}
