import { apiError, apiPersonalWorkspace } from '@/lib/workspace-api';
import { disconnectGoogle } from '@/lib/google/connections';

/** Revokes the grant at Google, erases tokens and stops sync. Cofre copies stay under Cofre retention. */
export async function POST(request: Request) {
  try {
    const workspace = await apiPersonalWorkspace(request, true);
    await disconnectGoogle({ officeId: workspace.office.officeId, userId: workspace.user.id });
    return Response.json({ success: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const response = apiError(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
