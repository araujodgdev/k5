import { z } from 'zod';
import { apiWorkspace, apiError, limitedFormData, ApiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { publishPortalFile } from '@/lib/client-portal/service';
export async function POST(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const context = workspaceContext(await apiWorkspace(request, true));
    const { clientId } = await params;
    const form = await limitedFormData(request, 20_064_000);
    const file = form.get('file'); if (!(file instanceof File)) throw new ApiError(400, 'Escolha um PDF.');
    return Response.json(await publishPortalFile(context, z.string().uuid().parse(clientId), file, z.string().uuid().parse(form.get('idempotencyKey'))), { status: 201 });
  } catch (error) { return apiError(error); }
}
