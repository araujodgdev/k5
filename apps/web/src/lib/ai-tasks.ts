import type { AiProvider } from "./ai-connections-core";

/**
 * Tises' model work, named by what it does rather than by the model that happens to run it.
 *
 * The catalog lives in code: adding a task is a code change. Which connection, model and reasoning
 * effort serve a task is platform configuration (ai_model_assignment, migration 0029). A task
 * without its own assignment takes its group's; a group without one takes its parent's. The root
 * group falls back to the provider default of the first active connection, as before 0029.
 *
 * Embeddings are not here: their model and dimension are pinned by the search index.
 */

/** How the task calls the model; it decides which models qualify and how a test probes them. */
export type ExecutionKind = "tool_agent" | "structured" | "transcription";

export const AI_TASK_GROUPS = ["agent", "drafting", "extraction", "summary", "classification", "transcription"] as const;
export type AiTaskGroup = typeof AI_TASK_GROUPS[number];

export const AI_TASK_KEYS = [
  "agent.chat",
  "drafting.outline", "drafting.section",
  "extraction.chronology_facts", "extraction.chronology_review", "extraction.annex_plan",
  "summary.email_digest", "summary.email_thread",
  "classification.injection_guard",
  "transcription.voice_note",
] as const;
export type AiTaskKey = typeof AI_TASK_KEYS[number];

export type AiTaskGroupDefinition = {
  key: AiTaskGroup;
  label: string;
  description: string;
  /** Where an unassigned group takes its model and effort from; null is the end of the chain. */
  parent: AiTaskGroup | null;
  execution: ExecutionKind;
  /** Only an optional feature may be switched off; the others must always resolve to a model. */
  canDisable: boolean;
};

export const AI_TASK_GROUP_DEFINITIONS: Record<AiTaskGroup, AiTaskGroupDefinition> = {
  agent: { key: "agent", label: "Agente", parent: null, execution: "tool_agent", canDisable: false,
    description: "Conversa do Tises com ferramentas, busca e memória." },
  drafting: { key: "drafting", label: "Redação jurídica", parent: "agent", execution: "structured", canDisable: false,
    description: "Estrutura e texto das minutas que o advogado revisa e assina." },
  extraction: { key: "extraction", label: "Extração de documentos", parent: "agent", execution: "structured", canDisable: false,
    description: "Leitura de documentos longos com saída estruturada conferida pelo sistema." },
  summary: { key: "summary", label: "Resumo e texto curto", parent: "extraction", execution: "structured", canDisable: false,
    description: "Panoramas e respostas curtas de e-mail, depois dos julgamentos do Jev." },
  classification: { key: "classification", label: "Classificação e segurança", parent: "extraction", execution: "structured", canDisable: false,
    description: "Verificação de instruções escondidas em textos de terceiros antes que o agente os leia." },
  // No parent: until it is assigned, transcription follows the agent's provider (see the resolver).
  transcription: { key: "transcription", label: "Transcrição", parent: null, execution: "transcription", canDisable: true,
    description: "Notas de voz do composer, convertidas em texto antes do envio." },
};

export type AiTaskDefinition = { key: AiTaskKey; group: AiTaskGroup; label: string; description: string };

export const AI_TASK_DEFINITIONS: Record<AiTaskKey, AiTaskDefinition> = {
  "agent.chat": { key: "agent.chat", group: "agent", label: "Conversa", description: "Cada turno do Tises, com até oito passos de ferramenta." },
  "drafting.outline": { key: "drafting.outline", group: "drafting", label: "Estrutura da minuta", description: "Seções e termos de busca a partir do pedido e do modelo." },
  "drafting.section": { key: "drafting.section", group: "drafting", label: "Seções da minuta", description: "Texto de cada seção, com evidências das fontes do caso." },
  "extraction.chronology_facts": { key: "extraction.chronology_facts", group: "extraction", label: "Fatos da cronologia", description: "Acontecimentos de cada fonte, com citação literal verificada." },
  "extraction.chronology_review": { key: "extraction.chronology_review", group: "extraction", label: "Divergências da cronologia", description: "Datas, valores e envolvidos incompatíveis entre fontes." },
  "extraction.annex_plan": { key: "extraction.annex_plan", group: "extraction", label: "Anexos do PJe", description: "Documentos de um PDF digitalizado e onde a petição os cita." },
  "summary.email_digest": { key: "summary.email_digest", group: "summary", label: "Panorama de e-mails", description: "Resumo do dia, da semana ou do mês." },
  "summary.email_thread": { key: "summary.email_thread", group: "summary", label: "Resumo e respostas rápidas", description: "Uma conversa de e-mail e até três respostas prontas." },
  "classification.injection_guard": { key: "classification.injection_guard", group: "classification", label: "Guarda contra injeção", description: "E-mails, Docs, publicações e páginas da web lidos pelo agente." },
  "transcription.voice_note": { key: "transcription.voice_note", group: "transcription", label: "Nota de voz", description: "Gravações do composer e áudios enviados na conversa." },
};

export const REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];

export const reasoningEffortLabels: Record<ReasoningEffort, string> = {
  minimal: "Mínimo", low: "Baixo", medium: "Médio", high: "Alto", xhigh: "Muito alto",
};

/**
 * Providers whose request carries an explicit reasoning effort. Elsewhere the provider's own
 * default applies, and an explicit effort cannot be saved.
 */
const EFFORT_PROVIDERS: ReadonlySet<AiProvider> = new Set<AiProvider>(["openai"]);

export function supportsReasoningEffort(provider: AiProvider): boolean {
  return EFFORT_PROVIDERS.has(provider);
}

export const isAiTaskGroup = (value: unknown): value is AiTaskGroup => AI_TASK_GROUPS.includes(value as AiTaskGroup);
export const isAiTaskKey = (value: unknown): value is AiTaskKey => AI_TASK_KEYS.includes(value as AiTaskKey);

export function tasksOfGroup(group: AiTaskGroup): AiTaskKey[] {
  return AI_TASK_KEYS.filter((key) => AI_TASK_DEFINITIONS[key].group === group);
}

/** The group's chain upward, the group itself first. */
export function groupChain(group: AiTaskGroup): AiTaskGroup[] {
  const chain: AiTaskGroup[] = [];
  for (let current: AiTaskGroup | null = group; current; current = AI_TASK_GROUP_DEFINITIONS[current].parent) chain.push(current);
  return chain;
}

/** Groups whose tasks resolve through this one when they have no assignment of their own. */
export function descendantGroups(group: AiTaskGroup): AiTaskGroup[] {
  return AI_TASK_GROUPS.filter((candidate) => candidate !== group && groupChain(candidate).includes(group));
}

/** Transcription models answer on the transcription endpoint, not in a conversation. */
export function isTranscriptionModel(provider: AiProvider, modelId: string): boolean {
  return provider === "openai" && /(transcribe|whisper)/i.test(modelId);
}
