import { handleCapability } from '@/lib/capability-route';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  return handleCapability(request, 'k5_context_set_sources');
}
