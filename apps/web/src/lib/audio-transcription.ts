import 'server-only';
import { resolveTaskModel } from './ai-connections';
import { AiConnectionError } from './ai-connections-core';
import { chatHearsAudio } from './ai-modalities';
import { isTranscriptionModel } from './ai-tasks';
import { createAgent, errorClass, recordUsage, requestContextFor } from './ai-runtime';
import { assertCredits } from './billing/credits';

type Audio = { mediaType: string; bytes: Buffer };

/** OpenAI's transcription endpoint, with the connection's key; nothing is stored. */
export async function transcribeWithEndpoint(apiKey: string, modelId: string, audio: Audio, signal?: AbortSignal) {
  if (!audio.bytes.length || audio.bytes.length > 24_000_000) throw new Error('audio_size');
  const extension = audio.mediaType.includes('mp4') ? 'mp4' : audio.mediaType.includes('ogg') ? 'ogg' : audio.mediaType.includes('wav') ? 'wav' : audio.mediaType.includes('mpeg') ? 'mp3' : 'webm';
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(audio.bytes)], { type: audio.mediaType }), `audio.${extension}`);
  form.set('model', modelId);
  form.set('language', 'pt');
  form.set('response_format', 'json');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form,
    signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]),
  });
  if (!response.ok) throw Object.assign(new Error(`transcription_${response.status}`), { statusCode: response.status });
  const body = await response.json() as { text?: unknown; usage?: { type?: unknown; input_tokens?: unknown; output_tokens?: unknown } };
  // Token-billed models report usage; duration-billed ones (whisper) do not.
  const usage = body.usage?.type === 'tokens'
    ? { inputTokens: Number(body.usage.input_tokens) || 0, outputTokens: Number(body.usage.output_tokens) || 0 }
    : undefined;
  return { text: typeof body.text === 'string' ? body.text.trim().slice(0, 8000) : '', usage };
}

const MAX_VOICE_BYTES = 20 * 1024 * 1024;

/**
 * A recording turned into text by the transcription task: a transcription model on its endpoint, or
 * a model that hears audio itself (Gemini). The composer's voice note and the audio sent with a
 * message both come through here; the text is what the person sees and sends.
 */
export async function transcribeVoiceNote(owner: { officeId: string; userId: string }, audio: Audio, signal?: AbortSignal) {
  if (!audio.bytes.length || audio.bytes.length > MAX_VOICE_BYTES) throw new TranscriptionError('size');
  await assertCredits(owner.officeId, owner.userId);
  let config;
  try { config = await resolveTaskModel('transcription.voice_note'); } catch (error) {
    if (error instanceof AiConnectionError && (error.code === 'task_disabled' || error.code === 'not_found')) throw new TranscriptionError('unsupported');
    if (error instanceof AiConnectionError && error.code === 'unavailable') throw new TranscriptionError('unavailable', error.message);
    throw error;
  }
  const started = performance.now();
  try {
    let text: string, usage: unknown;
    if (isTranscriptionModel(config.provider, config.modelId)) {
      ({ text, usage } = await transcribeWithEndpoint(config.apiKey, config.modelId, audio, signal));
    } else if (chatHearsAudio(config.provider, config.modelId)) {
      const { agent } = await createAgent(config,
        'Transcreva fielmente o áudio em português brasileiro. Responda somente com a transcrição, sem comentários, aspas ou marcações. Se não houver fala, responda com nada.');
      const result = await agent.generate([{ role: 'user', content: [{ type: 'file', data: audio.bytes.toString('base64'), mediaType: audio.mediaType }] }] as Parameters<typeof agent.generate>[0], {
        requestContext: requestContextFor(config), maxSteps: 1, modelSettings: { maxOutputTokens: 4000 },
        abortSignal: AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]),
      });
      if (result.error || result.finishReason === 'error') throw new Error('transcription_failed');
      text = result.text.trim().slice(0, 8000);
      usage = result.usage;
    } else {
      throw new TranscriptionError('unsupported');
    }
    await recordUsage(owner.officeId, owner.userId, config, config.task, 'completed', usage, { durationMs: performance.now() - started });
    return text;
  } catch (error) {
    if (!(error instanceof TranscriptionError)) {
      await recordUsage(owner.officeId, owner.userId, config, config.task, 'failed', undefined, { durationMs: performance.now() - started, errorClass: errorClass(error) })
        .catch(() => undefined);
    }
    throw error;
  }
}

export class TranscriptionError extends Error {
  constructor(public reason: 'size' | 'unsupported' | 'unavailable', message = `transcription_${reason}`) { super(message); }
}
