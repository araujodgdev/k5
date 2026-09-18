import 'server-only';
import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { capabilities, type CapabilityName } from '@/lib/capabilities/contracts';
import { runCapability } from '@/lib/agent-tools';

/**
 * HTTP entry point for a capability. Both adapters now converge on `runCapability`, so the role
 * policy declared in the contract is enforced on this path too - previously only the Mastra tools
 * consulted it, and the routes settled for "not a reviewer".
 */
export async function handleCapability(
  request: Request,
  name: CapabilityName,
  extra: Record<string, unknown> = {},
) {
  try {
    const write = capabilities[name].effect === 'write';
    const workspace = await apiWorkspace(request, write);
    let body: Record<string, unknown> = {};
    if (request.method !== 'GET' && request.method !== 'DELETE') {
      body = (await limitedJson(request).catch(() => ({}))) as Record<string, unknown>;
    } else if (request.method === 'DELETE') {
      body = (await limitedJson(request).catch(() => ({}))) as Record<string, unknown>;
    }
    const result = await runCapability(workspaceContext(workspace), name, { ...body, ...extra });
    return Response.json(result, { status: write && request.method === 'POST' ? 201 : 200 });
  } catch (error) { return apiError(error); }
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
