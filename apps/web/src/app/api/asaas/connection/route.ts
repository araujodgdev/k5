import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { connectAsaas, disconnectAsaas, getAsaasStatus, refreshAsaas } from '@/lib/asaas/service';
import { AsaasProviderError } from '@/lib/asaas/provider';

export const runtime = 'nodejs';

async function handle(request: Request, action: 'status' | 'connect' | 'refresh' | 'disconnect') {
  let response: Response;
  try {
    const context = workspaceContext(await apiWorkspace(request, action !== 'status'));
    const result = action === 'status' ? await getAsaasStatus(context)
      : await ({ connect: connectAsaas, refresh: refreshAsaas, disconnect: disconnectAsaas })[action](context, await limitedJson(request, 4_096));
    response = Response.json(result);
  } catch (error) {
    response = error instanceof AsaasProviderError ? Response.json({ error: error.message }, { status: error.status }) : apiError(error);
  }
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
export function GET(request: Request) { return handle(request, 'status'); }
export function POST(request: Request) { return handle(request, 'connect'); }
export function PATCH(request: Request) { return handle(request, 'refresh'); }
export function DELETE(request: Request) { return handle(request, 'disconnect'); }
