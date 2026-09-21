import { handleCapability } from '@/lib/capability-route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return handleCapability(request, 'k5_judicial_get_publication', { publicationId: (await context.params).id });
}
