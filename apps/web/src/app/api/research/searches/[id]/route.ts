import { handleCapability } from '@/lib/capability-route';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleCapability(request, 'k5_research_get_search', { searchId: id });
}
