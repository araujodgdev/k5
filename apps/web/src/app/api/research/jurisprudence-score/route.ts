import { handleCapability } from '@/lib/capability-route';

// Scores case law found on the web against a case; the decisions and the question stay in the body.
export async function POST(request: Request) {
  return handleCapability(request, 'k5_research_score_jurisprudence');
}
