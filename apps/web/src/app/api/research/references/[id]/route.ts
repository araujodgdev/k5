import { handleCapability } from '@/lib/capability-route';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleCapability(request, 'k5_research_update_reference', { referenceId: id });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleCapability(request, 'k5_research_remove_reference', { referenceId: id });
}
