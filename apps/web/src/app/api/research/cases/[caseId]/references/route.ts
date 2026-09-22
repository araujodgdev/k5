import { handleCapability } from '@/lib/capability-route';

export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return handleCapability(request, 'k5_research_list_references', { caseId });
}

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return handleCapability(request, 'k5_research_add_reference', { caseId });
}
