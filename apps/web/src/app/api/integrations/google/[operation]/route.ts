import { apiError, apiWorkspace, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { capabilities } from '@/lib/capabilities/contracts';
import { runCapability } from '@/lib/agent-tools';
import { isTrustedOrigin } from '@/lib/trusted-origins';
import { googleOperations, type GoogleOperation } from '@/lib/google/routes';

/**
 * Interface entry for the Google capabilities. Personal operations (calendar selection, picked
 * files) are open to every role; the capability's own role list and the office rules decide the
 * rest inside runCapability, the same path the agent uses.
 */
export async function POST(request: Request, { params }: { params: Promise<{ operation: string }> }) {
  const { operation } = await params;
  const name = Object.hasOwn(googleOperations, operation) ? googleOperations[operation as GoogleOperation] : undefined;
  if (!name) return Response.json({ error: 'Operação não encontrada.' }, { status: 404 });
  try {
    const write = capabilities[name].effect === 'write';
    if (write && !isTrustedOrigin(request.headers.get('origin'))) return Response.json({ error: 'Origem não autorizada.' }, { status: 403 });
    const workspace = await apiWorkspace(request);
    const body = await limitedJson(request, 400_000).catch(() => ({})) as Record<string, unknown>;
    const surface = request.headers.get('x-k5-surface') === 'webmcp' ? { invocation: 'webmcp' as const } : {};
    const result = await runCapability({ ...workspaceContext(workspace), signal: request.signal, ...surface }, name, body);
    return Response.json(result, { status: write ? 201 : 200, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const response = apiError(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
