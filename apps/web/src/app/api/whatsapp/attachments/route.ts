import { apiError, apiPersonalWorkspace, ApiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { uploadWhatsAppAttachment } from '@/lib/whatsapp/media';
import { MAX_WHATSAPP_MEDIA_BYTES } from '@/lib/whatsapp/media-validation';
import { uploadReceiptDto } from '@/lib/whatsapp/domain';
import { requireWhatsApp } from '@/lib/whatsapp/connection';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const context = workspaceContext(await apiPersonalWorkspace(request, true));
    await requireWhatsApp(context, { write: true });
    const contentType = request.headers.get('content-type');
    if (!contentType?.startsWith('multipart/form-data;') || Number(request.headers.get('content-length')) > MAX_WHATSAPP_MEDIA_BYTES + 65_536)
      throw new ApiError(400, 'Escolha um arquivo de até 25 MB.');
    let received = 0;
    const bounded = request.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > MAX_WHATSAPP_MEDIA_BYTES + 65_536) throw new ApiError(400, 'O arquivo excede 25 MB.');
        controller.enqueue(chunk);
      },
    }));
    if (!bounded) throw new ApiError(400, 'Escolha um arquivo.');
    const form = await new Response(bounded, { headers: { 'Content-Type': contentType } }).formData();
    const threadId = form.get('threadId'), file = form.get('file');
    if (typeof threadId !== 'string' || !(file instanceof File) || form.getAll('file').length !== 1 || form.getAll('threadId').length !== 1)
      throw new ApiError(400, 'Escolha um arquivo e uma conversa.');
    return Response.json(uploadReceiptDto.parse(await uploadWhatsAppAttachment(context, threadId, file)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
