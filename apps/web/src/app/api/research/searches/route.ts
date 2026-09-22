import { handleCapability } from '@/lib/capability-route';

export async function GET(request: Request) {
  return handleCapability(request, 'k5_research_list_history');
}

export async function POST(request: Request) {
  return handleCapability(request, 'k5_research_start_search');
}
