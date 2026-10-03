import { z } from 'zod';
import { ApiError } from '@/lib/api-error';
import { apiError, apiWorkspace, limitedJson } from '@/lib/workspace-api';
import { BillingError, startCreditsCheckout } from '@/lib/billing/office-billing';
import { isCreditPackage } from '@/lib/billing/credit-pricing';

const body = z.strictObject({ credits: z.number().refine(isCreditPackage) });

/** Opens the AbacatePay checkout for a package of credits. */
export async function POST(request: Request) {
  try {
    const { user, office } = await apiWorkspace(request, true);
    const parsed = body.safeParse(await limitedJson(request, 1_000));
    if (!parsed.success) throw new ApiError(400, 'Escolha um dos pacotes de créditos.');
    const result = await startCreditsCheckout({ officeId: office.officeId, userId: user.id, email: user.email, name: user.name }, parsed.data.credits);
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const response = error instanceof BillingError ? Response.json({ error: error.message }, { status: error.status }) : apiError(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
