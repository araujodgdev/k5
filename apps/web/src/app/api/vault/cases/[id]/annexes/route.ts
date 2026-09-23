import { handleCapability } from '@/lib/capability-route';

export const runtime = 'nodejs';

/** Proposes how to split the scanned PDF; writes nothing. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleCapability(request, 'k5_vault_plan_annexes', { caseId: (await params).id });
}
