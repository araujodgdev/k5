import { handleCapability } from '@/lib/capability-route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return handleCapability(request, 'k5_vault_get_document', { documentId: (await context.params).id });
}

export async function PATCH(request: Request, context: Context) {
  return handleCapability(request, 'k5_vault_update_document', { documentId: (await context.params).id });
}

export async function DELETE(request: Request, context: Context) {
  return handleCapability(request, 'k5_vault_delete_document', { documentId: (await context.params).id });
}
