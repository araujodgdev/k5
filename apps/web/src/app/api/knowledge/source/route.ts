import { handleCapability, searchParamsInput } from '@/lib/capability-route';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  return handleCapability(request, 'k5_knowledge_get_source', searchParamsInput(request, ['documentId', 'stableReference']));
}

export async function POST(request: Request) {
  return handleCapability(request, 'k5_knowledge_get_source');
}
