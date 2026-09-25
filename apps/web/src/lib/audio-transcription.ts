import 'server-only';
import { resolveProfileConfig } from './ai-connections';
import { modelModalities } from './ai-modalities';
import { createAgent, profileContext, recordUsage, type ModelCredential } from './ai-runtime';

const OPENAI_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';

/** Who the transcription is for and which chat connection's key pays for it. */
export type TranscriptionOwner = { officeId: string; userId: string | null; config: ModelCredential & { connectionId: string } };

/**
 * OpenAI chat runs on the Responses API, which takes no audio parts, and the browser records
 * WebM, which chat audio input would not take either. The voice note is transcribed with the
 * office's own OpenAI key and reaches the model as text; Gemini still gets the audio itself.
 */
export async function transcribeAudio(apiKey: string, audio: { mediaType: string; data: string }, signal?: AbortSignal, owner?: TranscriptionOwner) {
  const started = performance.now();
  const record = (status: string, usage?: { input_tokens?: number; output_tokens?: number }) => owner
    ? recordUsage({ officeId: owner.officeId, userId: owner.userId, config: { provider: owner.config.provider, apiKey: owner.config.apiKey, connectionId: owner.config.connectionId, modelId: OPENAI_TRANSCRIPTION_MODEL },
      task: 'transcription-openai', status, usage: { inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens }, durationMs: performance.now() - started })
    : Promise.resolve();
  try {
    const { text, usage } = await requestTranscription(apiKey, audio, signal);
    await record('completed', usage);
    return text;
  } catch (error) {
    await record(signal?.aborted ? 'cancelled' : 'failed');
    throw error;
  }
}

async function requestTranscription(apiKey: string, audio: { mediaType: string; data: string }, signal?: AbortSignal) {
  const bytes = Buffer.from(audio.data, 'base64');
  if (!bytes.length || bytes.length > 24_000_000) throw new Error('audio_size');
  const extension = audio.mediaType.includes('mp4') ? 'mp4' : audio.mediaType.includes('ogg') ? 'ogg' : audio.mediaType.includes('wav') ? 'wav' : audio.mediaType.includes('mpeg') ? 'mp3' : 'webm';
  const form = new FormData();
  form.set('file', new Blob([bytes], { type: audio.mediaType }), `audio.${extension}`);
  form.set('model', OPENAI_TRANSCRIPTION_MODEL);
  form.set('language', 'pt');
  form.set('response_format', 'json');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form,
    signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]),
  });
  if (!response.ok) throw new Error(`transcription_${response.status}`);
  const body = await response.json() as { text?: unknown; usage?: { input_tokens?: number; output_tokens?: number } };
  return { text: typeof body.text === 'string' ? body.text.trim().slice(0, 8000) : '', usage: body.usage };
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
  const config = await resolveProfileConfig('chat');
  // Transcription rows are grouped by their task, not under the chat step whose credential they use.
  const usageConfig = { provider: config.provider, modelId: config.modelId, apiKey: config.apiKey, connectionId: config.connectionId };
  if (transcribesAudio(config.provider)) return transcribeAudio(config.apiKey, { mediaType: audio.mediaType, data: audio.bytes.toString('base64') }, signal, { ...owner, config });
  if (!modelModalities(config.provider, config.modelId).audio) throw new TranscriptionError('unsupported');
  const { agent } = await createAgent('chat',
    'Transcreva fielmente o áudio em português brasileiro. Responda somente com a transcrição, sem comentários, aspas ou marcações. Se não houver fala, responda com nada.');
  const started = performance.now();
  try {
    const result = await agent.generate([{ role: 'user', content: [{ type: 'file', data: audio.bytes.toString('base64'), mediaType: audio.mediaType }] }] as Parameters<typeof agent.generate>[0], {
      requestContext: profileContext(config), maxSteps: 1, modelSettings: { maxOutputTokens: 4000 },
      abortSignal: AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]),
    });
    if (result.error || result.finishReason === 'error') throw new Error('transcription_failed');
    await recordUsage({ ...owner, config: usageConfig, task: 'transcription', status: 'completed', usage: result.usage, finishReason: result.finishReason, durationMs: performance.now() - started });
    return result.text.trim().slice(0, 8000);
  } catch (error) {
    await recordUsage({ ...owner, config: usageConfig, task: 'transcription', status: 'failed', durationMs: performance.now() - started }).catch(() => undefined);
    throw error;
  }
}

export class TranscriptionError extends Error {
  constructor(public reason: 'size' | 'unsupported') { super(`transcription_${reason}`); }
}
