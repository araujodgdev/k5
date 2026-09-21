import { z } from 'zod';
import { handleCapability } from '@/lib/capability-route';
import { apiError, limitedJson } from '@/lib/workspace-api';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/**
 * Confirming a link is the act that authorizes recurring queries to a court on the office's
 * behalf, so it lives on this human-facing route only: the capability is unpublished to both
 * agent adapters.
 */
export async function PATCH(request: Request, context: Context) {
  try {
    const linkId = (await context.params).id;
    const body = z.object({
      decision: z.enum(['confirmed', 'rejected']),
      idempotencyKey: z.string().min(8).max(128).optional(),
    }).parse(await limitedJson(request));
    return handleCapability(request, 'k5_judicial_confirm_link', { linkId, decision: body.decision, idempotencyKey: body.idempotencyKey });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  return handleCapability(request, 'k5_judicial_unlink_case', { linkId: (await context.params).id });
}
