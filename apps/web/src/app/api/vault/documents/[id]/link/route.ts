import { handleCapability } from '@/lib/capability-route';

export const runtime = 'nodejs';

/** Confirms the document exists in this office before handing back a download route. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleCapability(request, 'k5_vault_download_document', { documentId: (await context.params).id });
}
