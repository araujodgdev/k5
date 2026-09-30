import { capabilityNames, publishedCapabilitiesForRole } from '@/lib/capabilities/contracts';
import { runCapability } from '@/lib/agent-tools';
import { workspaceContext } from '@/lib/application/context';
import { apiPersonalWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { CapabilityError } from '@/lib/capabilities/errors';

export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    const { name: requested } = await params;
    const name = capabilityNames.find(name => name === requested);
    if (!name) throw new CapabilityError('NOT_FOUND', 'Operação não encontrada.');
    // POST capabilities can schedule reads, persist history or start a browser. Require the app origin for every POST.
    const workspace = await apiPersonalWorkspace(request, true);
    const context = workspaceContext(workspace);
    if (!publishedCapabilitiesForRole(context.role, 'webmcp').includes(name)) throw new CapabilityError('FORBIDDEN', 'Operação indisponível para este acesso.');
    const result = await runCapability({ ...context, invocation: 'webmcp', signal: request.signal }, name, await limitedJson(request));
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const response = apiError(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
