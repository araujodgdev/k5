import { handleCapability, searchParamsInput } from '@/lib/capability-route';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const input = searchParamsInput(request, ['caseId', 'activeOnly']);
  return handleCapability(request, 'k5_judicial_list_links', {
    ...input,
    // Absent means the default the contract declares, not "show everything".
    activeOnly: input.activeOnly === undefined ? undefined : input.activeOnly === 'true',
  });
}

export async function POST(request: Request) {
  return handleCapability(request, 'k5_judicial_link_case');
}
