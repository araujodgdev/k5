import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { asaasChargeOperation } from '@/lib/asaas/contracts';
import { cancelAsaasCharge, confirmAsaasCharge, createAsaasCharge, getAsaasCharge } from '@/lib/asaas/charges';
import { AsaasProviderError } from '@/lib/asaas/provider';

export const runtime = 'nodejs';

const handlers = { get: getAsaasCharge, create: createAsaasCharge, cancel: cancelAsaasCharge, confirm: confirmAsaasCharge };

/** One POST for the installment's Asaas charge; every operation but `get` changes it and requires a trusted origin. */
export async function POST(request: Request) {
  let response: Response;
  try {
    const body = asaasChargeOperation.parse(await limitedJson(request, 4_096));
    const context = workspaceContext(await apiWorkspace(request, body.operation !== 'get'));
    response = Response.json(await handlers[body.operation](context, body.data));
  } catch (error) {
    response = error instanceof AsaasProviderError ? Response.json({ error: error.message }, { status: error.status }) : apiError(error);
  }
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
