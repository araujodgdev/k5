import { handleCapability } from '@/lib/capability-route';

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return handleCapability(request, 'k5_research_assess_material', { caseId });
}
