import { handleCapability, searchParamsInput } from '@/lib/capability-route';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  return handleCapability(
    request,
    'k5_judicial_list_jobs',
    searchParamsInput(request, ['caseId', 'linkId', 'installationId', 'status', 'limit']),
  );
}
