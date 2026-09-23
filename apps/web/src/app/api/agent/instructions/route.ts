import { apiPersonalWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { canEditInstructions, instructionBody, listInstructions, saveInstruction, INSTRUCTION_BUDGET } from '@/lib/agent-instructions';

export const runtime = 'nodejs';

// Personal rules are personal settings, so reviewers write their own; office rules stay with administrators.
export async function GET(request: Request) {
  try {
    const context = workspaceContext(await apiPersonalWorkspace(request));
    return Response.json({ ...await listInstructions(context), budget: INSTRUCTION_BUDGET, canEditOffice: canEditInstructions(context.role, 'office') });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const context = workspaceContext(await apiPersonalWorkspace(request, true));
    const { scope, ...input } = instructionBody.parse(await limitedJson(request, 32_000));
    return Response.json({ instruction: await saveInstruction(context, scope, input) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
