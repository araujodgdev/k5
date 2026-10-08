import { apiPersonalWorkspace, apiError, ApiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { searchOffice } from '@/lib/office-search';

export async function GET(request: Request) {
  try {
    const workspace = await apiPersonalWorkspace(request);
    const query = new URL(request.url).searchParams.get('q') ?? '';
    if (query.length > 120) throw new ApiError(400,'Busque com até 120 caracteres.');
    return Response.json(await searchOffice({...workspaceContext(workspace),signal:request.signal},query),{headers:{'Cache-Control':'private, no-store'}});
  } catch (error) { const response = apiError(error); response.headers.set('Cache-Control','private, no-store'); return response; }
}
