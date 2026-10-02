import { apiError, apiWorkspace } from '@/lib/workspace-api';
import { BillingError, startPlanCheckout } from '@/lib/billing/office-billing';

/** Opens the AbacatePay checkout for one month of the plan. */
export async function POST(request: Request) {
  try {
    const { user, office } = await apiWorkspace(request, true);
    const result = await startPlanCheckout({ officeId: office.officeId, userId: user.id, email: user.email, name: user.name });
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const response = error instanceof BillingError ? Response.json({ error: error.message }, { status: error.status }) : apiError(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
