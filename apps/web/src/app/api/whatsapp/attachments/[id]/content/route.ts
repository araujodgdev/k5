import { apiError, apiPersonalWorkspace } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { readWhatsAppAttachment } from '@/lib/whatsapp/media';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = workspaceContext(await apiPersonalWorkspace(request));
    return await readWhatsAppAttachment(context, (await params).id, {
      range: request.headers.get('range'), download: new URL(request.url).searchParams.get('download') === '1',
    });
  } catch (error) { return apiError(error); }
}
