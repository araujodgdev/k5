import { z } from 'zod';
import { apiPersonalWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { addKnowledge, canEditKnowledge, knowledgeBody, listKnowledge, ALWAYS_BUDGET } from '@/lib/agent-knowledge';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const context = workspaceContext(await apiPersonalWorkspace(request));
    return Response.json({ ...await listKnowledge(context), budget: ALWAYS_BUDGET, canEditOffice: canEditKnowledge(context.role, 'office') });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const context = workspaceContext(await apiPersonalWorkspace(request, true));
    const body = knowledgeBody.extend({ documentId: z.string().min(1).max(64) }).parse(await limitedJson(request, 8_000));
    return Response.json({ knowledge: await addKnowledge(context, body.scope, body.documentId, body.mode, body.note) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
