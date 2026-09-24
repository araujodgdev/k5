import { apiError, apiPersonalWorkspace } from '@/lib/workspace-api';
import { requireConnection } from '@/lib/google/connections';
import { googleOAuthConfig, googlePickerConfig, pickerScope } from '@/lib/google/config';
import { CapabilityError } from '@/lib/capabilities/errors';

/**
 * The Google Picker runs in the browser and needs an OAuth access token. This is the only token
 * is requested directly through GIS with include_granted_scopes=false and drive.file only.
 * Refresh tokens and the server connection's broader access token never reach the browser.
 */
export async function POST(request: Request) {
  try {
    const workspace = await apiPersonalWorkspace(request, true);
    const config = googlePickerConfig();
    const oauth = googleOAuthConfig();
    if (!config || !oauth) throw new CapabilityError('NOT_READY', 'O seletor do Google Drive não está configurado neste ambiente.');
    const connection = await requireConnection({ officeId: workspace.office.officeId, userId: workspace.user.id }, 'drive');
    const origin = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
    return Response.json({ ...config, clientId: oauth.clientId, loginHint: connection.email, scope: pickerScope, origin }, { headers: { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' } });
  } catch (error) {
    const response = apiError(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
