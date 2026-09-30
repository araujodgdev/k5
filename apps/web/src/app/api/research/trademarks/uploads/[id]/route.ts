import { apiPersonalWorkspace, apiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { readTrademarkUpload } from '@/lib/research/trademarks/service';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspace = await apiPersonalWorkspace(request);
    const { id } = await params;
    const image = await readTrademarkUpload(workspaceContext(workspace), id);
    return new Response(new Uint8Array(image.bytes), { headers: { 'Content-Type': image.mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return apiError(error); }
}
