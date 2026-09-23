import { apiWorkspace, apiError, ApiError } from '@/lib/workspace-api';
import { isTrustedOrigin } from '@/lib/trusted-origins';
import { endGlobalSession } from '@/lib/application/ui-service';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    // Origin-checked like any other write: a cross-site POST must not be able to log someone out.
    // Any role may end its own sessions, so the writer-role check is not applied.
    if (!isTrustedOrigin(request.headers.get('origin'))) throw new ApiError(403, 'Origem não autorizada.');
    await apiWorkspace(request);
    return Response.json(await endGlobalSession());
  } catch (error) { return apiError(error); }
}
