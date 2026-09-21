import { handleCapability } from '@/lib/capability-route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/** Queues the collection and returns immediately; a sweep never runs inside the request. */
export async function POST(request: Request, context: Context) {
  return handleCapability(request, 'k5_judicial_request_refresh', { linkId: (await context.params).id });
}
