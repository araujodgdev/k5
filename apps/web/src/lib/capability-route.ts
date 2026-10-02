import 'server-only';
import { apiWorkspace, apiPersonalWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { capabilities, type CapabilityName } from '@/lib/capabilities/contracts';
import { runCapability } from '@/lib/agent-tools';
import { sharedCaseCapabilities } from '@/lib/collaboration/capability-access';

/**
 * HTTP entry point for a capability. HTTP and agent adapters use `runCapability`
 * to enforce publication, session and resource access checks.
 */
export async function handleCapability(
  request: Request,
  name: CapabilityName,
  extra: Record<string, unknown> = {},
) {
  try {
    const write = capabilities[name].effect === 'write';
    const workspace = sharedCaseCapabilities.has(name) || (capabilities[name].module === 'research' && !write)
      ? await apiPersonalWorkspace(request, write)
      : await apiWorkspace(request, write);
    let body: Record<string, unknown> = {};
    if (request.method !== 'GET' && request.method !== 'DELETE') {
      body = (await limitedJson(request).catch(() => ({}))) as Record<string, unknown>;
    } else if (request.method === 'DELETE') {
      body = (await limitedJson(request).catch(() => ({}))) as Record<string, unknown>;
    }
    const result = await runCapability({ ...workspaceContext(workspace), signal: request.signal, ...(request.headers.get('x-k5-surface') === 'webmcp' ? { invocation: 'webmcp' as const } : {}) }, name, { ...body, ...extra });
    return Response.json(result, {
      status: write && request.method === 'POST' ? 201 : 200,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const response = apiError(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}

export function searchParamsInput(request: Request, keys: string[]) {
  const url = new URL(request.url);
  const input: Record<string, unknown> = {};
  for (const key of keys) {
    const values = url.searchParams.getAll(key);
    if (!values.length) continue;
    input[key] = values.length > 1 ? values : values[0];
  }
  if (typeof input.limit === 'string') input.limit = Number(input.limit);
  return input;
}
