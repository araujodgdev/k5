import { z } from "zod";

/**
 * A profile is one step that calls a model: its own model, reasoning effort and output budget.
 * Each profile inherits the model of the task it came from (chat, extraction, drafting), so a
 * platform with no per-step settings behaves exactly as before the profiles existed.
 */
export const AI_PROFILES = ["chat", "research_web", "extraction_chunk", "extraction_review", "annex_plan", "drafting"] as const;
export type AiProfile = typeof AI_PROFILES[number];

export const REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];
/** Every OpenAI request used this effort before the profiles existed; it stays the default. */
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "xhigh";

export const MIN_OUTPUT_TOKENS = 256;
export const MAX_OUTPUT_TOKENS = 128_000;

type ProfileDefinition = { task: "chat" | "extraction" | "drafting"; maxOutputTokens: number; label: string; description: string; variants: readonly ProfileVariant[] };

/** A second model a step may call: `escalate` redoes work that failed validation, `shadow` runs unseen for comparison. */
export const PROFILE_VARIANTS = ["escalate", "shadow"] as const;
export type ProfileVariant = typeof PROFILE_VARIANTS[number];

export const PROFILE_DEFINITIONS: Record<AiProfile, ProfileDefinition> = {
  chat: { task: "chat", maxOutputTokens: 6000, label: "Conversa", description: "Respostas e ferramentas do Lume.", variants: [] },
  research_web: { task: "chat", maxOutputTokens: 6000, label: "Pesquisa na web", description: "Busca de julgados com a pesquisa do provedor.", variants: [] },
  extraction_chunk: { task: "extraction", maxOutputTokens: 12000, label: "Cronologia: trechos", description: "Acontecimentos de cada trecho dos documentos.", variants: ["escalate", "shadow"] },
  extraction_review: { task: "extraction", maxOutputTokens: 12000, label: "Cronologia: divergências", description: "Comparação dos acontecimentos já extraídos.", variants: [] },
  annex_plan: { task: "extraction", maxOutputTokens: 12000, label: "Plano de anexos", description: "Proposta de separação do PDF digitalizado.", variants: [] },
  drafting: { task: "drafting", maxOutputTokens: 12000, label: "Minutas", description: "Estrutura e redação por seção.", variants: [] },
};

const modelField = z.string().trim().min(1).max(160);
const connectionField = z.string().min(1).max(64);
const variantSchema = z.strictObject({ connectionId: connectionField, modelId: modelField, reasoningEffort: z.enum(REASONING_EFFORTS).nullable().optional() }).nullable();

/** The administrator's settings for one profile; `null` clears a field back to what the task inherits. */
export const profileOverrideSchema = z.strictObject({
  connectionId: connectionField.nullable().optional(),
  modelId: modelField.nullable().optional(),
  reasoningEffort: z.enum(REASONING_EFFORTS).nullable().optional(),
  maxOutputTokens: z.number().int().min(MIN_OUTPUT_TOKENS).max(MAX_OUTPUT_TOKENS).nullable().optional(),
  escalate: variantSchema.optional(),
  shadow: variantSchema.optional(),
});
export type ProfileOverrideInput = z.infer<typeof profileOverrideSchema>;

export type ProfileVariantView = { connectionId: string; modelId: string; reasoningEffort: ReasoningEffort | null };
export type ProfileOverrideView = {
  profile: AiProfile;
  connectionId: string | null; modelId: string | null;
  reasoningEffort: ReasoningEffort | null; maxOutputTokens: number | null;
  escalate: ProfileVariantView | null; shadow: ProfileVariantView | null;
  updatedAt: string | null;
};

export const isAiProfile = (value: unknown): value is AiProfile => (AI_PROFILES as readonly unknown[]).includes(value);
