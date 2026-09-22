"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { UIMessage } from "ai";
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/ai-sdk";
import {
  ArrowUp,
  ArrowDown,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  FileStack,
  FileText,
  History,
  Image as ImageIcon,
  LoaderCircle,
  MessageSquarePlus,
  Mic,
  Plus,
  RefreshCw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { AgentSourcesPanel, type AgentContext } from "@/components/agent-sources-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { DOCUMENT_ACCEPT, IMAGE_ACCEPT, type Modalities } from "@/lib/ai-modalities";
import { cn } from "@/lib/utils";

export type OfficeModelOption = {
  provider: string;
  providerLabel: string;
  modelId: string;
  label: string;
  isDefault: boolean;
  modalities: Modalities;
};

type Conversation = { id: string; title: string; updatedAt: string };
type Attachment = { mediaType: string; data: string };

function unwrapConversations(value: unknown): Conversation[] {
  if (Array.isArray(value)) return value as Conversation[];
  if (value && typeof value === "object" && Array.isArray((value as { conversations?: unknown }).conversations)) {
    return (value as { conversations: Conversation[] }).conversations;
  }
  return [];
}

function unwrapConversation(value: unknown): Conversation | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { conversation?: Conversation; id?: string; title?: string; updatedAt?: string };
  if (record.conversation) return record.conversation;
  return typeof record.id === "string"
    ? { id: record.id, title: record.title || "Nova conversa", updatedAt: record.updatedAt || new Date().toISOString() }
    : null;
}

function unwrapMessages(value: unknown): UIMessage[] {
  if (!value || typeof value !== "object") return [];
  const messages = (value as { messages?: unknown }).messages;
  return Array.isArray(messages) ? (messages as UIMessage[]) : [];
}

const MESSAGE_CACHE = "k5.conversation.messages.";
const LIST_OPEN_KEY = "k5.agent_list_open";
const LIST_OPEN_EVENT = "k5:agent-list-open";
const memoryMessages = new Map<string, UIMessage[]>();

/**
 * Whether the conversation list is open belongs to localStorage, not to React state: it has to
 * survive a reload, and reading it back in an effect would set state during the first commit.
 * `storage` only fires in the other tabs, so a write here announces itself to this one.
 */
function subscribeListOpen(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(LIST_OPEN_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(LIST_OPEN_EVENT, onStoreChange);
  };
}

function readListOpen() {
  const saved = window.localStorage.getItem(LIST_OPEN_KEY);
  if (saved === "1" || saved === "0") return saved === "1";
  return window.matchMedia("(min-width: 768px)").matches;
}

// The server knows neither the viewport nor the saved choice; the client snapshot corrects it.
function serverListOpen() {
  return false;
}

function writeListOpen(next: boolean) {
  window.localStorage.setItem(LIST_OPEN_KEY, next ? "1" : "0");
  window.dispatchEvent(new Event(LIST_OPEN_EVENT));
}

function cachedMessages(id: string): UIMessage[] | undefined {
  const hit = memoryMessages.get(id);
  if (hit) return hit;
  try {
    const raw = sessionStorage.getItem(MESSAGE_CACHE + id);
    if (!raw) return;
    const parsed = JSON.parse(raw) as UIMessage[];
    if (!Array.isArray(parsed)) return;
    memoryMessages.set(id, parsed);
    return parsed;
  } catch {
    return;
  }
}

function storeMessages(id: string, next: UIMessage[]) {
  memoryMessages.set(id, next);
  try {
    sessionStorage.setItem(MESSAGE_CACHE + id, JSON.stringify(next));
  } catch {
    /* Quota is not worth failing the conversation over. */
  }
}

function formatUpdatedAt(iso: string) {
  const delta = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(delta) || delta < 45_000) return "Agora";
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
}

function chatErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { error?: unknown };
      if (typeof parsed?.error === "string" && parsed.error) return parsed.error;
    } catch {
      // Not a JSON body (e.g. network failure) — fall through to the raw/generic message.
    }
  }
  return raw || "Não foi possível enviar a mensagem.";
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="mx-auto grid w-full max-w-3xl justify-items-end px-4 py-3 md:px-8">
      <div className="max-w-[88%] rounded-2xl bg-secondary px-4 py-3 text-sm leading-6 whitespace-pre-wrap md:max-w-[78%]">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

