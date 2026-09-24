import 'server-only';
import { resolveOfficeModelConfig } from './ai-connections';
import { modelModalities } from './ai-modalities';
import { createOfficeAgent, recordUsage, RequestContext } from './ai-runtime';

/**
 * OpenAI chat runs on the Responses API, which takes no audio parts, and the browser records
 * WebM, which chat audio input would not take either. The voice note is transcribed with the
 * office's own OpenAI key and reaches the model as text; Gemini still gets the audio itself.
 */
export async function transcribeAudio(apiKey: string, audio: { mediaType: string; data: string }, signal?: AbortSignal) {
  const bytes = Buffer.from(audio.data, 'base64');
  if (!bytes.length || bytes.length > 24_000_000) throw new Error('audio_size');
  const extension = audio.mediaType.includes('mp4') ? 'mp4' : audio.mediaType.includes('ogg') ? 'ogg' : audio.mediaType.includes('wav') ? 'wav' : audio.mediaType.includes('mpeg') ? 'mp3' : 'webm';
  const form = new FormData();
  form.set('file', new Blob([bytes], { type: audio.mediaType }), `audio.${extension}`);
  form.set('model', 'gpt-4o-mini-transcribe');
  form.set('language', 'pt');
  form.set('response_format', 'json');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form,
    signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]),
  });
  if (!response.ok) throw new Error(`transcription_${response.status}`);
  const body = await response.json() as { text?: unknown };
  return typeof body.text === 'string' ? body.text.trim().slice(0, 8000) : '';
}

/** Models whose audio goes through transcription: the OpenAI chat families. */
export function transcribesAudio(provider: string) { return provider === 'openai'; }

const MAX_VOICE_BYTES = 20 * 1024 * 1024;

/**
 * The composer's voice note, turned into text before it is sent: the person sees and sends the
 * transcript as an ordinary message. OpenAI offices use the transcription endpoint; models that
 * hear audio natively (Gemini) transcribe it themselves. Other models keep the microphone disabled.
 */
export async function transcribeVoiceNote(owner: { officeId: string; userId: string }, audio: { mediaType: string; bytes: Buffer }, signal?: AbortSignal) {
  if (!audio.bytes.length || audio.bytes.length > MAX_VOICE_BYTES) throw new TranscriptionError('size');
  const config = await resolveOfficeModelConfig(owner.officeId, 'chat');
  if (transcribesAudio(config.provider)) return transcribeAudio(config.apiKey, { mediaType: audio.mediaType, data: audio.bytes.toString('base64') }, signal);
  if (!modelModalities(config.provider, config.modelId).audio) throw new TranscriptionError('unsupported');
  const { agent } = await createOfficeAgent(owner.officeId, 'chat',
    'Transcreva fielmente o áudio em português brasileiro. Responda somente com a transcrição, sem comentários, aspas ou marcações. Se não houver fala, responda com nada.');
  const ctx = new RequestContext();
  ctx.set('provider', config.provider);
  ctx.set('modelId', config.modelId);
  ctx.set('apiKey', config.apiKey);
  try {
    const result = await agent.generate([{ role: 'user', content: [{ type: 'file', data: audio.bytes.toString('base64'), mediaType: audio.mediaType }] }] as Parameters<typeof agent.generate>[0], {
      requestContext: ctx, maxSteps: 1, modelSettings: { maxOutputTokens: 4000 },
      abortSignal: AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]),
    });
    if (result.error || result.finishReason === 'error') throw new Error('transcription_failed');
    await recordUsage(owner.officeId, owner.userId, config, 'transcription', 'completed', result.usage);
    return result.text.trim().slice(0, 8000);
  } catch (error) {
    await recordUsage(owner.officeId, owner.userId, config, 'transcription', 'failed').catch(() => undefined);
    throw error;
  }
}

export class TranscriptionError extends Error {
  constructor(public reason: 'size' | 'unsupported') { super(`transcription_${reason}`); }
}
