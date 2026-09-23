import { z } from 'zod';
import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { decideAgentApproval } from '@/lib/application/agent-approvals';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/** Confirmar/Cancelar pressed on an action the Lume proposed in the chat. */
export async function POST(request: Request, context: Context) {
  try {
    const workspace = await apiWorkspace(request, true);
    const { id } = await context.params;
    const body = z.object({ decision: z.enum(['confirm', 'cancel']), conversationId: z.string().max(64).optional() }).parse(await limitedJson(request));
    return Response.json(await decideAgentApproval(workspaceContext(workspace), id, body.decision, body.conversationId));
  } catch (error) { return apiError(error); }
}
