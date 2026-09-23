import { handleCapability } from '@/lib/capability-route';

// Web case-law search for the interface and WebMCP adapters; the question stays in the body.
export async function POST(request: Request) {
  return handleCapability(request, 'k5_research_web_jurisprudence');
}
