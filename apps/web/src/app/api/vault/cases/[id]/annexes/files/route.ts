import { handleCapability } from '@/lib/capability-route';

export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleCapability(request, 'k5_vault_generate_annexes', { caseId: (await params).id });
}
