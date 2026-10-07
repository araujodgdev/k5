"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import { AssistantRuntimeProvider, ThreadPrimitive } from "@assistant-ui/react";
import { useAISDKRuntime } from "@assistant-ui/ai-sdk";
import { ArrowDown, CircleAlert, FileStack, LoaderCircle, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, SlidersHorizontal } from "lucide-react";
import dynamic from "next/dynamic";
import type { ChatBootstrap } from "@/lib/ai-store";
import type { AgentContext } from "@/components/agent-sources-panel";
import { readListOpen, subscribeListOpen, writeListOpen, serverListOpen } from "@/lib/agent-history";
import { clampChatShare, DEFAULT_CHAT_SHARE, MAX_CHAT_SHARE, MIN_CHAT_SHARE, readChatShare, serverChatShare, subscribeChatShare, writeChatShare } from "@/lib/document-split";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { Modalities } from "@/lib/ai-modalities";
import { cn } from "@/lib/utils";
import { attachmentPart, MAX_CHAT_ATTACHMENTS, MAX_CHAT_FILE_BYTES, MAX_CHAT_IMAGE_BYTES, type ChatAttachment } from "@/lib/chat-attachment-contract";
import type { DocumentAsk, DocumentWorkspaceHandle } from "./document/document-workspace";
import { DocumentPanel } from "./document/document-panel";
import { THINKING, type ChatStatus } from "@/lib/chat-status";
import { applyApprovalDecisions, type ApprovalDecision } from "@/lib/chat-approval-state";
import { useShell, type CanvasSubject } from "@/components/shell/shell-context";
import { placeOf } from "@/components/shell/places";
import { canvasCommandSchema, type CanvasCommand, type CanvasContext } from "@/lib/canvas-protocol";
import {
  ApprovalDecisionsContext, ConversationIdContext, DocumentLinksContext, WorkingContext,
  documentHref, documentIdFrom, type DocumentLinks, type ThreadLayout,
} from "./lume-panel/chat-context";
import { AssistantMessage, UserMessage } from "./lume-panel/messages";
import { Composer, type ComposerChip, type ComposerToolsProps } from "./lume-panel/composer";
import { EmptyState } from "./lume-panel/empty-state";
import { ConversationList, type Conversation } from "./lume-panel/history";
import { PanelHeader } from "./lume-panel/panel-header";
import { subjectChip } from "./lume-panel/icons";
import { buildPlan, panelStatus, type Plan, type PlanPart } from "./lume-panel/plan";
import { documentChanged, registerDocumentAsk } from "./lume-panel/document-bridge";

/**
 * The chat runs in two compositions. `page` is /app/agents in the office's old frame: the
 * conversation list beside the chat and documents in a split. `panel` is the Lume panel the office
 * shell mounts once, beside the canvas: history inside the panel and documents in the canvas.
 */
export type ChatMode =
  | { kind: "page"; initialData?: ChatBootstrap }
  | { kind: "panel" };

type Selection = { artifactId: string; excerpt: string };
/** Read when a message is sent: the open document, a selection spent by that one request, and the canvas. */
type TurnFocus = { openDocumentId: () => string | null; takeSelection: () => Selection | null; canvas: () => CanvasContext | null };
/** The newest turn as the panel header and the shell see it; `place` is the tab it touched last. */
type TurnStatus = { running: boolean; plan: Plan | null; place?: string };

const DocumentWorkspace = dynamic(() => import("./document/document-workspace").then(module => module.DocumentWorkspace), {
  ssr: false,
  loading: () => <p role="status" className="p-6 text-sm text-muted-foreground">Abrindo documento…</p>,
});
const AgentArtifactsPanel = dynamic(() => import("./agent-artifacts-panel").then(module => module.AgentArtifactsPanel), {
  loading: () => <p role="status" className="p-6 text-sm text-muted-foreground">Carregando artefatos…</p>,
});
const EMPTY_TITLE = "Nova conversa";
/** The panel's conversation for this browser tab: a reload keeps it, a new visit starts fresh. */
const PANEL_CONVERSATION = "lume:panel:conversation";

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
    ? { id: record.id, title: record.title || EMPTY_TITLE, updatedAt: record.updatedAt || new Date().toISOString() }
    : null;
}

function unwrapMessages(value: unknown): UIMessage[] {
  if (!value || typeof value !== "object") return [];
  const messages = (value as { messages?: unknown }).messages;
  return Array.isArray(messages) ? (messages as UIMessage[]) : [];
}

