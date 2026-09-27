import { z } from 'zod';
import { requirePlatformRequest } from '@/lib/platform';
import { platformErrorResponse, readPlatformJson } from '@/lib/platform-core';
import { BillingError } from '@/lib/billing/office-billing';
import { AbacatePayError } from '@/lib/billing/abacatepay';
import { clientBillingAction, createClientCheckout, refreshClientBilling } from '@/lib/billing/platform-billing';

const command = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('checkout'), memberId: z.string().min(1).max(160), recurring: z.boolean() }),
  z.strictObject({ action: z.enum(['refund','cancel']), targetId: z.string().min(1).max(160) }),
  z.strictObject({ action: z.literal('refresh') }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ officeId: string }> }) {
  try {
    const { user } = await requirePlatformRequest(request, { mutation: true });
    const { officeId } = await params;
    const body = await readPlatformJson(request, command);
    if (body.action === 'checkout') return Response.json(await createClientCheckout(user.id,officeId,body.memberId,body.recurring));
    if (body.action === 'refresh') await refreshClientBilling(user.id,officeId);
    else await clientBillingAction(user.id,officeId,body.targetId,body.action);
    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof BillingError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof AbacatePayError) return Response.json({ error: 'Não foi possível consultar a AbacatePay. Tente novamente em instantes.' }, { status: 502 });
    return platformErrorResponse(error);
  }
}
