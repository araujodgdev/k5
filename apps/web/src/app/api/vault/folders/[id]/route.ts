import { handleCapability } from '@/lib/capability-route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Context) {
  return handleCapability(request, 'k5_vault_delete_folder', { folderId: (await context.params).id });
}
