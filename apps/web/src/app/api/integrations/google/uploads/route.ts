import { apiWorkspace, apiError, ApiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { createMailUpload } from '@/lib/google/gmail/service';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const workspace = await apiWorkspace(request, true);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new ApiError(400, 'Escolha um anexo para enviar.');
    const uploaded = await createMailUpload(workspaceContext(workspace), file);
    return Response.json({ uploadId: uploaded.id, name: uploaded.name, mimeType: uploaded.mimeType,
      byteSize: uploaded.byteSize }, { status: 201 });
  } catch (error) { return apiError(error); }
}
