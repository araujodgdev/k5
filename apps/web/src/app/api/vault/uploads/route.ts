import { apiWorkspace, apiError, ApiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { createUploadRef } from '@/lib/application/uploads-service';

export const runtime = 'nodejs';

/**
 * A human picks the file; the server stores it and returns an opaque reference. This is the only
 * way bytes enter the Vault for the agent and WebMCP flows - no path, no base64 in a prompt.
 */
export async function POST(request: Request) {
  try {
    const workspace = await apiWorkspace(request, true);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new ApiError(400, 'Escolha um arquivo para enviar.');
    const upload = await createUploadRef(workspaceContext(workspace), file);
    return Response.json(
      { uploadRef: upload.id, name: upload.originalName, byteSize: upload.byteSize, mimeType: upload.mimeType },
      { status: 201 },
    );
  } catch (error) { return apiError(error); }
}
