import { handleCapability, searchParamsInput } from '@/lib/capability-route';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const input = searchParamsInput(request, ['unreadOnly', 'limit']);
  return handleCapability(request, 'k5_judicial_list_alerts', { ...input, unreadOnly: input.unreadOnly === 'true' });
}
