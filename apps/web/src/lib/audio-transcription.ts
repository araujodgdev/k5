import 'server-only';

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
