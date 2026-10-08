import { apiWorkspace, apiError, ApiError } from '@/lib/workspace-api';
import { captureOperationalError } from '@/lib/observability/report';
import { captureBillingOrigin } from '@/lib/billing/origin';
import { transcribeVoiceNote, TranscriptionError } from '@/lib/audio-transcription';

export const runtime = 'nodejs';

const MAX_BYTES = 20 * 1024 * 1024;
const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/aac'];

/** The composer's recording, returned as text; nothing is stored. */
export async function POST(request: Request) {
  try {
    const { user, office } = await apiWorkspace(request, true);
    const owner = { officeId: office.officeId, userId: user.id };
    const conversationId = request.headers.get('x-lume-conversation-id');
    if (!conversationId || conversationId.length > 200) throw new ApiError(400, 'Selecione uma conversa antes de gravar.');
    const billingOrigin = await captureBillingOrigin(owner, conversationId);
    const mediaType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!AUDIO_TYPES.includes(mediaType)) throw new ApiError(415, 'Formato de áudio não suportado.');
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError(400, 'Grave um áudio antes de enviar.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new ApiError(413, 'A gravação é longa demais. Grave até cerca de dez minutos.'); }
      chunks.push(value);
    }
    if (!size) throw new ApiError(400, 'A gravação ficou vazia. Tente de novo.');
    try {
      const text = await transcribeVoiceNote({ ...owner, billingOrigin }, { mediaType, bytes: Buffer.concat(chunks) }, request.signal);
      return Response.json({ text }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
      if (error instanceof TranscriptionError && error.reason === 'unsupported') throw new ApiError(400, 'O Lume não aceita áudio nesta configuração.');
      if (error instanceof TranscriptionError && error.reason === 'unavailable') throw new ApiError(503, 'A transcrição está indisponível no momento. Escreva a mensagem ou tente mais tarde.');
      if (error instanceof ApiError) throw error;
      captureOperationalError(error, 'chat.audio.transcription');
      throw new ApiError(502, 'Não foi possível transcrever o áudio. Tente de novo ou escreva a mensagem.');
    }
  } catch (error) { return apiError(error); }
}
