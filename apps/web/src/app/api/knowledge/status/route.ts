import { apiWorkspace, apiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { getKnowledgeIndexStatus } from '@/lib/application/knowledge-service';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const workspace = await apiWorkspace(request);
    const url = new URL(request.url);
    const documentId = url.searchParams.get('documentId');
    if (!documentId) {
      return Response.json({ error: 'Informe o identificador do documento (documentId).' }, { status: 400 });
    }
    const result = getKnowledgeIndexStatus(workspaceContext(workspace), { documentId });
    return Response.json(result);
  } catch (error) { return apiError(error); }
}
