import { handleCapability, searchParamsInput } from '@/lib/capability-route';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const input = searchParamsInput(request, ['purpose', 'enabledOnly']);
  return handleCapability(request, 'k5_judicial_list_sources', {
    ...input,
    enabledOnly: input.enabledOnly === 'true',
  });
}
