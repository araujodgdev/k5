import { handleCapability, searchParamsInput } from '@/lib/capability-route';
import { strictBooleanQueryParam } from '@/lib/query-params';
import { apiError } from '@/lib/workspace-api';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const input = searchParamsInput(request, ['purpose', 'enabledOnly']);
    return handleCapability(request, 'k5_judicial_list_sources', {
      ...input,
      enabledOnly: strictBooleanQueryParam(input.enabledOnly, 'enabledOnly'),
    });
  } catch (error) {
    return apiError(error);
  }
}
