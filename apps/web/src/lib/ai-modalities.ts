/**
 * What a model accepts as input, beyond text.
 *
 * Documents are deliberately absent from this map: a PDF, DOCX or planilha is read by the Cofre's
 * extractor and reaches the model as retrieved text, so every model can work with one. Images and
 * audio have no such fallback — they are handed to the provider as-is, which is why the composer
 * has to know which models can take them and disable the control for the ones that cannot.
 *
 * The rules are matched against the model id, so a new model of a known family is classified before
 * we ship an update. Anything unmatched is treated as text-only, which fails closed.
 */
export type Modalities = { image: boolean; audio: boolean };

const TEXT_ONLY: Modalities = { image: false, audio: false };

type Rule = { match: RegExp; modalities: Modalities };

const IMAGE: Modalities = { image: true, audio: false };
const IMAGE_AND_AUDIO: Modalities = { image: true, audio: true };

/** Ordered: the first match wins, so narrow ids come before their family. */
const RULES: Rule[] = [
  // OpenAI — audio input is its own set of endpoints and model ids.
  { match: /^(gpt-4o|gpt)-(audio|realtime)/i, modalities: IMAGE_AND_AUDIO },
  { match: /^(gpt-6|gpt-5|gpt-4\.1|gpt-4o|chatgpt-4o|o3|o4)/i, modalities: IMAGE },
  { match: /^(gpt-4-turbo|gpt-4-vision)/i, modalities: IMAGE },
  { match: /^(gpt-3\.5|gpt-4$|gpt-4-0|o1-mini|gpt-4o-mini-tts|gpt-5-chat-latest-text)/i, modalities: TEXT_ONLY },
  { match: /^o1/i, modalities: IMAGE },

  // Anthropic — every Claude 3 and later takes images.
  { match: /^claude-(3|4|5|opus|sonnet|haiku)/i, modalities: IMAGE },
  { match: /^claude-fable/i, modalities: IMAGE },
  { match: /^claude-2/i, modalities: TEXT_ONLY },

  // Google — Gemini takes images and audio natively.
  { match: /^(models\/)?gemini/i, modalities: IMAGE_AND_AUDIO },
  { match: /^(models\/)?(text-embedding|embedding|gemma)/i, modalities: TEXT_ONLY },

  // Other providers in the registry.
  { match: /^deepseek-vl/i, modalities: IMAGE },
  { match: /^(deepseek|mercury|grok-.*-mini-text)/i, modalities: TEXT_ONLY },
  { match: /^grok/i, modalities: IMAGE },
  { match: /^(llama-?3\.2-.*vision|llama-?4|pixtral|llava|qwen.*-vl)/i, modalities: IMAGE },
];

/** Aggregator ids look like `openai/gpt-4o`; the family lives after the last slash. */
function bareModelId(modelId: string) {
  const parts = modelId.split("/").filter(Boolean);
  const last = parts.at(-1) ?? modelId;
  return last.startsWith("models") ? modelId : last;
}

export function modelModalities(provider: string, modelId: string): Modalities {
  if (!modelId) return TEXT_ONLY;
  const id = provider === "google" ? modelId : bareModelId(modelId);
  return RULES.find((rule) => rule.match.test(id))?.modalities ?? TEXT_ONLY;
}

/** Extensions the Cofre can extract text from. These work with every model. */
export const DOCUMENT_ACCEPT = ".pdf,.docx,.eml,.xlsx,.csv,.txt";
export const IMAGE_ACCEPT = ".png,.jpg,.jpeg,.webp";
export const AUDIO_MIME = "audio/webm";
