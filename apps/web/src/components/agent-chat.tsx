"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  CircleAlert,
  Copy,
  Cpu,
  FileStack,
  History,
  LoaderCircle,
  MessageSquarePlus,
  RefreshCw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { AgentContextPanel, type AgentContext } from "@/components/agent-context-panel";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export type OfficeModelOption = {
  provider: string;
  providerLabel: string;
  modelId: string;
  label: string;
  isDefault: boolean;
};

type Conversation = { id: string; title: string; updatedAt: string };

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
      <div className="max-w-[88%] rounded-2xl bg-secondary px-4 py-3 text-sm leading-6 md:max-w-[78%]">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="group mx-auto w-full max-w-3xl px-4 py-4 md:px-8">
      <div className="max-w-[72ch] text-sm leading-7 text-foreground">
        <MessagePrimitive.Parts />
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

function K5Thread() {
  return (
    <ThreadPrimitive.Root className="min-h-0 flex-1">
      <ThreadPrimitive.Viewport className="flex h-full flex-col overflow-y-auto" turnAnchor="top">
        <ThreadPrimitive.Empty>
          <div className="mx-auto grid w-full max-w-3xl flex-1 place-items-center px-6 py-14 text-center">
            <p className="max-w-sm text-sm leading-6 text-subtle-foreground">Pergunte sobre os documentos escolhidos ou prepare uma cronologia e uma minuta.</p>
          </div>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />

        <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mt-auto bg-background/95 px-4 pb-4 pt-2 md:px-8 md:pb-8">
          <ComposerPrimitive.Root className="mx-auto w-full max-w-3xl rounded-2xl border bg-background p-2 pl-4 shadow-[var(--shadow-float)] transition focus-within:border-input">
            <ComposerPrimitive.Input
              rows={2}
              placeholder="Pergunte ao K5"
              aria-label="Pergunte ao K5"
              className="max-h-[40dvh] min-h-16 w-full resize-none bg-transparent p-0 pt-1 text-base outline-none placeholder:text-subtle-foreground md:text-sm"
            />
            <div className="flex items-center justify-end gap-3">
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
          </ComposerPrimitive.Root>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

function RuntimeThread({ conversationId, messages, context, selectedModel, onFinish, onError }: {
  conversationId: string;
  messages: UIMessage[];
  context: AgentContext;
  selectedModel?: { provider: string; modelId: string };
  onFinish: () => void;
  onError: (message: string) => void;
}) {
  const transport = useMemo(
    () => new AssistantChatTransport({
      api: "/api/chat",
      body: {
        conversationId,
        documentIds: context.documentIds,
        ...(context.caseId ? { caseId: context.caseId } : {}),
        ...(selectedModel ? { model: selectedModel } : {}),
      },
      // The server holds the authoritative history; only the affected message needs to
      // travel over the wire (keeps requests under the server's body-size limit on long
      // conversations, and gives the route what it needs to merge retries/regenerations).
      prepareSendMessagesRequest: async ({ messages: history, trigger, messageId, body: preparedBody }) => ({
        body: {
          ...preparedBody,
          ...(selectedModel ? { model: selectedModel } : {}),
          message: history.at(-1),
          trigger,
          messageId,
        },
      }),
    }),
    [context.caseId, context.documentIds, conversationId, selectedModel],
  );
  const runtime = useChatRuntime({
    id: conversationId,
    messages,
    transport,
    onFinish,
    onError: (error) => onError(chatErrorMessage(error)),
  });
  return <AssistantRuntimeProvider runtime={runtime}><K5Thread /></AssistantRuntimeProvider>;
}

export function AgentChat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [context, setContext] = useState<AgentContext>({ caseId: null, documentIds: [] });
  const [contextOpen, setContextOpen] = useState(false);
  const [availableModels, setAvailableModels] = useState<OfficeModelOption[]>([]);
  const [selectedModelKey, setSelectedModelKey] = useState<string>("");

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
          if (active) {
            setSelectedModelKey(`${active.provider}:${active.modelId}`);
          }
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const handleModelChange = (value: string) => {
    setSelectedModelKey(value);
    if (typeof window !== "undefined") {
      localStorage.setItem("k5_selected_model", value);
    }
  };

  const selectedModel = useMemo(() => {
    if (!selectedModelKey) return undefined;
    const [provider, ...rest] = selectedModelKey.split(":");
    return { provider, modelId: rest.join(":") };
  }, [selectedModelKey]);

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
    setMessages([]);
    setSelectedId(conversation.id);
    return conversation;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const next = await loadConversations();
        if (cancelled) return;
        if (next[0]) setSelectedId(next[0].id);
        else await createConversation();
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Não foi possível abrir o chat.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void initialize();
    return () => { cancelled = true; };
  }, [createConversation, loadConversations]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    fetch(`/api/conversations/${encodeURIComponent(selectedId)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível abrir esta conversa.");
        setMessages(unwrapMessages(await response.json()));
        setLoadedConversationId(selectedId);
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível abrir esta conversa."); })
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-16 items-center justify-between gap-3 border-b px-4 md:px-8">
        <div className="flex min-w-0 items-center gap-2">
          <Sheet>
            <SheetTrigger asChild><Button variant="ghost" size="icon" aria-label="Abrir histórico"><History /></Button></SheetTrigger>
            <SheetContent side="left" showCloseButton={false} className="gap-0 bg-background">
              <ConversationHistory conversations={conversations} selectedId={selectedId} onSelect={setSelectedId} onCreate={() => void createConversation().catch((cause) => setError(cause instanceof Error ? cause.message : "Não foi possível criar uma conversa."))} onDelete={(id) => void removeConversation(id)} />
            </SheetContent>
          </Sheet>
          <h1 className="display truncate text-[28px]">Agentes</h1>
        </div>
        <div className="flex items-center gap-1.5">
          {availableModels.length > 0 && (
            <Select value={selectedModelKey} onValueChange={handleModelChange}>
              <SelectTrigger size="sm" className="h-9 gap-1.5 text-xs font-medium md:text-sm" aria-label="Selecionar modelo">
                <Cpu className="size-3.5 text-muted-foreground" />
                <SelectValue placeholder="Modelo" />
              </SelectTrigger>
              <SelectContent align="end">
                {availableModels.map((m) => (
                  <SelectItem key={`${m.provider}:${m.modelId}`} value={`${m.provider}:${m.modelId}`}>
                    <span className="font-medium">{m.providerLabel}</span>
                    <span className="ml-1.5 font-mono text-xs text-muted-foreground">({m.modelId})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="ghost" size="icon" onClick={() => void createConversation().catch((cause) => setError(cause instanceof Error ? cause.message : "Não foi possível criar uma conversa."))} aria-label="Nova conversa"><MessageSquarePlus /></Button>
          <Sheet open={contextOpen} onOpenChange={setContextOpen}>
            <SheetTrigger asChild><Button variant="outline"><FileStack />Fontes{selectedCount > 0 ? ` (${selectedCount})` : ""}</Button></SheetTrigger>
            <SheetContent side="right" showCloseButton={false} className="gap-0 bg-background sm:max-w-md">
              <SheetHeader className="sr-only"><SheetTitle>Preparar documento</SheetTitle></SheetHeader>
              <AgentContextPanel context={context} onChange={setContext} onClose={() => setContextOpen(false)} />
            </SheetContent>
          </Sheet>
        </div>
      </header>

      {error && <p className="flex items-start gap-2 border-b px-4 py-2 text-sm text-destructive md:px-8" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
      {loading || (selectedId !== null && loadedConversationId !== selectedId) ? (
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground"><span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />Carregando conversa…</span></div>
      ) : selectedId ? (
        <RuntimeThread key={`${selectedId}:${messages.map((message) => message.id).join(",")}:${selectedModelKey}`} conversationId={selectedId} messages={messages} context={context} selectedModel={selectedModel} onFinish={() => void loadConversations().catch(() => undefined)} onError={setError} />
      ) : (
        <div className="grid flex-1 place-items-center px-6 text-center text-sm text-subtle-foreground">Nenhuma conversa disponível.</div>
      )}
    </div>
  );
}

function ConversationHistory({ conversations, selectedId, onSelect, onCreate, onDelete }: {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b px-4 py-4">
        <SheetTitle>Conversas</SheetTitle>
        <SheetClose asChild><Button variant="ghost" size="icon" aria-label="Fechar histórico"><X /></Button></SheetClose>
      </div>
      <div className="p-3"><Button className="w-full" onClick={onCreate}><MessageSquarePlus />Nova conversa</Button></div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {conversations.length === 0 && <p className="px-2 py-6 text-sm text-subtle-foreground">Seu histórico aparecerá aqui.</p>}
        {conversations.map((conversation) => (
          <div key={conversation.id} className="group flex items-center border-b">
            <SheetClose asChild>
              <button type="button" onClick={() => onSelect(conversation.id)} aria-current={selectedId === conversation.id ? "page" : undefined} className="min-h-12 min-w-0 flex-1 truncate px-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:font-medium">
                {conversation.title || "Nova conversa"}
              </button>
            </SheetClose>
            <Button variant="ghost" size="icon-sm" className="size-11 md:size-7" onClick={() => onDelete(conversation.id)} aria-label={`Excluir ${conversation.title || "conversa"}`}><Trash2 /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}
