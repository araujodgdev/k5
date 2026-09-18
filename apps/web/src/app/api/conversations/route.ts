import { handleCapability, searchParamsInput } from '@/lib/capability-route';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  return handleCapability(request, 'k5_conversations_list', searchParamsInput(request, ['limit']));
}

export async function POST(request: Request) {
  return handleCapability(request, 'k5_conversations_create');
}
