import { z } from 'zod';
import { ApiError } from '@/lib/api-error';
import { requirePlatformRequest } from '@/lib/platform';
import { platformErrorResponse, readPlatformJson } from '@/lib/platform-core';
import { grantCreditsByAdmin } from '@/lib/billing/credits';

const command = z.strictObject({
  credits: z.number().int().min(1).max(100_000),
  reason: z.string().trim().min(1).max(200),
  requestId: z.string().uuid(),
});

/** Credits a platform administrator adds to a client by hand. A repeated request id adds nothing. */
export async function POST(request: Request, { params }: { params: Promise<{ officeId: string }> }) {
  try {
    const { user } = await requirePlatformRequest(request, { mutation: true });
    const { officeId } = await params;
    const body = await readPlatformJson(request, command);
    return Response.json(await grantCreditsByAdmin(user.id, officeId, body));
  } catch (error) {
    if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
    return platformErrorResponse(error);
  }
}
