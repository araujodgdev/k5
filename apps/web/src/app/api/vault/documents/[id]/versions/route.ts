import { handleCapability } from '@/lib/capability-route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return handleCapability(request, 'k5_vault_add_document_version', { documentId: (await context.params).id });
}
