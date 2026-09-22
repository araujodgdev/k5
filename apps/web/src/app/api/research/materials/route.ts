import { handleCapability } from '@/lib/capability-route';

export async function POST(request: Request) {
  return handleCapability(request, 'k5_research_request_material');
}
