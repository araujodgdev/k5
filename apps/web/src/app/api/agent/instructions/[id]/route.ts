import { z } from 'zod';
import { apiPersonalWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { deleteInstruction, instructionBody, saveInstruction } from '@/lib/agent-instructions';

export const runtime = 'nodejs';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = workspaceContext(await apiPersonalWorkspace(request, true));
    const { scope, version, ...input } = instructionBody.extend({ version: z.number().int().min(1) }).parse(await limitedJson(request, 32_000));
    return Response.json({ instruction: await saveInstruction(context, scope, input, { id: (await params).id, version }) });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = workspaceContext(await apiPersonalWorkspace(request, true));
    const scope = z.enum(['office', 'personal']).parse(new URL(request.url).searchParams.get('scope'));
    await deleteInstruction(context, scope, (await params).id);
    return new Response(null, { status: 204 });
  } catch (error) { return apiError(error); }
}
