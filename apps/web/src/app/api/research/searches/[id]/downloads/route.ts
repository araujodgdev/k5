import { handleCapability } from '@/lib/capability-route';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleCapability(request, 'k5_research_cancel_downloads', { searchId: id });
}
