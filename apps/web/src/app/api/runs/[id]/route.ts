import { handleCapability } from '@/lib/capability-route';
import { apiError, ApiError, limitedJson } from '@/lib/workspace-api';
import { z } from 'zod';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return handleCapability(request, 'k5_runs_get', { runId: (await context.params).id });
}

export async function PATCH(request: Request, context: Context) {
  try {
    const runId = (await context.params).id;
    const body = z.object({ action: z.enum(['retry', 'cancel']), idempotencyKey: z.string().min(8).max(128).optional() })
      .parse(await limitedJson(request));
    // Both actions run through the same service the agent uses, so the state transitions and the
    // conflict messages are identical whichever adapter asked.
    const cloned = new Request(request.url, { method: 'PATCH', headers: request.headers, body: JSON.stringify({ runId, idempotencyKey: body.idempotencyKey }) });
    return handleCapability(cloned, body.action === 'cancel' ? 'k5_runs_cancel' : 'k5_runs_retry', { runId });
  } catch (error) {
    if (error instanceof ApiError) return apiError(error);
    return apiError(error);
  }
}
