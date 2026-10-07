import { handleCapability } from '@/lib/capability-route';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleCapability(request, 'k5_vault_get_annex_plan', { caseId: (await params).id, scanDocumentId: new URL(request.url).searchParams.get('scanDocumentId') });
}

/** Retains the proposed split and its exact source identities for review. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleCapability(request, 'k5_vault_plan_annexes', { caseId: (await params).id });
}