/** The model writes Markdown; this is what turns it into headings, lists and tables. */
function AssistantText({ text }: { text: string }) {
  return <Markdown text={text} />;
}

/** One finished tool call, as a quiet line above the answer. */
function ToolStep({ data }: { data: { summary?: string; state?: string } }) {
  if (!data?.summary) return null;
  return (
    <p className={`mb-2 text-[13px] ${data.state === "failed" ? "text-destructive" : "text-subtle-foreground"}`}>{data.summary}</p>
  );
}

const assistantParts = { Text: AssistantText, data: { by_name: { tool: ToolStep } } };

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="group mx-auto w-full max-w-3xl px-4 py-4 md:px-8">
      <div className="max-w-[72ch] text-sm leading-7 text-foreground">
        <MessagePrimitive.If hasContent={false}>
          <p className="text-subtle-foreground" aria-live="polite">Pensando…</p>
        </MessagePrimitive.If>
        <MessagePrimitive.Parts components={assistantParts} />
        <MessagePrimitive.If last>
          <AuiIf condition={(state) => state.thread.isRunning}>
            <span className="mt-3 inline-block h-3 w-1.5 animate-pulse bg-foreground motion-reduce:animate-none" aria-label="Respondendo" />
          </AuiIf>
        </MessagePrimitive.If>
        <MessagePrimitive.Error>
          <p className="mt-2 text-sm text-destructive" role="alert">Não foi possível concluir a resposta. Tente novamente.</p>
        </MessagePrimitive.Error>
      </div>
      <ActionBarPrimitive.Root className="mt-1 flex min-h-7 items-center gap-1 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
        <ActionBarPrimitive.Copy className="grid size-11 place-items-center md:size-7 rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Copiar resposta">
          <Copy className="size-3.5" />
        </ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload className="grid size-11 place-items-center md:size-7 rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Gerar novamente">
          <RefreshCw className="size-3.5" />
        </ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

const composerControl = "grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-auto disabled:cursor-not-allowed disabled:text-subtle-foreground disabled:hover:bg-transparent";

