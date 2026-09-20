import { handleCapability, searchParamsInput } from '@/lib/capability-route';
import { strictBooleanQueryParam } from '@/lib/query-params';
import { apiError } from '@/lib/workspace-api';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const input = searchParamsInput(request, ['caseId', 'activeOnly', 'limit', 'cursor']);
    return handleCapability(request, 'k5_judicial_list_links', {
      ...input,
      // Absent means the default the contract declares, not "show everything".
      activeOnly: strictBooleanQueryParam(input.activeOnly, 'activeOnly'),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  return handleCapability(request, 'k5_judicial_link_case');
}
