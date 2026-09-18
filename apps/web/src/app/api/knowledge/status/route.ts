import { handleCapability, searchParamsInput } from '@/lib/capability-route';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  return handleCapability(request, 'k5_knowledge_get_index_status', searchParamsInput(request, ['documentId']));
}
