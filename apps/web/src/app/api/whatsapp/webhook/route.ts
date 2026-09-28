import { apiError, ApiError } from '@/lib/workspace-api';
import { acceptWebhook, MAX_WHATSAPP_WEBHOOK_BYTES } from '@/lib/whatsapp/webhooks';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError(400, 'Webhook inválido.');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_WHATSAPP_WEBHOOK_BYTES) { await reader.cancel(); throw new ApiError(413, 'Webhook muito grande.'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const raw = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
    return Response.json(await acceptWebhook(raw, request.headers));
  } catch (error) { return apiError(error); }
}