/** A control that stays visible when the model cannot do the thing, and says why. */
function HintedControl({ hint, children }: { hint?: string; children: React.ReactNode }) {
  if (!hint) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild><span className="inline-flex">{children}</span></TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

function ModelSwitcher({ models, value, onChange }: { models: OfficeModelOption[]; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = models.find((model) => `${model.provider}:${model.modelId}` === value);
  if (models.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label="Selecionar modelo" className="flex h-9 max-w-[42vw] items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-56 md:text-sm">
          <span className="truncate">{selected?.modelId ?? "Modelo"}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Buscar modelo" />
          <CommandList>
            <CommandEmpty>Nenhum modelo com esse nome.</CommandEmpty>
            <CommandGroup>
              {models.map((model) => {
                const key = `${model.provider}:${model.modelId}`;
                return (
                  <CommandItem key={key} value={`${model.providerLabel} ${model.modelId}`} onSelect={() => { onChange(key); setOpen(false); }}>
                    <Check className={`size-4 shrink-0 ${key === value ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{model.modelId}</span>
                      <span className="block truncate text-xs text-muted-foreground">{model.providerLabel}</span>
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

type ComposerToolsProps = {
  models: OfficeModelOption[];
  modelKey: string;
  onModelChange: (value: string) => void;
  modalities: Modalities;
  uploading: boolean;
  onPickFile: (file: File) => void;
  audio: Attachment | null;
  onAudio: (attachment: Attachment | null) => void;
  onError: (message: string) => void;
};

function ComposerTools({ models, modelKey, onModelChange, modalities, uploading, onPickFile, audio, onAudio, onError }: ComposerToolsProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [accept, setAccept] = useState(DOCUMENT_ACCEPT);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);

  function pick(kind: "document" | "image") {
    setAccept(kind === "image" ? IMAGE_ACCEPT : DOCUMENT_ACCEPT);
    setMenuOpen(false);
    // The accept attribute has to be applied before the dialog opens.
    window.setTimeout(() => fileInput.current?.click(), 0);
  }

  async function toggleRecording() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      media.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      media.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: media.mimeType || "audio/webm" });
        if (!blob.size) return;
        if (blob.size > 5_000_000) { onError("A gravação é longa demais. Grave até cerca de um minuto."); return; }
        const buffer = await blob.arrayBuffer();
        let binary = "";
        const bytes = new Uint8Array(buffer);
        for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
        onAudio({ mediaType: blob.type.split(";")[0] || "audio/webm", data: window.btoa(binary) });
      };
      recorder.current = media;
      media.start();
      setRecording(true);
    } catch {
      onError("Não foi possível acessar o microfone.");
    }
  }

  const audioHint = modalities.audio ? undefined : "Este modelo não aceita áudio. Escolha outro modelo para gravar.";

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onPickFile(file);
        }}
      />
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={composerControl} aria-label="Anexar arquivo" disabled={uploading}>
            {uploading ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Plus className="size-4.5" />}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-64 p-1">
          <button type="button" onClick={() => pick("document")} className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted md:min-h-9">
            <FileText className="size-4 text-muted-foreground" aria-hidden="true" />Documento ou planilha
          </button>
          <HintedControl hint={modalities.image ? undefined : "Este modelo não lê imagens. O arquivo entraria só como texto reconhecido."}>
            <button type="button" onClick={() => pick("image")} disabled={!modalities.image} className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted disabled:cursor-not-allowed disabled:text-subtle-foreground disabled:hover:bg-transparent md:min-h-9">
              <ImageIcon className="size-4 text-muted-foreground" aria-hidden="true" />Imagem
            </button>
          </HintedControl>
        </PopoverContent>
      </Popover>

      <HintedControl hint={audioHint}>
        <button
          type="button"
          onClick={() => void toggleRecording()}
          disabled={!modalities.audio}
          aria-pressed={recording}
          aria-label={recording ? "Parar gravação" : "Gravar áudio"}
          className={`${composerControl} ${recording ? "bg-muted text-foreground" : ""}`}
        >
          <Mic className="size-4.5" />
        </button>
      </HintedControl>

      <ModelSwitcher models={models} value={modelKey} onChange={onModelChange} />

      {audio && (
        <button type="button" onClick={() => onAudio(null)} className="flex h-9 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Áudio anexado<X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </>
  );
}

function K5Thread({ tools }: { tools: ComposerToolsProps }) {
  const [away, setAway] = useState(false);
  return (
    <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
      <ThreadPrimitive.Viewport data-chat-viewport className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain" turnAnchor="bottom" onScroll={event => {
        const el = event.currentTarget;
        setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 240);
      }}>
        <ThreadPrimitive.Empty>
          <div className="mx-auto grid w-full max-w-3xl flex-1 place-items-center px-6 py-14 text-center">
            <p className="max-w-sm text-sm leading-6 text-subtle-foreground">Pergunte o que precisar. O assistente também consulta os documentos do escritório.</p>
          </div>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />

        <ThreadPrimitive.ViewportFooter className="sticky bottom-0 z-10 mt-auto shrink-0 bg-background/95 px-4 pb-4 pt-2 md:px-8 md:pb-6">
          {away && <ThreadPrimitive.ScrollToBottom aria-label="Voltar ao mais recente" title="Voltar ao mais recente" behavior="auto" className="absolute -top-12 left-1/2 grid size-11 -translate-x-1/2 place-items-center rounded-full border bg-background shadow-[var(--shadow-float)] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:hidden"><ArrowDown className="size-4" /></ThreadPrimitive.ScrollToBottom>}
          <ComposerPrimitive.Root className="mx-auto w-full max-w-3xl rounded-2xl border bg-background p-2 shadow-[var(--shadow-float)] transition focus-within:border-input">
            <ComposerPrimitive.Input
              rows={away ? 1 : 2}
              placeholder="Pergunte ao Lume"
              aria-label="Pergunte ao Lume"
              className={cn("max-h-[25dvh] w-full resize-none bg-transparent px-2 pt-2 pb-1 text-base outline-none transition-[min-height] duration-200 motion-reduce:transition-none placeholder:text-subtle-foreground md:text-sm", away ? "min-h-10" : "min-h-16")}
            />
            <div className="flex items-center gap-1">
              <ComposerTools {...tools} />
              <div className="ml-auto flex items-center gap-2">
                <AuiIf condition={(state) => state.thread.isRunning}>
                  <ComposerPrimitive.Cancel className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Parar resposta">
                    <Square className="size-3.5 fill-current" />
                  </ComposerPrimitive.Cancel>
                </AuiIf>
                <AuiIf condition={(state) => !state.thread.isRunning}>
                  <ComposerPrimitive.Send className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground outline-none transition hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40" aria-label="Enviar mensagem">
                    <ArrowUp className="size-4" />
                  </ComposerPrimitive.Send>
                </AuiIf>
              </div>
            </div>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

function RuntimeThread({ conversationId, messages, context, selectedModel, audio, onAudioSent, tools, onFinish, onError }: {
  conversationId: string;
  messages: UIMessage[];
  context: AgentContext;
  selectedModel?: { provider: string; modelId: string };
  audio: Attachment | null;
  onAudioSent: () => void;
  tools: ComposerToolsProps;
  onFinish: () => void;
  onError: (message: string) => void;
}) {
  const transport = useMemo(
    () => new AssistantChatTransport({
      api: "/api/chat",
      body: {
        conversationId,
        documentIds: context.documentIds,
        ...(selectedModel ? { model: selectedModel } : {}),
      },
      // The server holds the authoritative history; only the affected message needs to
      // travel over the wire (keeps requests under the server's body-size limit on long
      // conversations, and gives the route what it needs to merge retries/regenerations).
      prepareSendMessagesRequest: async ({ messages: history, trigger, messageId, body: preparedBody }) => {
        // The recording travels with this message only; sending spends it.
        if (audio) onAudioSent();
        return {
          body: {
            ...preparedBody,
            ...(selectedModel ? { model: selectedModel } : {}),
            ...(audio ? { attachments: [audio] } : {}),
            message: history.at(-1),
            trigger,
            messageId,
          },
        };
      },
    }),
    [audio, onAudioSent, context.documentIds, conversationId, selectedModel],
  );
  const runtime = useChatRuntime({
    id: conversationId,
    messages,
    transport,
    onFinish,
    onError: (error) => onError(chatErrorMessage(error)),
  });
  return <AssistantRuntimeProvider runtime={runtime}><K5Thread tools={tools} /></AssistantRuntimeProvider>;
}

export function AgentChat({ initialConversationId = '' }: { initialConversationId?: string }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [context, setContext] = useState<AgentContext>({ caseId: null, documentIds: [] });
  const [contextOpen, setContextOpen] = useState(false);
  const listOpen = useSyncExternalStore(subscribeListOpen, readListOpen, serverListOpen);
  const [availableModels, setAvailableModels] = useState<OfficeModelOption[]>([]);
  const [selectedModelKey, setSelectedModelKey] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [audio, setAudio] = useState<Attachment | null>(null);
  function toggleList() {
    writeListOpen(!listOpen);
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/models")
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { models?: OfficeModelOption[]; defaultModel?: OfficeModelOption | null };
        if (cancelled) return;
        const list = data.models ?? [];
        setAvailableModels(list);
        if (list.length > 0) {
          const saved = typeof window !== "undefined" ? localStorage.getItem("k5_selected_model") : null;
          const match = saved ? list.find((m) => `${m.provider}:${m.modelId}` === saved) : undefined;
          const active = match ?? data.defaultModel ?? list[0];
          if (active) setSelectedModelKey(`${active.provider}:${active.modelId}`);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  // A voice note belongs to the message it was recorded for, so it is spent on send.
  const clearAudio = useCallback(() => setAudio(null), []);

  const handleModelChange = (value: string) => {
    setSelectedModelKey(value);
    if (typeof window !== "undefined") localStorage.setItem("k5_selected_model", value);
  };

  const selectedModel = useMemo(() => {
    if (!selectedModelKey) return undefined;
    const [provider, ...rest] = selectedModelKey.split(":");
    return { provider, modelId: rest.join(":") };
  }, [selectedModelKey]);

  const modalities = useMemo(
    () => availableModels.find((model) => `${model.provider}:${model.modelId}` === selectedModelKey)?.modalities ?? { image: false, audio: false },
    [availableModels, selectedModelKey],
  );

  /**
   * An attachment goes to the Cofre and becomes a source of this conversation: it is extracted,
   * indexed and citable, which a transient upload attached to one prompt would never be.
   */
  const attachFile = useCallback(async (file: File) => {
    setUploading(true);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("scope", context.caseId ? "case" : "library");
      if (context.caseId) body.set("caseId", context.caseId);
      const response = await fetch("/api/vault/documents", { method: "POST", body });
      const result = (await response.json().catch(() => null)) as { error?: string; document?: { id: string } } | null;
      if (!response.ok || !result?.document) throw new Error(result?.error ?? "Não foi possível enviar o arquivo.");
      const documentId = result.document.id;
      let ready = false;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const check = await fetch(`/api/vault/documents/${encodeURIComponent(documentId)}`, { cache: "no-store" });
        const payload = (await check.json().catch(() => null)) as { document?: { status?: string; errorMessage?: string | null } } | null;
        const status = payload?.document?.status;
        if (status === "ready") {
          ready = true;
          break;
        }
        if (status === "failed") throw new Error(payload?.document?.errorMessage || "Não foi possível processar o arquivo.");
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }
      // The retrieval rejects a source that is not ready, so the document only joins this
      // conversation once the extraction finished: a timeout leaves it in the Cofre, not here.
      if (!ready) throw new Error("O arquivo ainda está em processamento. Ele foi salvo no Cofre; selecione-o em Fontes quando estiver pronto.");
      setContext((current) => ({ ...current, documentIds: [...current.documentIds, documentId] }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar o arquivo.");
    } finally {
      setUploading(false);
    }
  }, [context.caseId]);

  const loadConversations = useCallback(async () => {
    const response = await fetch("/api/conversations");
    if (!response.ok) throw new Error("Não foi possível carregar o histórico.");
    const next = unwrapConversations(await response.json());
    setConversations(next);
    return next;
  }, []);

  const createConversation = useCallback(async () => {
    setError("");
    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error("Não foi possível criar uma conversa.");
    const conversation = unwrapConversation(await response.json());
    if (!conversation) throw new Error("A nova conversa não retornou um identificador.");
    setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
    storeMessages(conversation.id, []);
    setMessages([]);
    setLoadedConversationId(conversation.id);
    setSelectedId(conversation.id);
    return conversation;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const next = await loadConversations();
        if (cancelled) return;
        if (initialConversationId && next.some(item => item.id === initialConversationId)) setSelectedId(initialConversationId);
        else if (next[0]) setSelectedId(next[0].id);
        else await createConversation();
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Não foi possível abrir o chat.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void initialize();
    return () => { cancelled = true; };
  }, [createConversation, loadConversations, initialConversationId]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    fetch(`/api/conversations/${encodeURIComponent(selectedId)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível abrir esta conversa.");
        const next = unwrapMessages(await response.json());
        storeMessages(selectedId, next);
        setMessages(next);
        setLoadedConversationId(selectedId);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Não foi possível abrir esta conversa.");
        setMessages(cachedMessages(selectedId) ?? []);
        setLoadedConversationId(selectedId);
      });
    return () => controller.abort();
  }, [selectedId]);

  async function removeConversation(id: string) {
    const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) {
      setError("Não foi possível excluir a conversa.");
      return;
    }
    const remaining = conversations.filter((conversation) => conversation.id !== id);
    setConversations(remaining);
    if (selectedId === id) {
      if (remaining[0]) setSelectedId(remaining[0].id);
      else void createConversation().catch((cause) => setError(cause instanceof Error ? cause.message : "Não foi possível criar uma conversa."));
    }
  }

  const selectedCount = context.documentIds.length;

  const composerTools: ComposerToolsProps = {
    models: availableModels,
    modelKey: selectedModelKey,
    onModelChange: handleModelChange,
    modalities,
    uploading,
    onPickFile: (file) => void attachFile(file),
    audio,
    onAudio: setAudio,
    onError: setError,
  };

  // The cache is read during render rather than copied into state by an effect: the conversation
  // paints from it on the first pass, and the fetched messages take over once they land.
  const cachedForSelected = selectedId ? cachedMessages(selectedId) : undefined;
  const visibleMessages = selectedId && loadedConversationId === selectedId ? messages : cachedForSelected ?? [];
  const waitingForMessages = Boolean(selectedId && loadedConversationId !== selectedId && !cachedForSelected);

  function selectConversation(id: string) {
    setSelectedId(id);
    if (window.matchMedia("(max-width: 767px)").matches) {
      writeListOpen(false);
    }
  }

  return (
    <TooltipProvider>
      <div className="agent-chat flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="display truncate text-[28px]">Lume</h1>
            <Button variant="ghost" size="icon" aria-label={listOpen ? "Recolher conversas" : "Mostrar conversas"} aria-expanded={listOpen} onClick={toggleList}><History /></Button>
            <Button variant="ghost" size="icon" onClick={() => void createConversation().catch((cause) => setError(cause instanceof Error ? cause.message : "Não foi possível criar uma conversa."))} aria-label="Nova conversa"><MessageSquarePlus /></Button>
          </div>
          <div className="flex items-center gap-1.5">
            <Sheet open={contextOpen} onOpenChange={setContextOpen}>
              <SheetTrigger asChild><Button variant="outline"><FileStack />Fontes{selectedCount > 0 ? ` (${selectedCount})` : ""}</Button></SheetTrigger>
              <SheetContent side="right" showCloseButton={false} className="min-w-0 overflow-x-hidden gap-0 bg-background sm:max-w-md">
                <SheetHeader className="sr-only"><SheetTitle>Fontes desta conversa</SheetTitle></SheetHeader>
                <AgentSourcesPanel context={context} onChange={setContext} onClose={() => setContextOpen(false)} />
              </SheetContent>
            </Sheet>
          </div>
        </header>

        {error && <p className="flex items-start gap-2 border-b px-4 py-2 text-sm text-destructive md:px-8" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}

        <div className="flex min-h-0 flex-1">
          {listOpen && (
            <aside className="flex min-h-0 w-full shrink-0 flex-col overflow-y-auto border-b md:w-72 md:border-r md:border-b-0">
              {loading && conversations.length === 0 ? (
                <div className="grid gap-2 p-3" aria-hidden="true">
                  <Skeleton className="h-16 w-full rounded-2xl" />
                  <Skeleton className="h-16 w-full rounded-2xl" />
                  <Skeleton className="h-16 w-full rounded-2xl" />
                </div>
              ) : (
                <ConversationCards conversations={conversations} selectedId={selectedId} onSelect={selectConversation} onDelete={(id) => void removeConversation(id)} />
              )}
            </aside>
          )}
          <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", listOpen && "max-md:hidden")}>
            {loading || waitingForMessages ? (
              <div className="grid flex-1 place-items-center text-sm text-muted-foreground" role="status" aria-live="polite" aria-busy="true"><span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Carregando conversa…</span></div>
            ) : selectedId ? (
              <RuntimeThread
                key={`${selectedId}:${visibleMessages.map((message) => message.id).join(",")}`}
                conversationId={selectedId}
                messages={visibleMessages}
                context={context}
                selectedModel={selectedModel}
                audio={audio}
                onAudioSent={clearAudio}
                tools={composerTools}
                onFinish={() => {
                  void loadConversations().catch(() => undefined);
                  void fetch(`/api/conversations/${encodeURIComponent(selectedId)}`)
                    .then(async (response) => {
                      if (!response.ok) return;
                      storeMessages(selectedId, unwrapMessages(await response.json()));
                    })
                    .catch(() => undefined);
                }}
                onError={setError}
              />
            ) : (
              <div className="grid flex-1 place-items-center px-6 text-center text-sm text-subtle-foreground">Nenhuma conversa disponível.</div>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function ConversationCards({ conversations, selectedId, onSelect, onDelete }: {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {conversations.length === 0 && <p className="px-2 py-6 text-sm text-subtle-foreground">Seu histórico aparecerá aqui.</p>}
      <div className="grid gap-2">
        {conversations.map((conversation) => (
          <div key={conversation.id} className="relative">
            <button
              type="button"
              onClick={() => onSelect(conversation.id)}
              aria-current={selectedId === conversation.id ? "page" : undefined}
              className={cn(
                "grid w-full gap-1 rounded-2xl border p-3 pr-11 text-left outline-none transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                selectedId === conversation.id && "bg-accent",
              )}
            >
              <span className="truncate text-sm font-medium">{conversation.title || "Nova conversa"}</span>
              <span className="text-[13px] text-subtle-foreground">{formatUpdatedAt(conversation.updatedAt)}</span>
            </button>
            <Button variant="ghost" size="icon-sm" className="absolute top-2 right-2 size-11 md:size-7" onClick={() => onDelete(conversation.id)} aria-label={`Excluir ${conversation.title || "conversa"}`}><Trash2 /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}
