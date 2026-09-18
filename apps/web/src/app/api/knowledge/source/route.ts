import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { getKnowledgeSource } from '@/lib/application/knowledge-service';
import { z } from 'zod';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const workspace = await apiWorkspace(request);
    const url = new URL(request.url);
    const documentId = url.searchParams.get('documentId');
    const stableReference = url.searchParams.get('stableReference');
    if (!documentId || !stableReference) {
      return Response.json({ error: 'Informe documentId e stableReference.' }, { status: 400 });
    }
    const result = getKnowledgeSource(workspaceContext(workspace), { documentId, stableReference });
    return Response.json(result);
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const workspace = await apiWorkspace(request);
    const body = z.object({
      documentId: z.string().min(1),
      stableReference: z.string().min(1),
    }).parse(await limitedJson(request));
    const result = getKnowledgeSource(workspaceContext(workspace), body);
    return Response.json(result);
  } catch (error) { return apiError(error); }
}
