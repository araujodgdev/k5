import { handleCapability } from '@/lib/capability-route';

// The theme stays in the request body, never in a URL, loggable query string or shared cache key.
export async function POST(request: Request) {
  return handleCapability(request, 'k5_research_search_corpus');
}
