import { apiPersonalWorkspace, apiError, limitedFormData } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { saveTrademarkUpload } from '@/lib/research/trademarks/service';
import { CapabilityError } from '@/lib/capabilities/errors';

export async function POST(request: Request) {
  try {
    const workspace = await apiPersonalWorkspace(request, true);
    const data = await limitedFormData(request, 5 * 1024 * 1024 + 16_384);
    const file = data.get('file');
    if (!(file instanceof File)) throw new CapabilityError('INVALID', 'Selecione um logotipo.');
    return Response.json(await saveTrademarkUpload(workspaceContext(workspace), file), { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}
