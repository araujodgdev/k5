import { handleCapability } from '@/lib/capability-route';

export async function GET(request: Request) {
  return handleCapability(request, 'k5_research_list_web_searches');
}

export async function POST(request: Request) {
  return handleCapability(request, 'k5_research_web_search');
}
