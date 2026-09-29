import { apiPersonalWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { connectAds, disconnectAds, getAdsStatus, refreshAds } from '@/lib/ads/service';
import { AdsProviderError } from '@/lib/ads/provider';

export const runtime = 'nodejs';

async function handle(request: Request, action: 'status' | 'connect' | 'refresh' | 'disconnect') {
  let response: Response;
  try {
    const context = workspaceContext(await apiPersonalWorkspace(request, action !== 'status'));
    const result = action === 'status' ? await getAdsStatus(context)
      : await ({ connect: connectAds, refresh: refreshAds, disconnect: disconnectAds })[action](context, await limitedJson(request, 4_096));
    response = Response.json(result);
  } catch (error) {
    response = error instanceof AdsProviderError ? Response.json({ error: error.message }, { status: error.status }) : apiError(error);
  }
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
export function GET(request: Request) { return handle(request, 'status'); }
export function POST(request: Request) { return handle(request, 'connect'); }
export function PATCH(request: Request) { return handle(request, 'refresh'); }
export function DELETE(request: Request) { return handle(request, 'disconnect'); }
