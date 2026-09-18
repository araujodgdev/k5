import { apiWorkspace, apiError, ApiError } from '@/lib/workspace-api';
import { selectedSources } from '@/lib/ai-sources';
import { citationCandidates } from '@/lib/ai-policy';
export async function GET(request: Request) {
  try {
    const { office } = await apiWorkspace(request);
    const id = new URL(request.url).searchParams.get('documentId');
    if (!id) throw new ApiError(400, 'Selecione um documento.');
    return Response.json({ candidates: citationCandidates(selectedSources(office.officeId, [id])) });
  } catch (e) { return apiError(e); }
}
