import { z } from 'zod';
import { apiPersonalWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { knowledgeBody, removeKnowledge, updateKnowledge } from '@/lib/agent-knowledge';

export const runtime = 'nodejs';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = workspaceContext(await apiPersonalWorkspace(request, true));
    const body = knowledgeBody.extend({ version: z.number().int().min(1) }).parse(await limitedJson(request, 8_000));
    return Response.json({ knowledge: await updateKnowledge(context, body.scope, (await params).id, body.version, body.mode, body.note) });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = workspaceContext(await apiPersonalWorkspace(request, true));
    const scope = z.enum(['office', 'personal']).parse(new URL(request.url).searchParams.get('scope'));
    await removeKnowledge(context, scope, (await params).id);
    return new Response(null, { status: 204 });
  } catch (error) { return apiError(error); }
}
