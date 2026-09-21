import { handleCapability } from '@/lib/capability-route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  return handleCapability(request, 'k5_judicial_mark_alert_read', { alertId: (await context.params).id });
}
