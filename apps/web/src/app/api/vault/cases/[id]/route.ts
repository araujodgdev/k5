import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { deleteCase } from '@/lib/application/vault-service';
import { handleCapability } from '@/lib/capability-route';
import { z } from 'zod';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/** Title, description and the optional client block; anything omitted keeps its stored value. */
export async function PATCH(request: Request, context: Context) {
  return handleCapability(request, 'k5_vault_update_case', { caseId: (await context.params).id });
}

export async function DELETE(request: Request, context: Context) {
  try {
    const workspace = await apiWorkspace(request, true);
    const caseId = (await context.params).id;
    let body: { targetCaseId?: string; approvalId?: string } = {};
    try {
      body = z.object({ targetCaseId: z.string().optional(), approvalId: z.string().optional() }).parse(await limitedJson(request));
    } catch {
      // Empty body is allowed: the caller may not have an approval or a destination case yet.
    }
    const result = deleteCase(workspaceContext(workspace), { caseId, targetCaseId: body.targetCaseId, approvalId: body.approvalId });
    return Response.json(result);
  } catch (error) { return apiError(error); }
}
