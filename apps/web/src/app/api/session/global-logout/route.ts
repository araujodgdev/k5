import { apiWorkspace, apiError } from '@/lib/workspace-api';
import { endGlobalSession } from '@/lib/application/ui-service';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    // Origin-checked like any other write: a cross-site POST must not be able to log someone out.
    await apiWorkspace(request, true);
    return Response.json(await endGlobalSession());
  } catch (error) { return apiError(error); }
}
