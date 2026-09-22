import { handleCapability } from '@/lib/capability-route';

export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return handleCapability(request, 'k5_research_get_profile', { caseId });
}

export async function PUT(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return handleCapability(request, 'k5_research_save_profile', { caseId });
}
