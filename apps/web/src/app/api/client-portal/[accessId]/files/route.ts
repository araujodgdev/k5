import { z } from 'zod';
import { apiError, limitedFormData, ApiError } from '@/lib/workspace-api';
import { apiClientPortal } from '@/lib/client-portal/http';
import { uploadClientFile } from '@/lib/client-portal/service';
export async function POST(request: Request, { params }: { params: Promise<{ accessId: string }> }) {
  try {
    const context = await apiClientPortal(request, true);
    const form = await limitedFormData(request, 20_064_000);
    const file = form.get('file'); if (!(file instanceof File)) throw new ApiError(400, 'Escolha um arquivo.');
    const installment = form.get('installmentId');
    return Response.json(await uploadClientFile(context, (await params).accessId, file, z.string().uuid().parse(form.get('idempotencyKey')), typeof installment === 'string' && installment ? installment : null), { status: 201 });
  } catch (error) { return apiError(error); }
}