const MESSAGE_CACHE = "k5.conversation.messages.";
const memoryMessages = new Map<string, UIMessage[]>();

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

function rememberPanelConversation(id?: string): string | null {
  try {
    if (id) sessionStorage.setItem(PANEL_CONVERSATION, id);
    return sessionStorage.getItem(PANEL_CONVERSATION);
  } catch {
    return null;
  }
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

const planParts = (message: UIMessage | undefined): PlanPart[] => message?.role !== "assistant" ? [] : message.parts.flatMap(part =>
  part.type.startsWith("data-") && "data" in part ? [{ name: part.type.slice(5), data: part.data }] : []);

function LumeThread({ tools, layout, userName, subject, chip }: {
  tools: ComposerToolsProps; layout: ThreadLayout; userName: string; subject: CanvasSubject | null; chip: ComposerChip | null;
}) {
  const [away, setAway] = useState(false);
  const column = layout === "page" ? "mx-auto w-full max-w-[680px] px-6" : "px-5 max-md:px-4";
  return (
    <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
      <ThreadPrimitive.Viewport data-chat-viewport turnAnchor="bottom"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain [scrollbar-color:var(--border-strong)_transparent] [scrollbar-width:thin]"
        onScroll={event => {
          const el = event.currentTarget;
          setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 240);
        }}>
        <div className={cn("flex flex-1 flex-col gap-4 max-md:gap-3", column, layout === "page" ? "pt-6 pb-3" : "pt-3 pb-3 max-md:pt-3.5")}>
          <ThreadPrimitive.Empty><EmptyState userName={userName} subject={subject} /></ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        </div>
        <ThreadPrimitive.ViewportFooter className={cn("sticky bottom-0 z-10 mt-auto shrink-0", layout === "page" ? "bg-background" : "bg-pane max-md:bg-background")}>
          {away && <ThreadPrimitive.ScrollToBottom aria-label="Voltar ao mais recente" title="Voltar ao mais recente" behavior="auto"
            className="absolute -top-12 left-1/2 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-border bg-card shadow-[var(--shadow-float)] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:hidden max-md:size-11">
            <ArrowDown className="size-4" />
          </ThreadPrimitive.ScrollToBottom>}
          <div className={layout === "page" ? "mx-auto w-full max-w-[680px] px-6 pt-2 pb-7 max-md:px-3 max-md:pb-3" : "px-3.5 pt-2 pb-3.5 max-md:px-3 max-md:pb-3"}>
            <Composer tools={tools} chip={chip} />
          </div>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

function RuntimeThread({ conversationId, messages, context, onFilesSent, tools, onFinish, onError, onStatus, onCanvas, focus, sendRef, layout, userName, subject, chip }: {
  conversationId: string;
  /** What the person has open; read when each message is sent. */
  focus: TurnFocus;
  /** What the canvas should do while the Lume works, as the server streams it. */
  onCanvas: (command: CanvasCommand) => void;
  /** Lets the document send a message into this thread. */
  sendRef: React.RefObject<((text: string) => void) | null>;
  messages: UIMessage[];
  context: AgentContext;
  onFilesSent: (ids: string[]) => void;
  tools: ComposerToolsProps;
  onFinish: () => void;
  onError: (message: string) => void;
  onStatus: (status: TurnStatus) => void;
  layout: ThreadLayout;
  userName: string;
  subject: CanvasSubject | null;
  chip: ComposerChip | null;
}) {
  // The newest message on screen: a reopened page asks the server for the turn still running,
  // and gets nothing back when this is already its finished answer.
  const lastMessageId = messages.at(-1)?.id ?? "";
  const transport = useMemo(
    () => new DefaultChatTransport({
      api: "/api/chat",
      prepareReconnectToStreamRequest: () => ({
        api: `/api/chat/${encodeURIComponent(conversationId)}/stream?last=${encodeURIComponent(lastMessageId)}`,
      }),
      // The server holds the authoritative history; only the affected message needs to
      // travel over the wire (keeps requests under the server's body-size limit on long
      // conversations, and gives the route what it needs to merge retries/regenerations).
      prepareSendMessagesRequest: async ({ messages: history, trigger, messageId }) => {
        const message = history.findLast(item => item.role === "user");
        const attachmentIds = message?.parts.flatMap(part => part.type === "data-attachment" && part.data && typeof part.data === "object" && "id" in part.data ? [part.data.id] : []) ?? [];
        const selection = focus.takeSelection();
        const openDocumentId = focus.openDocumentId();
        const canvas = focus.canvas();
        return {
          body: {
            conversationId,
            caseId: context.caseId,
            documentIds: context.documentIds,
            researchReferenceIds: context.researchReferenceIds,
            attachmentIds,
            message,
            trigger,
            messageId,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            ...(openDocumentId ? { openDocumentId } : {}),
            ...(selection ? { selection } : {}),
            ...(canvas ? { canvas } : {}),
          },
        };
      },
    }),
    [context.caseId, context.documentIds, context.researchReferenceIds, conversationId, focus, lastMessageId],
  );
  const [working, setWorking] = useState("");
  // The tab of what the Lume touched last; a turn's mark ends with the turn.
  const [touched, setTouched] = useState<string | undefined>();
  const onCanvasRef = useRef(onCanvas);
  useEffect(() => { onCanvasRef.current = onCanvas; }, [onCanvas]);
  // K5 owns the history and thread IDs. The direct adapter avoids a second cloud thread list.
  const chat = useChat({
    id: conversationId,
    messages,
    transport,
    // The turn runs on the server whether or not this page is open; coming back picks it up.
    resume: true,
    onFinish: () => { setTouched(undefined); onFinish(); },
    onError: (error) => { setTouched(undefined); onError(chatErrorMessage(error)); },
    onData: (part) => {
      if (part.type === "data-status") setWorking((part.data as ChatStatus).label);
      if (part.type !== "data-canvas") return;
      const command = canvasCommandSchema.safeParse(part.data);
      if (!command.success) return;
      setTouched(placeOf(command.data.href).tab);
      onCanvasRef.current(command.data);
    },
  });
  const [decisions, setDecisions] = useState<ReadonlyMap<string, ApprovalDecision>>(new Map());
  const { setMessages: setChatMessages } = chat;
  const approvalDecisions = useMemo(() => ({
    decisions,
    record: (id: string, decision: ApprovalDecision) => {
      setDecisions(current => new Map(current).set(id, decision));
      setChatMessages(current => {
        const updated = applyApprovalDecisions(current, new Map([[id, decision]]));
        storeMessages(conversationId, updated);
        return updated;
      });
    },
  }), [decisions, setChatMessages, conversationId]);
  const sendMessage: typeof chat.sendMessage = async (message, options) => {
    if (message && tools.pendingFiles.length) {
      const parts = "parts" in message && message.parts ? message.parts : "text" in message ? [{ type: "text" as const, text: message.text ?? "" }] : [];
      const sending = chat.sendMessage({ id: "id" in message ? message.id : undefined, role: "user", parts: [...parts, ...tools.pendingFiles.map(attachmentPart)] }, options);
      onFilesSent(tools.pendingFiles.map(file => file.id));
      return sending;
    }
    return chat.sendMessage(message, options);
  };
  // Parar stops the turn on the server; leaving the page only stops listening to it.
  const stopTurn = async () => {
    await chat.stop();
    await fetch(`/api/chat/${encodeURIComponent(conversationId)}/stop`, { method: "POST" }).catch(() => undefined);
  };
  const runtime = useAISDKRuntime({ ...chat, sendMessage, stop: stopTurn });
  const { stop, status, sendMessage: send } = chat;
  useEffect(() => () => { void stop(); }, [stop]);
  useEffect(() => {
    sendRef.current = (text) => {
      if (status === "submitted" || status === "streaming") throw new Error("Aguarde a resposta atual do Lume.");
      void send({ text });
    };
    return () => { sendRef.current = null; };
  }, [sendRef, status, send]);
  // Until the new turn says anything, the line from the previous one does not apply.
  const workingLabel = status === "submitted" ? "" : working;
  const running = status === "submitted" || status === "streaming";
  const newest = chat.messages.at(-1);
  const plan = useMemo(() => newest?.role === "assistant" || running
    ? buildPlan(planParts(newest), { running: running ? workingLabel || THINKING : null, decisions }) : null,
  [newest, running, workingLabel, decisions]);
  const place = running ? touched : undefined;
  useEffect(() => { onStatus({ running, plan, place }); }, [onStatus, running, plan, place]);
  return <ConversationIdContext.Provider value={conversationId}><WorkingContext.Provider value={workingLabel}>
    <ApprovalDecisionsContext.Provider value={approvalDecisions}>
      <AssistantRuntimeProvider runtime={runtime}><LumeThread tools={tools} layout={layout} userName={userName} subject={subject} chip={chip} /></AssistantRuntimeProvider>
    </ApprovalDecisionsContext.Provider>
  </WorkingContext.Provider></ConversationIdContext.Provider>;
}

const IDLE: TurnStatus = { running: false, plan: null };

export function AgentChat({ mode, userName = "", initialConversationId = "", initialCaseId, modalities = { image: false, audio: false } }: {
  mode: ChatMode;
  userName?: string;
  initialConversationId?: string;
  initialCaseId?: string;
  modalities?: Modalities;
}) {
  const panel = mode.kind === "panel";
  const initialData = mode.kind === "page" ? mode.initialData : undefined;
  const shell = useShell();
  const shellSubject = shell?.subject;
  const subject = useMemo<CanvasSubject | null>(() => panel ? shellSubject ?? { kind: "office" } : null, [panel, shellSubject]);
  const [conversations, setConversations] = useState<Conversation[]>(initialData?.conversations ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(initialData?.conversation?.id ?? null);
  const [messages, setMessages] = useState<UIMessage[]>(initialData?.messages ?? []);
  const [loading, setLoading] = useState(!initialData?.conversation);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(initialData?.conversation?.id ?? null);
  const hydratedConversation = useRef(initialData?.conversation?.id);
  const [error, setError] = useState("");
  const [context, setContext] = useState<AgentContext>({ caseId: initialCaseId ?? null, documentIds: [], researchReferenceIds: [] });
  const [contextOpen, setContextOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [turn, setTurn] = useState<TurnStatus>(IDLE);
  const listOpen = useSyncExternalStore(subscribeListOpen, readListOpen, serverListOpen);
  const [uploading, setUploading] = useState(0);
  const [draftFiles, setDraftFiles] = useState<Record<string, ChatAttachment[]>>({});
  // On the page the open document lives in the URL (?doc=), so a reload keeps it and Voltar closes it.
  const searchDocument = useSearchParams().get("doc");
  const openDocumentId = panel ? (subject?.kind === "document" ? subject.documentId : null) : searchDocument;
  const openDocumentRef = useRef(openDocumentId);
  const documentWorkspaceRef = useRef<DocumentWorkspaceHandle>(null);
  useEffect(() => { openDocumentRef.current = openDocumentId; }, [openDocumentId]);
  const [documentRevision, setDocumentRevision] = useState(0);
  const savedChatShare = useSyncExternalStore(subscribeChatShare, readChatShare, serverChatShare);
  const [dragShare, setDragShare] = useState<number | null>(null);
  const chatShare = dragShare ?? savedChatShare;
  const splitRef = useRef<HTMLDivElement>(null);
  // A drag cut short by closing the panel must not leave the page unselectable.
  useEffect(() => () => { document.body.style.userSelect = ""; }, []);
  const selectionRef = useRef<Selection | null>(null);
  const sendRef = useRef<((text: string) => void) | null>(null);
  // In the panel each message carries what the canvas shows: the tab on screen and the open ones.
  const shellPlaces = shell?.places;
  const canvasContext = useMemo<CanvasContext | null>(() => panel && subject && shellPlaces ? { subject, tabs: [...shellPlaces] } : null,
    [panel, subject, shellPlaces]);
  const canvasRef = useRef(canvasContext);
  useEffect(() => { canvasRef.current = canvasContext; }, [canvasContext]);
  const turnFocus = useMemo<TurnFocus>(() => ({
    openDocumentId: () => openDocumentRef.current,
    takeSelection: () => { const selection = selectionRef.current; selectionRef.current = null; return selection; },
    canvas: () => canvasRef.current,
  }), []);

  /**
   * Uploads belong to a private conversation, independent from the selected Vault sources. Several
   * files go up side by side; each one joins the draft as soon as it is ready, and the ones that
   * cannot be attached are named in a single message.
   */
  const attachFiles = useCallback(async (files: File[]) => {
    if (!selectedId) return;
    setError("");
    const room = MAX_CHAT_ATTACHMENTS - (draftFiles[selectedId]?.length ?? 0) - uploading;
    const problems: string[] = [];
    if (files.length > room) problems.push(room > 0 ? `Anexe até seis arquivos por mensagem; ${files.length - room} ficaram de fora.` : "Anexe até seis arquivos por mensagem.");
    const accepted = files.slice(0, Math.max(0, room)).filter(file => {
      const image = file.type.startsWith("image/");
      if (file.size > (image ? MAX_CHAT_IMAGE_BYTES : MAX_CHAT_FILE_BYTES)) { problems.push(`${file.name}: ${image ? "a imagem excede 10 MB" : "o arquivo excede 25 MB"}.`); return false; }
      return true;
    });
    const report = () => { if (problems.length) setError(problems.join(" ")); };
    if (!accepted.length) { report(); return; }
    setUploading(count => count + accepted.length);
    await Promise.all(accepted.map(async file => {
      try {
        const body = new FormData();
        body.set("file", file);
        body.set("conversationId", selectedId);
        const response = await fetch("/api/chat/attachments", { method: "POST", body });
        const result = await response.json().catch(() => ({})) as { error?: string; attachment?: ChatAttachment };
        if (!response.ok || !result.attachment) throw new Error(result.error ?? "Não foi possível enviar o arquivo.");
        setDraftFiles(current => ({ ...current, [selectedId]: [...(current[selectedId] ?? []), result.attachment!] }));
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : "Não foi possível enviar o arquivo.";
        problems.push(accepted.length > 1 ? `${file.name}: ${reason}` : reason);
      } finally {
        setUploading(count => count - 1);
      }
    }));
    report();
  }, [selectedId, draftFiles, uploading]);

  async function removeDraftFile(id: string) {
    const response = await fetch(`/api/chat/attachments/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) { setError("Não foi possível remover o anexo. Tente novamente."); return; }
    setDraftFiles(current => Object.fromEntries(Object.entries(current).map(([key, files]) => [key, files.filter(file => file.id !== id)])));
  }

  const loadConversations = useCallback(async () => {
    const response = await fetch("/api/conversations");
    if (!response.ok) throw new Error("Não foi possível carregar o histórico.");
    const next = unwrapConversations(await response.json());
    setConversations(next);
    return next;
  }, []);

  const creatingConversation = useRef<ReturnType<typeof createConversation> | null>(null);
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

  // The page opens the conversation it was asked for, else the latest. The panel keeps this tab's
  // conversation; a new visit opens on an empty one, reusing one nobody wrote in yet.
  const requested = useRef(initialConversationId);
  useEffect(() => {
    let cancelled = false;
    if (initialData?.conversation) return;
    async function initialize() {
      try {
        const next = initialData?.conversations ?? await loadConversations();
        if (cancelled) return;
        const wanted = requested.current;
        const remembered = panel ? rememberPanelConversation() : null;
        if (wanted && (panel || next.some(item => item.id === wanted))) setSelectedId(wanted);
        else if (remembered && next.some(item => item.id === remembered)) setSelectedId(remembered);
        else if (panel && next.some(item => item.title === EMPTY_TITLE)) setSelectedId(next.find(item => item.title === EMPTY_TITLE)!.id);
        else if (next[0] && !panel) setSelectedId(next[0].id);
        // StrictMode runs this effect twice; both runs share one POST instead of creating two conversations.
        else await (creatingConversation.current ??= createConversation());
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Não foi possível abrir o chat.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void initialize();
    return () => { cancelled = true; };
  }, [createConversation, loadConversations, initialData, panel]);

  // A link that names a conversation (Início, a notification, a task) opens it in the mounted panel.
  const [linked, setLinked] = useState({ conversationId: initialConversationId, caseId: initialCaseId });
  if (panel && (linked.conversationId !== initialConversationId || linked.caseId !== initialCaseId)) {
    setLinked({ conversationId: initialConversationId, caseId: initialCaseId });
    if (initialConversationId && initialConversationId !== linked.conversationId) { setSelectedId(initialConversationId); setHistoryOpen(false); }
    if (initialCaseId) setContext(current => ({ ...current, caseId: initialCaseId }));
  }
  useEffect(() => { if (panel && selectedId) rememberPanelConversation(selectedId); }, [panel, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    if (hydratedConversation.current === selectedId) {
      hydratedConversation.current = undefined;
      return;
    }
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

  const selectedCount = context.documentIds.length + context.researchReferenceIds.length;

  const composerTools: ComposerToolsProps = {
    modalities,
    uploading,
    onPickFiles: (files) => void attachFiles(files),
    onError: setError,
    pendingFiles: selectedId ? draftFiles[selectedId] ?? [] : [],
    onRemoveFile: id => void removeDraftFile(id),
  };

  // The cache is read during render rather than copied into state by an effect: the conversation
  // paints from it on the first pass, and the fetched messages take over once they land.
  const cachedForSelected = selectedId ? cachedMessages(selectedId) : undefined;
  const visibleMessages = useMemo(() => selectedId && loadedConversationId === selectedId ? messages : cachedForSelected ?? [],
    [selectedId, loadedConversationId, messages, cachedForSelected]);
  const waitingForMessages = Boolean(selectedId && loadedConversationId !== selectedId && !cachedForSelected);

  const shellOpen = shell?.open;
  const openDocument = useCallback((id: string, title?: string) => {
    if (openDocumentRef.current === id) return;
    if (panel) { shellOpen?.(documentHref(id), title); return; }
    const url = new URL(window.location.href);
    url.searchParams.set("doc", id);
    window.history.pushState(null, "", url);
  }, [panel, shellOpen]);
  const closeDocument = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("doc");
    window.history.replaceState(null, "", url);
  }, []);
  const documentChangedHere = useCallback((id: string) => {
    if (panel) documentChanged(id);
    else if (openDocumentRef.current === id) setDocumentRevision(value => value + 1);
  }, [panel]);
  /**
   * The canvas follows the Lume: what it opens or changes comes up in a tab, and the page already on
   * screen reloads instead. On the old page only documents follow, beside the conversation.
   */
  const followCanvas = useCallback((command: CanvasCommand) => {
    if (command.action !== "open") return;
    const id = documentIdFrom(command.href);
    if (id && openDocumentRef.current === id) documentChangedHere(id);
    else if (panel) shellOpen?.(command.href, command.title, "lume");
    else if (id) openDocument(id, command.title);
  }, [documentChangedHere, openDocument, panel, shellOpen]);
  const documentLinks = useMemo<DocumentLinks>(() => ({ open: openDocument, follow: followCanvas }), [openDocument, followCanvas]);

  const askAboutDocument = useCallback(async (request: DocumentAsk) => {
    if (!sendRef.current) throw new Error("Abra uma conversa para pedir ao Lume.");
    selectionRef.current = { artifactId: request.artifactId, excerpt: request.excerpt };
    const quote = request.excerpt.length > 280 ? `${request.excerpt.slice(0, 277)}…` : request.excerpt;
    try { sendRef.current(`No documento “${request.title}”, no trecho “${quote}”:\n${request.instruction}`); }
    catch (cause) { selectionRef.current = null; throw cause; }
  }, []);
  useEffect(() => panel ? registerDocumentAsk(askAboutDocument) : undefined, [panel, askAboutDocument]);

  // The shell shows what the Lume is doing on the collapsed mark, the tabs and a case's strip.
  const activity = turn.running ? "working" : turn.plan?.needs ? "attention" : "idle";
  const activityCase = context.caseId ?? (subject?.kind === "case" ? subject.caseId : undefined);
  const activityPlace = turn.place;
  const setActivity = shell?.setActivity;
  const setActivityRef = useRef(setActivity);
  useEffect(() => { setActivityRef.current = setActivity; }, [setActivity]);
  useEffect(() => {
    if (!panel) return;
    setActivityRef.current?.(activity === "idle" ? { state: activity }
      : { state: activity, ...(activityCase ? { caseId: activityCase } : {}), ...(activityPlace ? { place: activityPlace } : {}) });
  }, [panel, activity, activityCase, activityPlace]);

  function startConversation() {
    setHistoryOpen(false);
    if (panel && selectedId && !visibleMessages.length && !waitingForMessages) return;
    void createConversation().catch((cause) => setError(cause instanceof Error ? cause.message : "Não foi possível criar uma conversa."));
  }

  // Leaving the history puts focus back on the button that opened it.
  function closeHistory() {
    setHistoryOpen(false);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.lume-panel button[aria-label="Conversas anteriores"]')?.focus());
  }

  function selectConversation(id: string) {
    setSelectedId(id);
    setHistoryOpen(false);
    if (!panel && window.matchMedia("(max-width: 767px)").matches) writeListOpen(false);
  }

  // A subject's case scopes the turn when the conversation has no case of its own: the chip says so.
  const turnContext = useMemo(() => panel && !context.caseId && subject?.kind === "case" ? { ...context, caseId: subject.caseId } : context, [panel, context, subject]);

  const artifactsSheet = (trigger: React.ReactNode) => (
    <Sheet open={contextOpen} onOpenChange={setContextOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="right" showCloseButton={false} className="min-w-0 gap-0 overflow-x-hidden bg-background sm:max-w-md">
        <SheetHeader className="sr-only"><SheetTitle>Artefatos desta conversa</SheetTitle></SheetHeader>
        {contextOpen && <AgentArtifactsPanel conversationId={selectedId} context={context} onChange={setContext}
          onOpenDocument={id => { setContextOpen(false); openDocument(id); }} onClose={() => setContextOpen(false)} />}
      </SheetContent>
    </Sheet>
  );

  const errorLine = error && <p className={cn("flex items-start gap-2 text-sm text-destructive", panel ? "mx-3.5 px-3 py-2" : "border-b px-4 py-2 md:px-8")} role="alert">
    <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}
  </p>;

  const thread = loading || waitingForMessages ? (
    <div className="grid flex-1 place-items-center text-sm text-muted-foreground" role="status" aria-live="polite" aria-busy="true"><span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Carregando conversa…</span></div>
  ) : selectedId ? (
    <RuntimeThread
      key={`${selectedId}:${visibleMessages.map((message) => message.id).join(",")}`}
      conversationId={selectedId}
      messages={visibleMessages}
      context={turnContext}
      onFilesSent={ids => setDraftFiles(current => ({ ...current, [selectedId]: (current[selectedId] ?? []).filter(file => !ids.includes(file.id)) }))}
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
      onStatus={setTurn}
      onCanvas={followCanvas}
      focus={turnFocus}
      sendRef={sendRef}
      layout={panel ? "panel" : "page"}
      userName={userName}
      subject={subject}
      chip={subject ? subjectChip(subject) : null}
    />
  ) : (
    <div className="grid flex-1 place-items-center px-6 text-center text-sm text-muted-foreground">Nenhuma conversa disponível.</div>
  );

  if (panel) {
    const status = panelStatus(turn.plan, turn.running);
    return (
      <TooltipProvider>
        <DocumentLinksContext.Provider value={documentLinks}>
            <div className="lume-panel flex h-full min-h-0 flex-col">
              <PanelHeader mark={activity === "idle" ? "still" : activity} status={status} historyOpen={historyOpen}
                onHistory={() => { setHistoryOpen(open => !open); if (!historyOpen) void loadConversations().catch(() => undefined); }}
                onNew={startConversation} onCollapse={shell ? () => shell.setPanel("collapsed") : undefined} />
              {errorLine}
              {historyOpen ? (
                <div id="lume-history" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pt-1 pb-3"
                  onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); closeHistory(); } }}>
                  <h3 className="px-2.5 pt-2 pb-1.5 text-[13px] font-medium text-muted-foreground">Conversas</h3>
                  <ConversationList conversations={conversations} selectedId={selectedId} loading={loading} onSelect={selectConversation} onDelete={(id) => void removeConversation(id)} />
                  <div className="mt-auto flex flex-wrap gap-2 border-t border-border px-1 pt-3">
                    {artifactsSheet(<Button variant="outline" className="max-md:h-11"><FileStack />Artefatos desta conversa{selectedCount > 0 ? ` (${selectedCount})` : ""}</Button>)}
                    <Button asChild variant="ghost" className="max-md:h-11"><Link href="/app/agents/settings"><SlidersHorizontal />Personalizar o Lume</Link></Button>
                  </div>
                </div>
              ) : thread}
            </div>
        </DocumentLinksContext.Provider>
      </TooltipProvider>
    );
  }

  // The divider between conversation and document: pointer drag, arrow keys, double click resets.
  function shareAt(clientX: number) {
    const bounds = splitRef.current?.getBoundingClientRect();
    return bounds && bounds.width ? clampChatShare((clientX - bounds.left) / bounds.width * 100) : chatShare;
  }
  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.userSelect = "none";
    setDragShare(shareAt(event.clientX));
  }
  function moveResize(event: React.PointerEvent<HTMLDivElement>) {
    if (dragShare !== null) setDragShare(shareAt(event.clientX));
  }
  function endResize() {
    if (dragShare === null) return;
    document.body.style.userSelect = "";
    writeChatShare(dragShare);
    setDragShare(null);
  }
  function resizeWithKeys(event: React.KeyboardEvent<HTMLDivElement>) {
    const next = event.key === "ArrowLeft" ? chatShare - 2 : event.key === "ArrowRight" ? chatShare + 2
      : event.key === "Home" ? MIN_CHAT_SHARE : event.key === "End" ? MAX_CHAT_SHARE : null;
    if (next === null) return;
    event.preventDefault();
    writeChatShare(next);
  }

  return (
    <TooltipProvider>
      <DocumentLinksContext.Provider value={documentLinks}>
      <div className="agent-chat flex min-h-0 flex-1 flex-col overflow-hidden" data-document-open={openDocumentId ? "" : undefined}>
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-line px-4 md:h-(--shell-header) md:min-h-0 md:px-10">
          <div className="flex min-w-0 items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="-ml-2 size-11 text-muted-foreground md:ml-0 md:size-9" aria-label={listOpen ? "Ocultar conversas" : "Mostrar conversas"} aria-expanded={listOpen} aria-controls="agent-conversations" onClick={() => writeListOpen(!listOpen)}>
                  {listOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{listOpen ? "Ocultar conversas" : "Mostrar conversas"}</TooltipContent>
            </Tooltip>
            <h1 className="page-title truncate max-md:sr-only">Lume</h1>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-11 md:size-9" onClick={startConversation} aria-label="Nova conversa"><MessageSquarePlus /></Button>
              </TooltipTrigger>
              <TooltipContent>Nova conversa</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild variant="ghost" size="icon" className="size-11 md:size-9" aria-label="Personalizar Lume"><Link href="/app/agents/settings"><SlidersHorizontal /></Link></Button>
              </TooltipTrigger>
              <TooltipContent>Personalizar Lume</TooltipContent>
            </Tooltip>
            {artifactsSheet(<Button variant="outline"><FileStack />Artefatos{selectedCount > 0 ? ` (${selectedCount} do Cofre)` : ""}</Button>)}
          </div>
        </header>

        {errorLine}

        <div ref={splitRef} className="flex min-h-0 flex-1">
          <aside id="agent-conversations" aria-label="Conversas" className="agent-chat-history min-h-0 w-full shrink-0 flex-col overflow-y-auto border-b p-3 md:w-72 md:border-r md:border-b-0">
            <ConversationList conversations={conversations} selectedId={selectedId} loading={loading} onSelect={selectConversation} onDelete={(id) => void removeConversation(id)} />
          </aside>
          <div className={cn("agent-chat-content flex min-h-0 min-w-0 flex-1 flex-col", openDocumentId && "lg:min-w-[24rem] lg:flex-none lg:basis-[var(--chat-share)]")}
            style={openDocumentId ? { "--chat-share": `${chatShare}%` } as React.CSSProperties : undefined}>
            {thread}
          </div>
          {openDocumentId && (
            <div role="separator" aria-orientation="vertical" aria-label="Largura da conversa" aria-controls="document-panel" tabIndex={0}
              aria-valuemin={MIN_CHAT_SHARE} aria-valuemax={MAX_CHAT_SHARE} aria-valuenow={Math.round(chatShare)} aria-valuetext={`Conversa com ${Math.round(chatShare)}% da largura`}
              data-dragging={dragShare !== null || undefined} title="Arraste para ajustar. Clique duas vezes para voltar ao padrão."
              className="group relative z-10 -mx-1 hidden w-2 shrink-0 cursor-col-resize touch-none outline-none lg:block"
              onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize}
              onKeyDown={resizeWithKeys} onDoubleClick={() => writeChatShare(DEFAULT_CHAT_SHARE)}>
              <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:w-0.5 group-hover:bg-brand group-focus-visible:w-0.5 group-focus-visible:bg-brand group-data-[dragging]:w-0.5 group-data-[dragging]:bg-brand" />
            </div>
          )}
          {openDocumentId && (
            <DocumentPanel onClose={() => { if (documentWorkspaceRef.current) void documentWorkspaceRef.current.close(); else closeDocument(); }}>
              <DocumentWorkspace ref={documentWorkspaceRef} key={openDocumentId} artifactId={openDocumentId} variant="panel" onClose={closeDocument} onAsk={askAboutDocument} revision={documentRevision} />
            </DocumentPanel>
          )}
        </div>
      </div>
      </DocumentLinksContext.Provider>
    </TooltipProvider>
  );
}
