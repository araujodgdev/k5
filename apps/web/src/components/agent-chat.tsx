"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import type { ChatBootstrap } from "@/lib/ai-store";
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
} from "@assistant-ui/react";
import { useAISDKRuntime } from "@assistant-ui/ai-sdk";
import {
  ArrowUp,
  ArrowDown,
  Check,
  CircleAlert,
  Camera,
  ExternalLink,
  Copy,
  FileStack,
  FileText,
  PanelLeftClose,
  SlidersHorizontal,
  PanelLeftOpen,
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
import type { AgentContext } from "@/components/agent-sources-panel";
import dynamic from "next/dynamic";
import { readListOpen, subscribeListOpen, writeListOpen, serverListOpen } from "@/lib/agent-history";
import { clampChatShare, DEFAULT_CHAT_SHARE, MAX_CHAT_SHARE, MIN_CHAT_SHARE, readChatShare, serverChatShare, subscribeChatShare, writeChatShare } from "@/lib/document-split";
import { formatConversationTime } from "@/lib/conversation-time";
import { Skeleton } from "@/components/ui/skeleton";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
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
import { ChatCamera } from './chat-camera';
import { ChatAttachmentView } from './chat-attachment';
import { attachmentPart, MAX_CHAT_ATTACHMENTS, MAX_CHAT_FILE_BYTES, type ChatAttachment } from '@/lib/chat-attachment-contract';
import type { DocumentAsk } from "./document/document-workspace";
import type { CitationItem } from "@/lib/citations/verdict";
import { citationStatusLabel, sourceHref, toReview } from "@/lib/citations/labels";

type Selection = { artifactId: string; excerpt: string };
/** Read when a message is sent: the document open beside the chat, and a selection spent by that one request. */
type DocumentFocus = { openDocumentId: () => string | null; takeSelection: () => Selection | null };
const DocumentWorkspace = dynamic(() => import("./document/document-workspace").then(module => module.DocumentWorkspace), {
  ssr: false,
  loading: () => <p role="status" className="p-6 text-sm text-muted-foreground">Abrindo documento…</p>,
});
/** Tool calls that leave a document the person should see: created, edited, rewritten or restored. */
const DOCUMENT_WRITES = new Set(["k5_artifacts_create", "k5_artifacts_edit", "k5_artifacts_update", "k5_artifacts_restore_version"]);
const AgentSourcesPanel = dynamic(() => import("./agent-sources-panel").then(module => module.AgentSourcesPanel), {
  loading: () => <p role="status" className="p-6 text-sm text-muted-foreground">Carregando fontes…</p>,
});
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
        <MessagePrimitive.Parts components={{data:{by_name:{attachment:ChatAttachmentView}}}} />
      </div>
    </MessagePrimitive.Root>
  );
}

/** The model writes Markdown; this is what turns it into headings, lists and tables. */
function AssistantText({ text }: { text: string }) {
  return <Markdown text={text} />;
}

type StepData = { callId?: string; name?: string; summary?: string; state?: string; href?: string };

/**
 * Documents open beside the conversation instead of replacing it. `announce` hears every tool line
 * as it renders; a document the Lume created or changed in this turn opens, or reloads if open.
 */
type DocumentLinks = { open: (id: string) => void; announce: (step: StepData) => void; changed: (id: string) => void };
const DocumentLinksContext = createContext<DocumentLinks | null>(null);
const DOCUMENT_PREFIX = "/app/documents/";
const documentIdFrom = (href?: string) => href?.startsWith(DOCUMENT_PREFIX) ? decodeURIComponent(href.slice(DOCUMENT_PREFIX.length)) : null;

function OpenLink({ href }: { href: string }) {
  const documents = useContext(DocumentLinksContext);
  const documentId = documentIdFrom(href);
  if (documentId && documents) {
    return <button type="button" onClick={() => documents.open(documentId)} className="text-brand-ink underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none">Abrir</button>;
  }
  return <Link href={href} className="text-brand-ink underline-offset-4 hover:underline">Abrir</Link>;
}

