import { z } from 'zod';
import { apiError, apiPersonalWorkspace, limitedJson } from '@/lib/workspace-api';
import { startGoogleConnect } from '@/lib/google/connections';
import { googleModuleEnum } from '@/lib/capabilities/google';
import { CapabilityError } from '@/lib/capabilities/errors';

const body = z.object({ modules: z.array(googleModuleEnum).min(1).max(4) });

/** Starts (or extends) the Google consent. Every role may connect its own account; writes are gated elsewhere. */
export async function POST(request: Request) {
  try {
    const workspace = await apiPersonalWorkspace(request, true);
    if (!workspace.session.id) throw new CapabilityError('UNAUTHENTICATED', 'Entre novamente para continuar.');
    const { modules } = body.parse(await limitedJson(request, 4_000));
    const result = await startGoogleConnect({ officeId: workspace.office.officeId, userId: workspace.user.id, sessionId: workspace.session.id }, [...new Set(modules)]);
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const response = apiError(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
