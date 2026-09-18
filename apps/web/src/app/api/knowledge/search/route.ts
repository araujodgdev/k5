import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { searchKnowledge } from '@/lib/application/knowledge-service';
import { capabilities } from '@/lib/capabilities/contracts';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const workspace = await apiWorkspace(request);
    const body = capabilities.k5_knowledge_search.input.parse(await limitedJson(request));
    const context = workspaceContext(workspace);
    const result = searchKnowledge(context, body);
    return Response.json(result);
  } catch (e) {
    return apiError(e);
  }
}