/** One finished tool call, as a quiet line above the answer, with a link to what it touched. */
function ToolStep({ data }: { data: StepData }) {
  const documents = useContext(DocumentLinksContext);
  useEffect(() => { if (data) documents?.announce(data); }, [data, documents]);
  if (!data?.summary) return null;
  const failed = data.state === "failed";
  return (
    <p className={cn("mb-2 flex items-start gap-2 text-[13px] leading-5", failed ? "text-destructive" : "text-subtle-foreground")}>
      {failed ? <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> : <Check className="mt-0.5 size-3.5 shrink-0 text-brand-ink" aria-hidden="true" />}
      <span className="min-w-0">{data.summary}{data.href && <> · <OpenLink href={data.href} /></>}</span>
    </p>
  );
}

const ConversationIdContext = createContext("");
type ApprovalData = { approvalId: string; summary: string; state: "pending" | "confirmed" | "cancelled" | "failed"; result?: string; href?: string };

/**
 * The only thing the Lume asks before acting: deleting, reaching a court, or overwriting a draft.
 * Confirmar runs exactly the action it proposed on the server; nothing is retyped by the model.
 */
function ApprovalStep({ data }: { data: ApprovalData }) {
  const conversationId = useContext(ConversationIdContext);
  const documents = useContext(DocumentLinksContext);
  const [decided, setDecided] = useState<Pick<ApprovalData, "state" | "result" | "href"> | null>(null);
  const [busy, setBusy] = useState<"" | "confirm" | "cancel">("");
  const [error, setError] = useState("");
  if (!data?.approvalId) return null;
  const current = decided ?? data;
  async function decide(decision: "confirm" | "cancel") {
    setBusy(decision); setError("");
    try {
      const response = await fetch(`/api/chat/approvals/${encodeURIComponent(data.approvalId)}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, conversationId }),
      });
      const body = await response.json().catch(() => ({})) as ApprovalData & { error?: string };
      if (!response.ok) throw new Error(body.error || "Não foi possível concluir. Peça de novo ao Lume.");
      setDecided({ state: body.state, result: body.result, href: body.href });
      const changedDocument = body.state === "confirmed" ? documentIdFrom(body.href) : null;
      if (changedDocument) documents?.changed(changedDocument);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível concluir."); }
    finally { setBusy(""); }
  }
  return (
    <div className="mt-3 grid gap-3 border-l-2 border-brand py-1 pl-4" role="group" aria-label="Confirmação">
      <p className="text-sm text-foreground">{data.summary}</p>
      {current.state === "pending" ? <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" className="h-11 md:h-9" disabled={Boolean(busy)} onClick={() => void decide("confirm")}>
          {busy === "confirm" && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}Confirmar</Button>
        <Button type="button" size="sm" variant="ghost" className="h-11 md:h-9" disabled={Boolean(busy)} onClick={() => void decide("cancel")}>Cancelar</Button>
      </div> : <p className={cn("text-[13px]", current.state === "failed" ? "text-destructive" : "text-subtle-foreground")} role="status">
        {current.state === "confirmed" ? "Confirmado" : current.state === "cancelled" ? "Cancelado" : "Não concluído"}{current.result ? ` · ${current.result}` : ""}
        {current.href && <> · <OpenLink href={current.href} /></>}
      </p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

type JurisprudenceData = {
  results?: Array<{ title: string; court: string; caseNumber: string | null; date: string | null; url: string; summary: string; relevanceLabel: string | null }>;
  note?: string;
};

/**
 * Case law the Lume found on the web. It is built from the tool result, not from the model's
 * prose, so every item carries the link the search returned and Jev's relevance, in plain text.
 */
function JurisprudenceList({ data }: { data: JurisprudenceData }) {
  const results = data?.results ?? [];
  const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
  return (
    <section aria-label="Jurisprudência encontrada na web" className="mt-4 grid gap-2">
      <h3 className="text-sm font-medium">Jurisprudência na web</h3>
      {results.length ? <ol className="divide-y border-y">
        {results.map((item) => (
          <li key={item.url} className="grid gap-1 py-3">
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="group inline-flex items-start gap-1.5 text-sm font-medium leading-6 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="min-w-0 break-words">{item.title}</span><ExternalLink className="mt-1.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="sr-only"> (abre em nova aba)</span>
            </a>
            <p className="text-[13px] leading-5 text-subtle-foreground">
              {[item.court, item.caseNumber, item.date, host(item.url)].filter(Boolean).join(" · ")}
              {item.relevanceLabel && <> · <span className="text-brand-ink">{item.relevanceLabel}</span></>}
            </p>
            {item.summary && <p className="line-clamp-3 text-[13px] leading-5 text-muted-foreground">{item.summary}</p>}
          </li>
        ))}
      </ol> : null}
      {data?.note && <p className="text-xs text-subtle-foreground">{data.note} Confira o inteiro teor antes de citar.</p>}
    </section>
  );
}

/**
 * The answer's legal citations, checked against what the conversation consulted. The Lume writes
 * freely; this is where the lawyer sees which citations to confirm before relying on them.
 */
function CitationsList({ data }: { data: { items?: CitationItem[] } }) {
  const items = data?.items ?? [];
  const pending = toReview(items);
  const confirmed = items.length - pending.length;
  if (!items.length) return null;
  return (
    <section aria-label="Citações da resposta" className="mt-4 grid gap-2">
      {pending.length > 0 && <>
        <h3 className="text-sm font-medium">Citações para conferir</h3>
        <ul className="divide-y border-y">
          {pending.map((item) => (
            <li key={item.id} className="grid gap-0.5 py-2.5">
              <p className="text-sm font-medium leading-6">{item.text}</p>
              <p className="text-[13px] leading-5 text-subtle-foreground">
                {citationStatusLabel[item.status]}
                {item.source && <> · {sourceHref(item.source.url)
                  ? <a href={sourceHref(item.source.url)!} target="_blank" rel="noopener noreferrer" className="text-brand-ink underline-offset-4 hover:underline">{item.source.title || "fonte"}<span className="sr-only"> (abre em nova aba)</span></a>
                  : item.source.title}</>}
              </p>
            </li>
          ))}
        </ul>
      </>}
      {confirmed > 0 && <p className="text-xs text-subtle-foreground">{confirmed === 1 ? "1 citação confere" : `${confirmed} citações conferem`} com as fontes consultadas nesta conversa.</p>}
    </section>
  );
}

const assistantParts = { Text: AssistantText, data: { by_name: { tool: ToolStep, approval: ApprovalStep, jurisprudence: JurisprudenceList, citations: CitationsList } } };

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="group mx-auto w-full max-w-3xl px-4 py-4 md:px-8">
      <div className="max-w-[72ch] text-sm leading-7 text-foreground">
        <MessagePrimitive.If hasContent={false}>
          <p className="flex items-center gap-2 text-subtle-foreground" aria-live="polite"><span className="size-1.5 animate-pulse rounded-full bg-brand motion-reduce:animate-none" aria-hidden="true" />Pensando…</p>
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

type ComposerToolsProps = {
  modalities: Modalities;
  uploading: boolean;
  onPickFile: (file: File) => void;
  audio: Attachment | null;
  onAudio: (attachment: Attachment | null) => void;
  onError: (message: string) => void;
  pendingFiles: ChatAttachment[];
  onRemoveFile: (id:string) => void;
};

function ComposerTools({ modalities, uploading, onPickFile, audio, onAudio, onError }: ComposerToolsProps) {
  const aui = useAui();
  const fileInput = useRef<HTMLInputElement>(null);
  const [accept, setAccept] = useState(DOCUMENT_ACCEPT);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [cameraOpen,setCameraOpen]=useState(false);
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
        // A voice note can be the whole message: an empty composer would keep Enviar disabled.
        if (!aui.composer().getState().text.trim()) aui.composer().setText("Mensagem de voz");
      };
      recorder.current = media;
      media.start();
      setRecording(true);
    } catch {
      onError("Não foi possível acessar o microfone.");
    }
  }

  const audioHint = modalities.audio ? undefined : "O Lume não aceita áudio nesta configuração.";

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        aria-label="Arquivo para anexar"
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
          <HintedControl hint={modalities.image ? undefined : "O Lume não lê imagens nesta configuração."}>
            <button type="button" onClick={()=>{setMenuOpen(false);setCameraOpen(true);}} disabled={!modalities.image} className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted disabled:cursor-not-allowed disabled:text-subtle-foreground md:min-h-9"><Camera className="size-4 text-muted-foreground" aria-hidden="true" />Tirar foto</button>
          </HintedControl>
          <button type="button" onClick={() => pick("document")} className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted md:min-h-9">
            <FileText className="size-4 text-muted-foreground" aria-hidden="true" />Documento ou planilha
          </button>
          <HintedControl hint={modalities.image ? undefined : "O Lume não lê imagens nesta configuração."}>
            <button type="button" onClick={() => pick("image")} disabled={!modalities.image} className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted disabled:cursor-not-allowed disabled:text-subtle-foreground disabled:hover:bg-transparent md:min-h-9">
              <ImageIcon className="size-4 text-muted-foreground" aria-hidden="true" />Escolher imagem
            </button>
          </HintedControl>
        </PopoverContent>
      </Popover>
      {cameraOpen&&<ChatCamera onClose={()=>setCameraOpen(false)} onPhoto={onPickFile} />}

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

      {audio && (
        <button type="button" onClick={() => onAudio(null)} className="flex h-9 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Áudio anexado<X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </>
  );
}

function LumeThread({ tools }: { tools: ComposerToolsProps }) {
  const [away, setAway] = useState(false);
  return (
    <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
      <ThreadPrimitive.Viewport data-chat-viewport className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain" turnAnchor="bottom" onScroll={event => {
        const el = event.currentTarget;
        setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 240);
      }}>
        <ThreadPrimitive.Empty>
          <div className="mx-auto grid w-full max-w-3xl flex-1 place-items-center px-6 py-14 text-center">
            <p className="max-w-sm text-sm leading-6 text-subtle-foreground">Peça o que precisar. O Lume consulta os documentos do escritório e cria tarefas, reuniões e casos por você.</p>
          </div>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />

        <ThreadPrimitive.ViewportFooter className="sticky bottom-0 z-10 mt-auto shrink-0 bg-background/95 px-4 pb-4 pt-2 md:px-8 md:pb-6">
          {away && <ThreadPrimitive.ScrollToBottom aria-label="Voltar ao mais recente" title="Voltar ao mais recente" behavior="auto" className="absolute -top-12 left-1/2 grid size-11 -translate-x-1/2 place-items-center rounded-full border bg-background shadow-[var(--shadow-float)] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:hidden"><ArrowDown className="size-4" /></ThreadPrimitive.ScrollToBottom>}
          <ComposerPrimitive.Root className="mx-auto w-full max-w-3xl rounded-2xl border bg-background p-2 shadow-[var(--shadow-float)] transition focus-within:border-input">
            {tools.pendingFiles.length>0&&<div className="flex flex-wrap gap-2 p-2" aria-label="Anexos da próxima mensagem">{tools.pendingFiles.map(file=><ChatAttachmentView key={file.id} data={file} onRemove={()=>tools.onRemoveFile(file.id)} />)}</div>}
            {tools.uploading&&<p role="status" className="px-2 py-1 text-xs text-muted-foreground">Preparando anexo…</p>}
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
                  <ComposerPrimitive.Send disabled={tools.uploading} className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground outline-none transition hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40" aria-label="Enviar mensagem">
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

function RuntimeThread({ conversationId, messages, context, audio, onAudioSent, onFilesSent, tools, onFinish, onError, focus, sendRef }: {
  conversationId: string;
  /** What the person has open beside the chat; read when each message is sent. */
  focus: DocumentFocus;
  /** Lets the document panel send a message into this thread. */
  sendRef: React.RefObject<((text: string) => void) | null>;
  messages: UIMessage[];
  context: AgentContext;
  audio: Attachment | null;
  onAudioSent: () => void;
  onFilesSent: (ids:string[]) => void;
  tools: ComposerToolsProps;
  onFinish: () => void;
  onError: (message: string) => void;
}) {
  const transport = useMemo(
    () => new DefaultChatTransport({
      api: "/api/chat",
      // The server holds the authoritative history; only the affected message needs to
      // travel over the wire (keeps requests under the server's body-size limit on long
      // conversations, and gives the route what it needs to merge retries/regenerations).
      prepareSendMessagesRequest: async ({ messages: history, trigger, messageId }) => {
        const message=history.findLast(item=>item.role==='user');
        const attachmentIds=message?.parts.flatMap(part=>part.type==='data-attachment'&&part.data&&typeof part.data==='object'&&'id' in part.data?[part.data.id]:[])??[];
        const selection = focus.takeSelection();
        const openDocumentId = focus.openDocumentId();
        // The recording travels with this message only; sending spends it.
        if (audio) onAudioSent();
        return {
          body: {
            conversationId,
            caseId: context.caseId,
            documentIds: context.documentIds,
            researchReferenceIds: context.researchReferenceIds,
            ...(audio ? { attachments: [audio] } : {}),
            attachmentIds,
            message,
            trigger,
            messageId,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            ...(openDocumentId ? { openDocumentId } : {}),
            ...(selection ? { selection } : {}),
          },
        };
      },
    }),
    [audio, onAudioSent, context.caseId, context.documentIds, context.researchReferenceIds, conversationId, focus],
  );
  // K5 owns the history and thread IDs. The direct adapter avoids a second cloud thread list.
  const chat = useChat({
    id: conversationId,
    messages,
    transport,
    onFinish,
    onError: (error) => onError(chatErrorMessage(error)),
  });
  const sendMessage:typeof chat.sendMessage=async(message,options)=>{
    if(message&&tools.pendingFiles.length) {
      const parts='parts' in message&&message.parts ? message.parts : 'text' in message?[{type:'text' as const,text:message.text??''}]:[];
      const sending=chat.sendMessage({id:'id' in message?message.id:undefined,role:'user',parts:[...parts,...tools.pendingFiles.map(attachmentPart)]},options);
      onFilesSent(tools.pendingFiles.map(file=>file.id));
      return sending;
    }
    return chat.sendMessage(message,options);
  };
  const runtime = useAISDKRuntime({...chat,sendMessage});
  const { stop, status, sendMessage: send } = chat;
  useEffect(() => () => { void stop(); }, [stop]);
  useEffect(() => {
    sendRef.current = (text) => {
      if (status === "submitted" || status === "streaming") throw new Error("Aguarde a resposta atual do Lume.");
      void send({ text });
    };
    return () => { sendRef.current = null; };
  }, [sendRef, status, send]);
  return <ConversationIdContext.Provider value={conversationId}><AssistantRuntimeProvider runtime={runtime}><LumeThread tools={tools} /></AssistantRuntimeProvider></ConversationIdContext.Provider>;
}

export function AgentChat({ initialConversationId = '', initialData, modalities = { image: false, audio: false } }: { initialConversationId?: string; initialData?: ChatBootstrap; modalities?: Modalities }) {
  const [conversations, setConversations] = useState<Conversation[]>(initialData?.conversations ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(initialData?.conversation?.id ?? null);
  const [messages, setMessages] = useState<UIMessage[]>(initialData?.messages ?? []);
  const [loading, setLoading] = useState(!initialData?.conversation);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(initialData?.conversation?.id ?? null);
  const hydratedConversation = useRef(initialData?.conversation?.id);
  const [error, setError] = useState("");
  const [context, setContext] = useState<AgentContext>({ caseId: null, documentIds: [], researchReferenceIds: [] });
  const [contextOpen, setContextOpen] = useState(false);
  const listOpen = useSyncExternalStore(subscribeListOpen, readListOpen, serverListOpen);
  const [uploading, setUploading] = useState(false);
  const [audio, setAudio] = useState<Attachment | null>(null);
  const [draftFiles,setDraftFiles]=useState<Record<string,ChatAttachment[]>>({});
  // The open document lives in the URL (?doc=), so a reload keeps it and Voltar closes it.
  const openDocumentId = useSearchParams().get("doc");
  const openDocumentRef = useRef(openDocumentId);
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
  const documentFocus = useMemo<DocumentFocus>(() => ({
    openDocumentId: () => openDocumentRef.current,
    takeSelection: () => { const selection = selectionRef.current; selectionRef.current = null; return selection; },
  }), []);
  const handledCalls = useRef(new Set<string>());
  function toggleList() {
    writeListOpen(!listOpen);
  }

  // A voice note belongs to the message it was recorded for, so it is spent on send.
  const clearAudio = useCallback(() => setAudio(null), []);

  /** Uploads belong to a private conversation, independent from the selected Vault sources. */
  const attachFile = useCallback(async (file: File) => {
    if(!selectedId) return;
    if((draftFiles[selectedId]?.length??0)>=MAX_CHAT_ATTACHMENTS) {setError('Anexe até seis arquivos por mensagem.');return;}
    if(file.size>MAX_CHAT_FILE_BYTES) {setError('O arquivo excede 10 MB.');return;}
    setUploading(true);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set('conversationId',selectedId);
      const response = await fetch('/api/chat/attachments', { method: 'POST', body });
      const result = await response.json() as {error?:string;attachment?:ChatAttachment};
      if(!response.ok||!result.attachment) throw new Error(result.error??'Não foi possível enviar o arquivo.');
      setDraftFiles(current=>({...current,[selectedId]:[...(current[selectedId]??[]),result.attachment!]}));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar o arquivo.");
    } finally {
      setUploading(false);
    }
  }, [selectedId,draftFiles]);

  async function removeDraftFile(id:string) {
    const response=await fetch(`/api/chat/attachments/${encodeURIComponent(id)}`,{method:'DELETE'});
    if(!response.ok) {setError('Não foi possível remover o anexo. Tente novamente.');return;}
    setDraftFiles(current=>Object.fromEntries(Object.entries(current).map(([key,files])=>[key,files.filter(file=>file.id!==id)])));
  }

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
    if (initialData?.conversation) return;
    async function initialize() {
      try {
        const next = initialData?.conversations ?? await loadConversations();
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
  }, [createConversation, loadConversations, initialConversationId, initialData]);

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
    onPickFile: (file) => void attachFile(file),
    audio,
    onAudio: setAudio,
    onError: setError,
    pendingFiles:selectedId?draftFiles[selectedId]??[]:[],
    onRemoveFile:id=>void removeDraftFile(id),
  };

  // The cache is read during render rather than copied into state by an effect: the conversation
  // paints from it on the first pass, and the fetched messages take over once they land.
  const cachedForSelected = selectedId ? cachedMessages(selectedId) : undefined;
  const visibleMessages = useMemo(() => selectedId && loadedConversationId === selectedId ? messages : cachedForSelected ?? [],
    [selectedId, loadedConversationId, messages, cachedForSelected]);
  const waitingForMessages = Boolean(selectedId && loadedConversationId !== selectedId && !cachedForSelected);

  // Tool lines already in the loaded history are old news; only calls made from here on open a document.
  const loadedCalls = useMemo(() => new Set(visibleMessages.flatMap(message => message.parts.flatMap(part =>
    part.type === "data-tool" && part.data && typeof part.data === "object" && "callId" in part.data ? [String(part.data.callId)] : []))), [visibleMessages]);

  const openDocument = useCallback((id: string) => {
    if (openDocumentRef.current === id) return;
    const url = new URL(window.location.href);
    url.searchParams.set("doc", id);
    window.history.pushState(null, "", url);
  }, []);
  const closeDocument = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("doc");
    window.history.replaceState(null, "", url);
  }, []);
  const documentLinks = useMemo<DocumentLinks>(() => ({
    open: openDocument,
    changed: (id) => { if (openDocumentRef.current === id) setDocumentRevision(value => value + 1); },
    announce: (step) => {
      if (!step.callId || loadedCalls.has(step.callId) || handledCalls.current.has(step.callId)) return;
      handledCalls.current.add(step.callId);
      const id = step.state === "completed" && step.name && DOCUMENT_WRITES.has(step.name) ? documentIdFrom(step.href) : null;
      if (!id) return;
      if (openDocumentRef.current === id) setDocumentRevision(value => value + 1);
      else openDocument(id);
    },
  }), [loadedCalls, openDocument]);

  const askAboutDocument = useCallback(async (request: DocumentAsk) => {
    if (!sendRef.current) throw new Error("Abra uma conversa para pedir ao Lume.");
    selectionRef.current = { artifactId: request.artifactId, excerpt: request.excerpt };
    const quote = request.excerpt.length > 280 ? `${request.excerpt.slice(0, 277)}…` : request.excerpt;
    try { sendRef.current(`No documento “${request.title}”, no trecho “${quote}”:\n${request.instruction}`); }
    catch (cause) { selectionRef.current = null; throw cause; }
  }, []);

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

  function selectConversation(id: string) {
    setSelectedId(id);
    if (window.matchMedia("(max-width: 767px)").matches) {
      writeListOpen(false);
    }
  }

  return (
    <TooltipProvider>
      <DocumentLinksContext.Provider value={documentLinks}>
      <div className="agent-chat flex min-h-0 flex-1 flex-col overflow-hidden" data-document-open={openDocumentId ? "" : undefined}>
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="-ml-2 size-11 text-muted-foreground md:size-9" aria-label={listOpen ? "Ocultar conversas" : "Mostrar conversas"} aria-expanded={listOpen} aria-controls="agent-conversations" onClick={toggleList}>
                  {listOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{listOpen ? "Ocultar conversas" : "Mostrar conversas"}</TooltipContent>
            </Tooltip>
            <h1 className="display truncate text-[28px] max-md:sr-only">Lume</h1>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-11 md:size-9" onClick={() => void createConversation().catch((cause) => setError(cause instanceof Error ? cause.message : "Não foi possível criar uma conversa."))} aria-label="Nova conversa"><MessageSquarePlus /></Button>
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
            <Sheet open={contextOpen} onOpenChange={setContextOpen}>
              <SheetTrigger asChild><Button variant="outline"><FileStack />Fontes{selectedCount > 0 ? ` (${selectedCount})` : ""}</Button></SheetTrigger>
              <SheetContent side="right" showCloseButton={false} className="min-w-0 overflow-x-hidden gap-0 bg-background sm:max-w-md">
                <SheetHeader className="sr-only"><SheetTitle>Fontes desta conversa</SheetTitle></SheetHeader>
                {contextOpen && <AgentSourcesPanel context={context} onChange={setContext} onClose={() => setContextOpen(false)} />}
              </SheetContent>
            </Sheet>
          </div>
        </header>

        {error && <p className="flex items-start gap-2 border-b px-4 py-2 text-sm text-destructive md:px-8" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}

        <div ref={splitRef} className="flex min-h-0 flex-1">
          <aside id="agent-conversations" aria-label="Conversas" className="agent-chat-history min-h-0 w-full shrink-0 flex-col overflow-y-auto border-b md:w-72 md:border-r md:border-b-0">
              {loading && conversations.length === 0 ? (
                <div className="grid gap-2 p-3" aria-hidden="true">
                  <Skeleton className="h-16 w-full rounded-md" />
                  <Skeleton className="h-16 w-full rounded-md" />
                  <Skeleton className="h-16 w-full rounded-md" />
                </div>
              ) : (
                <ConversationCards conversations={conversations} selectedId={selectedId} onSelect={selectConversation} onDelete={(id) => void removeConversation(id)} />
              )}
          </aside>
          <div className={cn("agent-chat-content flex min-h-0 min-w-0 flex-1 flex-col", openDocumentId && "lg:min-w-[24rem] lg:flex-none lg:basis-[var(--chat-share)]")}
            style={openDocumentId ? { "--chat-share": `${chatShare}%` } as React.CSSProperties : undefined}>
            {loading || waitingForMessages ? (
              <div className="grid flex-1 place-items-center text-sm text-muted-foreground" role="status" aria-live="polite" aria-busy="true"><span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Carregando conversa…</span></div>
            ) : selectedId ? (
              <RuntimeThread
                key={`${selectedId}:${visibleMessages.map((message) => message.id).join(",")}`}
                conversationId={selectedId}
                messages={visibleMessages}
                context={context}
                audio={audio}
                onAudioSent={clearAudio}
                onFilesSent={ids=>setDraftFiles(current=>({...current,[selectedId]:(current[selectedId]??[]).filter(file=>!ids.includes(file.id))}))}
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
                focus={documentFocus}
                sendRef={sendRef}
              />
            ) : (
              <div className="grid flex-1 place-items-center px-6 text-center text-sm text-subtle-foreground">Nenhuma conversa disponível.</div>
            )}
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
            // Beside the chat on wide screens; over it, full screen, on smaller ones.
            <section id="document-panel" aria-label="Documento" className="fixed inset-0 z-50 flex min-w-0 flex-col bg-background pt-[env(safe-area-inset-top)] lg:static lg:z-auto lg:min-w-[28rem] lg:flex-1 lg:pt-0"
              onKeyDown={(event) => {
                if (event.key !== "Escape" || event.defaultPrevented || (event.target as HTMLElement).closest("[data-radix-popper-content-wrapper]")) return;
                closeDocument();
              }}>
              <DocumentWorkspace key={openDocumentId} artifactId={openDocumentId} variant="panel" onClose={closeDocument} onAsk={askAboutDocument} revision={documentRevision} />
            </section>
          )}
        </div>
      </div>
      </DocumentLinksContext.Provider>
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
      <div className="grid gap-0.5">
        {conversations.map((conversation) => (
          <div key={conversation.id} className="relative">
            <button
              type="button"
              onClick={() => onSelect(conversation.id)}
              aria-current={selectedId === conversation.id ? "page" : undefined}
              className={cn(
                "grid w-full gap-1 rounded-md p-3 pr-11 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                selectedId === conversation.id && "bg-brand-soft hover:bg-brand-soft",
              )}
            >
              <span className="truncate text-sm font-medium">{conversation.title || "Nova conversa"}</span>
              {/* Relative labels can cross a minute boundary while the HTML is in transit. */}
              <span suppressHydrationWarning className="text-[13px] text-subtle-foreground">{formatConversationTime(conversation.updatedAt)}</span>
            </button>
            <Button variant="ghost" size="icon-sm" className="absolute top-2 right-2 size-11 md:size-7" onClick={() => onDelete(conversation.id)} aria-label={`Excluir ${conversation.title || "conversa"}`}><Trash2 /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}
