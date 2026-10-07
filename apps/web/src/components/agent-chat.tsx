"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { GoogleApprovalReview } from '@/components/google/client';
import { PageApprovalReview } from '@/components/document/page-approval-review';
import { useRouter } from 'next/navigation';
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import { useLumeState, useLumeWorkspace } from '@/components/lume/workspace-context';
import { accessLost, ConversationReadError, storedMessageScope } from '@/lib/chat-scope';
import { canonicalCanvasHref, type MessageScope } from '@/lib/lume-workspace';
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
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
} from "lucide-react";
import type { AgentContext } from "@/components/agent-sources-panel";
import dynamic from "next/dynamic";
import { readListOpen, subscribeListOpen, writeListOpen, serverListOpen } from "@/lib/agent-history";
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
import { attachmentPart, MAX_CHAT_ATTACHMENTS, MAX_CHAT_FILE_BYTES, MAX_CHAT_IMAGE_BYTES, type ChatAttachment } from '@/lib/chat-attachment-contract';
import { useVoiceRecorder, VoiceLevel } from './voice-recorder';
import type { CitationItem } from "@/lib/citations/verdict";
import { citationLabel, sourceHref, toReview } from "@/lib/citations/labels";
import { SmartWorking } from "@/components/smart-options";
import { THINKING, toolModule, type ChatStatus } from "@/lib/chat-status";
import { applyApprovalDecisions, approvalDecision, type ApprovalDecision } from "@/lib/chat-approval-state";
import { citationMarkdown, webReference } from "@/lib/citations/web-references";

const DOCUMENT_WRITES = new Set(["k5_artifacts_create", "k5_artifacts_edit", "k5_artifacts_update", "k5_artifacts_restore_version"]);
const AgentArtifactsPanel = dynamic(() => import("./agent-artifacts-panel").then(module => module.AgentArtifactsPanel), {
  loading: () => <p role="status" className="p-6 text-sm text-muted-foreground">Carregando artefatos…</p>,
});
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

  }
}

function clearMessages(id: string) {
  memoryMessages.delete(id);
  try { sessionStorage.removeItem(MESSAGE_CACHE + id); } catch { /* Storage may be disabled. */ }
}

function chatErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { error?: unknown };
      if (typeof parsed?.error === "string" && parsed.error) return parsed.error;
    } catch {

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

function AssistantText({ text }: { text: string }) {
  const content = useAuiState(state => state.message.content);
  const sources = content.flatMap(part => {
    if (part.type !== 'data' || part.name !== 'web-sources') return [];
    const parsed = webReference.array().safeParse(part.data && typeof part.data === 'object' && 'sources' in part.data ? part.data.sources : []);
    return parsed.success ? parsed.data : [];
  });
  return <Markdown text={citationMarkdown(text, sources)} />;
}

type StepData = { callId?: string; name?: string; summary?: string; state?: string; href?: string };

type DocumentLinks = { open: (id: string) => void; openResource: (href: string) => void; openOrReloadFromToolStep: (step: StepData) => void; changed: (key: string) => void };
const DocumentLinksContext = createContext<DocumentLinks | null>(null);
const DOCUMENT_PREFIX = "/app/documents/";
const documentKeyFrom = (href?: string) => {
  const artifact = href && /^\/app\/documents\/([^/]+)$/.exec(href);
  if (artifact) return `artifact:${decodeURIComponent(artifact[1])}`;
  const page = href && /^\/app\/vault\/cases\/([^/]+)\/pages\/([^/]+)$/.exec(href);
  return page ? `case-page:${decodeURIComponent(page[1])}:${decodeURIComponent(page[2])}` : null;
};
const documentIdFrom = (href?: string) => href?.startsWith(DOCUMENT_PREFIX) ? decodeURIComponent(href.slice(DOCUMENT_PREFIX.length)) : null;

function OpenLink({ href }: { href: string }) {
  const documents = useContext(DocumentLinksContext);
  const documentId = documentIdFrom(href);
  if (href.startsWith('/api/')) return <a href={href} download className="text-brand-ink underline-offset-4 hover:underline focus-visible:underline">Baixar</a>;
  if (documentId && documents) {
    return <button type="button" onClick={() => documents.open(documentId)} className="text-brand-ink underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none">Abrir</button>;
  }
  if (documents && canonicalCanvasHref(href)) return <button type="button" onClick={() => documents.openResource(href)} className="text-brand-ink underline-offset-4 hover:underline">Abrir</button>;
  return null;
}

function ToolStep({ data }: { data: StepData }) {
  const documents = useContext(DocumentLinksContext);
  useEffect(() => { if (data) documents?.openOrReloadFromToolStep(data); }, [data, documents]);
  if (!data?.summary) return null;
  const failed = data.state === "failed";
  const running = data.state === 'running';
  const waiting = data.state === 'awaiting_approval' || data.state === 'interrupted' || data.state === 'cancelled';
  return (
    <p className={cn("mb-2 flex items-start gap-2 text-[13px] leading-5", failed ? "text-destructive" : "text-subtle-foreground")}>
      {running ? <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : failed || waiting ? <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> : <Check className="mt-0.5 size-3.5 shrink-0 text-brand-ink" aria-hidden="true" />}
      <span className="min-w-0"><span className="mr-2 font-medium text-foreground">{toolModule(data.name)}</span>{data.summary}{data.href && <> · <OpenLink href={data.href} /></>}</span>
    </p>
  );
}

const ConversationIdContext = createContext("");
const SharedProposalContext = createContext<{ selected: string | null; select: (id: string | null) => void } | null>(null);
const ApprovalDecisionsContext = createContext<{
  decisions: ReadonlyMap<string, ApprovalDecision>;
  record: (id: string, decision: ApprovalDecision) => void;
} | null>(null);
type ApprovalData = { preparedContent?: boolean; approvalId: string; capability?: string; summary: string; state: "pending" | "confirmed" | "cancelled" | "failed"; result?: string; href?: string };

function ApprovalStep({ data }: { data: ApprovalData }) {
  const conversationId = useContext(ConversationIdContext);
  const documents = useContext(DocumentLinksContext);
  const decisions = useContext(ApprovalDecisionsContext);
  const sharedProposal = useContext(SharedProposalContext);
  const pageApproval = !!data?.preparedContent || (data?.capability?.startsWith('k5_case_pages_') ?? false);
  const googleApproval = /^k5_(gmail|calendar|drive|docs)_/.test(data?.capability ?? '') &&
    !['k5_calendar_discard_pending', 'k5_calendar_unshare_event'].includes(data.capability ?? '');
  const [reviewReady, setReviewReady] = useState(false);
  const [busy, setBusy] = useState<"" | "confirm" | "cancel">("");
  const [error, setError] = useState("");
  if (!data?.approvalId) return null;
  const current = decisions?.decisions.get(data.approvalId) ?? data;
  async function decide(decision: "confirm" | "cancel") {
    setBusy(decision); setError("");
    try {
      const response = await fetch(`/api/chat/approvals/${encodeURIComponent(data.approvalId)}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, conversationId }),
      });
      const body = await response.json().catch(() => ({})) as ApprovalData & { error?: string };
      if (!response.ok) throw new Error(body.error || "Não foi possível concluir. Peça de novo ao Lume.");
      decisions?.record(data.approvalId, approvalDecision.parse(body));
      const changedDocument = body.state === "confirmed" ? documentKeyFrom(body.href) : null;
      if (changedDocument) documents?.changed(changedDocument);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível concluir."); }
    finally { setBusy(""); }
  }
  return (
    <div className="mt-3 grid gap-3 border-l-2 border-brand py-1 pl-4" role="group" aria-label="Confirmação">
      <p className="whitespace-pre-wrap break-words text-sm text-foreground">{data.preparedContent ? 'Revise o conteúdo preparado e quem poderá acessá-lo.' : pageApproval ? 'Revisar o conteúdo e o destino da página.' : data.summary}</p>
      {pageApproval && current.state === 'pending' && <PageApprovalReview key={data.approvalId} approvalId={data.approvalId} onReady={setReviewReady} />}
      {googleApproval && current.state === 'pending' && <GoogleApprovalReview approvalId={data.approvalId} onReady={setReviewReady} />}
      {current.state === "pending" ? <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" className="h-11 md:h-9" disabled={Boolean(busy) || ((googleApproval || pageApproval) && !reviewReady)} onClick={() => void decide("confirm")}>
          {busy === "confirm" && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}Confirmar</Button>
        <Button type="button" size="sm" variant="ghost" className="h-11 md:h-9" disabled={Boolean(busy)} onClick={() => void decide("cancel")}>Cancelar</Button>
      </div> : <p className={cn("text-[13px]", current.state === "failed" ? "text-destructive" : "text-subtle-foreground")} role="status">
        {current.state === "confirmed" ? "Confirmado" : current.state === "cancelled" ? "Cancelado" : "Não concluído"}{current.result ? ` · ${current.result}` : ""}
        {current.href && <> · <OpenLink href={current.href} /></>}
      </p>}
      {['k5_case_pages_create', 'k5_case_pages_update'].includes(data.capability ?? '') && current.state !== 'cancelled' && <Button type="button" size="sm" variant="ghost" onClick={() => sharedProposal?.select(data.approvalId)}>
        {sharedProposal?.selected === data.approvalId ? 'Proposta selecionada para continuar' : 'Continuar esta proposta'}
      </Button>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

type JurisprudenceData = {
  results?: Array<{ title: string; court: string; caseNumber: string | null; date: string | null; url: string; summary: string; relevanceLabel: string | null }>;
  note?: string;
};

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
                {citationLabel(item)}
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

function WebSources({ data }: { data: unknown }) {
  const parsed = webReference.array().safeParse(data && typeof data === 'object' && 'sources' in data ? data.sources : []);
  if (!parsed.success || !parsed.data.length) return null;
  const sources = [...new Map(parsed.data.map(source => [source.url, source])).values()];
  return <details className="mt-3 text-[13px] text-subtle-foreground">
    <summary className="cursor-pointer focus-visible:outline focus-visible:outline-ring">Fontes da pesquisa ({sources.length})</summary>
    <div className="mt-2 grid gap-2">{sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="break-words underline underline-offset-4">{source.title || source.url}</a>)}</div>
  </details>;
}

function ToolActivity() {
  const content = useAuiState(state => state.message.content);
  const steps = new Map<string, StepData>();
  for (const [index, part] of content.entries()) {
    if (part.type !== 'data' || part.name !== 'tool' || !part.data || typeof part.data !== 'object') continue;
    const data = part.data;
    if (!('summary' in data) || typeof data.summary !== 'string') continue;
    const step: StepData = {
      summary: data.summary,
      name: 'name' in data && typeof data.name === 'string' ? data.name : undefined,
      callId: 'callId' in data && typeof data.callId === 'string' ? data.callId : undefined,
      href: 'href' in data && typeof data.href === 'string' ? data.href : undefined,
      state: 'state' in data && typeof data.state === 'string' ? data.state : undefined,
    };
    if (step.state === 'awaiting_approval' && 'approvalId' in data) {
      const approval = content.find(part => part.type === 'data' && part.name === 'approval' && part.data && typeof part.data === 'object' && 'approvalId' in part.data && part.data.approvalId === data.approvalId);
      if (approval?.type === 'data' && approval.data && typeof approval.data === 'object' && 'state' in approval.data) {
        const state = approval.data.state;
        if (state === 'confirmed' || state === 'cancelled' || state === 'failed') {
          step.state = state === 'confirmed' ? 'completed' : state;
          step.summary = state === 'confirmed' ? 'Ação confirmada.' : state === 'cancelled' ? 'Ação cancelada.' : 'A ação não foi concluída.';
        }
      }
    }
    steps.set(step.callId ?? `unknown-${index}`, step);
  }
  if (!steps.size) return null;
  return <div aria-label="Atividade do Lume" className="mb-4 border-l border-brand/30 pl-3">{[...steps].map(([key, step]) => <ToolStep key={key} data={step} />)}</div>;
}

const assistantParts = { Text: AssistantText, data: { by_name: { tool: () => null, approval: ApprovalStep, jurisprudence: JurisprudenceList, citations: CitationsList, 'web-sources': WebSources } } };

const WorkingContext = createContext("");
const UserNameContext = createContext('');

function ChatWelcome() {
  const name = useContext(UserNameContext).trim().split(/\s+/)[0];
  const { resource } = useLumeState();
  const aui = useAui();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { const timer = window.setTimeout(() => setNow(new Date()), 0); return () => window.clearTimeout(timer); }, []);
  const greeting = now ? now.getHours() < 12 ? 'Bom dia' : now.getHours() < 18 ? 'Boa tarde' : 'Boa noite' : 'Olá';
  const prompts = ['Organizar minhas tarefas e próximos prazos', 'Resumir os documentos que eu selecionar', 'Consultar honorários pendentes', 'Pesquisar jurisprudência para uma questão'];
  return <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-end px-6 py-8 text-left">
    <p className="mb-2 text-xs text-muted-foreground">{now?.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
    <h2 className="text-2xl font-semibold tracking-tight">{greeting}{name ? `, ${name}` : ''}.</h2>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">{resource?.kind === 'case' ? `Podemos trabalhar em ${resource.title}. O contexto do próximo pedido está abaixo.` : 'Por onde começamos? Selecione um caso ou documentos no canvas, ou me conte o que precisa.'}</p>
    <p className="mt-2 text-xs text-muted-foreground">Esta conversa e sua memória são pessoais.</p>
    <div className="mt-5 grid gap-1">{prompts.map(prompt => <button key={prompt} type="button" className="min-h-11 rounded-md px-2 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { const composer = aui.composer(); const draft = composer.getState().text; composer.setText(draft.trim() ? `${draft}\n${prompt}` : prompt); document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Pergunte ao Lume"]')?.focus(); }}>{prompt}</button>)}</div>
  </div>;
}

function AssistantMessage() {
  const working = useContext(WorkingContext);
  return (
    <MessagePrimitive.Root className="group mx-auto w-full max-w-3xl px-4 py-4 md:px-8">
      <div className="max-w-[72ch] text-sm leading-7 text-foreground">
        <ToolActivity />
        <MessagePrimitive.Parts components={assistantParts} />
        <MessagePrimitive.If last>
          <AuiIf condition={(state) => state.thread.isRunning}>
            <SmartWorking className="not-first:mt-3">{working || THINKING}</SmartWorking>
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

  uploading: number;
  onPickFiles: (files: File[]) => void;
  onError: (message: string) => void;
  pendingFiles: ChatAttachment[];
  onRemoveFile: (id:string) => void;
  contextReady: boolean;
  contextLabel: string;
  runningTarget: string | null;
};

type Voice = ReturnType<typeof useVoiceRecorder>;

function ComposerTools({ modalities, uploading, onPickFiles, voice }: ComposerToolsProps & { voice: Voice }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cameraOpen,setCameraOpen]=useState(false);

  function pick(kind: "document" | "image") {
    const input = fileInput.current;
    if (!input) return;
    input.accept = kind === "image" ? IMAGE_ACCEPT : DOCUMENT_ACCEPT;
    setMenuOpen(false);
    input.click();
  }

  const audioHint = modalities.audio ? undefined : "O Lume não aceita áudio nesta configuração.";

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        aria-label="Arquivo para anexar"
        accept={DOCUMENT_ACCEPT}
        className="sr-only"
        multiple
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length) onPickFiles(files);
        }}
      />
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={composerControl} aria-label="Anexar arquivos" disabled={voice.state !== "idle"}>
            {uploading > 0 ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Plus className="size-4.5" />}
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
      {cameraOpen&&<ChatCamera onClose={()=>setCameraOpen(false)} onPhoto={file => onPickFiles([file])} />}

      {voice.state === "recording" ? (
        <button type="button" onClick={voice.cancel} aria-label="Descartar gravação" title="Descartar gravação" className={composerControl}>
          <Trash2 className="size-4" />
        </button>
      ) : (
        <HintedControl hint={audioHint}>
          <button type="button" onClick={() => void voice.start()} disabled={!modalities.audio || voice.state !== "idle"} aria-label="Gravar áudio" title="Gravar áudio" className={composerControl}>
            <Mic className="size-4.5" />
          </button>
        </HintedControl>
      )}
    </>
  );
}

function LumeThread({ tools }: { tools: ComposerToolsProps }) {
  const [away, setAway] = useState(false);
  const aui = useAui();

  const voice = useVoiceRecorder({
    onError: tools.onError,
    onText: (spoken) => {
      const composer = aui.composer();
      const typed = composer.getState().text.trim();
      composer.setText(typed ? `${typed}\n\n${spoken}` : spoken);
      if (!aui.thread().getState().isRunning && !tools.uploading && tools.contextReady) composer.send();
    },
  });
  return (
    <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
      <ThreadPrimitive.Viewport data-chat-viewport className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain" turnAnchor="bottom" onScroll={event => {
        const el = event.currentTarget;
        setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 240);
      }}>
        <ThreadPrimitive.Empty>
          <ChatWelcome />
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />

        <ThreadPrimitive.ViewportFooter className="lume-composer-wrap sticky bottom-0 z-10 mt-auto shrink-0 px-3 pb-3 pt-2">
          {away && <ThreadPrimitive.ScrollToBottom aria-label="Voltar ao mais recente" title="Voltar ao mais recente" behavior="auto" className="absolute -top-12 left-1/2 grid size-11 -translate-x-1/2 place-items-center rounded-full border bg-background shadow-[var(--shadow-float)] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:hidden"><ArrowDown className="size-4" /></ThreadPrimitive.ScrollToBottom>}
          {tools.runningTarget && <p role="status" className="px-2 pb-2 text-xs text-muted-foreground">Pedido em andamento · {tools.runningTarget}</p>}
          <ComposerPrimitive.Root className="lume-composer mx-auto w-full max-w-3xl border bg-background p-2 transition focus-within:border-brand">
            {tools.pendingFiles.length>0&&<div className="flex flex-wrap gap-2 p-2" aria-label="Anexos da próxima mensagem">{tools.pendingFiles.map(file=><ChatAttachmentView key={file.id} data={file} onRemove={()=>tools.onRemoveFile(file.id)} />)}</div>}
            {tools.uploading>0&&<p role="status" className="px-2 py-1 text-xs text-muted-foreground">{tools.uploading===1?'Preparando anexo…':`Preparando ${tools.uploading} anexos…`}</p>}
            {voice.state==='transcribing'&&<p role="status" className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />Transcrevendo áudio…</p>}
            <ComposerPrimitive.Input
              onKeyDownCapture={event => { if (event.key === 'Enter' && !event.shiftKey && !tools.contextReady) { event.preventDefault(); event.stopPropagation(); } }}
              rows={away ? 1 : 2}
              placeholder="Pergunte ao Lume"
              aria-label="Pergunte ao Lume"
              className={cn("max-h-[25dvh] w-full resize-none bg-transparent px-2 pt-2 pb-1 text-base outline-none transition-[min-height] duration-200 motion-reduce:transition-none placeholder:text-subtle-foreground md:text-sm", away ? "min-h-10" : "min-h-16")}
            />
            <div className="flex items-center gap-1">
              <ComposerTools {...tools} voice={voice} />
              {voice.state === "recording" && <VoiceLevel analyser={voice.analyser} seconds={voice.seconds} />}
              <div className="ml-auto flex items-center gap-2">
                {voice.state === "recording" ? (
                  <button type="button" onClick={voice.finish} className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground outline-none transition hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Parar gravação e enviar" title="Parar gravação e enviar">
                    <Square className="size-3.5 fill-current" />
                  </button>
                ) : voice.state === "transcribing" ? (
                  <span className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground opacity-40" aria-hidden="true">
                    <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                  </span>
                ) : <>
                <AuiIf condition={(state) => state.thread.isRunning}>
                  <ComposerPrimitive.Cancel className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Parar resposta">
                    <Square className="size-3.5 fill-current" />
                  </ComposerPrimitive.Cancel>
                </AuiIf>
                <AuiIf condition={(state) => !state.thread.isRunning}>
                  <ComposerPrimitive.Send disabled={tools.uploading > 0 || !tools.contextReady} className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground outline-none transition hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40" aria-label="Enviar mensagem">
                    <ArrowUp className="size-4" />
                  </ComposerPrimitive.Send>
                </AuiIf>
                </>}
              </div>
            </div>
            <p className="lume-context-chip" aria-label="Contexto da próxima mensagem" title={tools.contextLabel}>{tools.contextReady ? tools.contextLabel : 'Carregando contexto do canvas…'}</p>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

function RuntimeThread({ conversationId, identityKey, messages, onFilesSent, tools, onFinish, onError, onSend, onAccessLost }: {
  conversationId: string;
  identityKey: string;
  messages: UIMessage[];
  onFilesSent: (ids: string[]) => void;
  tools: ComposerToolsProps;
  onFinish: () => void;
  onError: (message: string) => void;
  onSend: (navigation: number) => void;
  onAccessLost: () => void;
}) {
  const { controller, registerSender } = useLumeWorkspace();
  const [selectedProposal, setSelectedProposal] = useState<string | null>(null);
  const selectedProposalRef = useRef<string | null>(null);
  const selectProposal = (id: string | null) => { selectedProposalRef.current = id; setSelectedProposal(id); };
  const lastMessageId = messages.at(-1)?.id ?? '';
  const [transport] = useState(() => new DefaultChatTransport({
    api: '/api/chat',
    prepareReconnectToStreamRequest: () => ({ api: `/api/chat/${encodeURIComponent(conversationId)}/stream?last=${encodeURIComponent(lastMessageId)}` }),
    prepareSendMessagesRequest: ({ messages: history, trigger, messageId, body }) => {
      const message = history.findLast(item => item.role === 'user');
      const attachmentIds = message?.parts.flatMap(part => part.type === 'data-attachment' && part.data && typeof part.data === 'object' && 'id' in part.data ? [part.data.id] : []) ?? [];
      const scope = body?.frozenScope as MessageScope | undefined;
      if (!scope && trigger !== 'regenerate-message') throw new Error('O contexto do pedido não foi definido. Tente novamente.');
      return { body: { ...scope, sharedProposalId: body?.sharedProposalId ?? null, conversationId, attachmentIds, message, trigger, messageId, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } };
    },
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (response.status === 401) onAccessLost();
      return response;
    },
  }));
  const [working, setWorking] = useState('');
  const [runTarget, setRunTarget] = useState<string | null>(() => storedMessageScope(messages.findLast(message => message.role === 'user'))?.label ?? null);
  const [runHref, setRunHref] = useState<string | undefined>(() => storedMessageScope(messages.findLast(message => message.role === 'user'))?.canvasHref);
  const chat = useChat({
    id: conversationId, messages, transport, resume: true, onFinish,
    onError: error => onError(chatErrorMessage(error)),
    onData: part => {
      if (part.type === 'data-status') setWorking((part.data as ChatStatus).label);
      if (part.type === 'data-scope' && part.data && typeof part.data === 'object' && 'label' in part.data) {
        setRunTarget(String(part.data.label));
        setRunHref('canvasHref' in part.data && typeof part.data.canvasHref === 'string' ? part.data.canvasHref : undefined);
      }
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
        storeMessages(`${identityKey}:${conversationId}`, updated);
        return updated;
      });
    },
  }), [decisions, setChatMessages, conversationId, identityKey]);
  const sendMessage: typeof chat.sendMessage = (message, options) => {
    // Copy before the SDK awaits anything. The stable transport only serializes this copy.
    let scope: MessageScope;
    try { scope = controller.takeScope(); }
    catch (cause) { onError(chatErrorMessage(cause)); return Promise.resolve(); }
    onSend(controller.getSnapshot().navigation);
    setRunTarget(tools.contextLabel);
    setRunHref(scope.canvasHref);
    const requestOptions = { ...options, body: { ...options?.body, sharedProposalId: selectedProposalRef.current, frozenScope: scope } };
    if (message && tools.pendingFiles.length) {
      const parts = 'parts' in message && message.parts ? message.parts : 'text' in message ? [{ type: 'text' as const, text: message.text ?? '' }] : [];
      const sending = chat.sendMessage({ id: 'id' in message ? message.id : undefined, role: 'user', parts: [...parts, ...tools.pendingFiles.map(attachmentPart)] }, requestOptions);
      onFilesSent(tools.pendingFiles.map(file => file.id));
      return sending;
    }
    return chat.sendMessage(message, requestOptions);
  };
  const regenerate: typeof chat.regenerate = options => {
    onSend(controller.getSnapshot().navigation);
    const index = options?.messageId ? chat.messages.findIndex(message => message.id === options.messageId) : chat.messages.length - 1;
    const originalScope = storedMessageScope(chat.messages.slice(0, index + 1).findLast(message => message.role === 'user'));
    setRunTarget(originalScope?.label ?? 'Contexto do pedido original');
    setRunHref(originalScope?.canvasHref);
    return chat.regenerate(options);
  };
  const stopTurn = async () => {
    await chat.stop();
    await fetch(`/api/chat/${encodeURIComponent(conversationId)}/stop`, { method: 'POST' }).catch(() => undefined);
  };
  const runtime = useAISDKRuntime({ ...chat, sendMessage, regenerate, stop: stopTurn });
  const sendCurrent = useRef(sendMessage);
  useLayoutEffect(() => { sendCurrent.current = sendMessage; });
  useEffect(() => registerSender(text => {
    if (chat.status === 'submitted' || chat.status === 'streaming') throw new Error('Aguarde a resposta atual do Lume.');
    void sendCurrent.current({ text });
  }), [registerSender, chat.status]);
  const running = chat.status === 'submitted' || chat.status === 'streaming';
  const currentTools = { ...tools, runningTarget: running && (runHref !== controller.getSnapshot().resource?.href || runTarget !== tools.contextLabel) ? runTarget : null };
  return <ConversationIdContext.Provider value={conversationId}><WorkingContext.Provider value={chat.status === 'submitted' ? '' : working}>
    <SharedProposalContext.Provider value={{ selected: selectedProposal, select: selectProposal }}>
    <ApprovalDecisionsContext.Provider value={approvalDecisions}>
      {selectedProposal && <div className="flex items-center justify-between px-4 text-xs"><span>Continuando a proposta selecionada</span><Button variant="ghost" size="sm" onClick={() => selectProposal(null)}>Novo pedido independente</Button></div>}
      <AssistantRuntimeProvider runtime={runtime}><LumeThread tools={currentTools} /></AssistantRuntimeProvider>
    </ApprovalDecisionsContext.Provider>
    </SharedProposalContext.Provider>
  </WorkingContext.Provider></ConversationIdContext.Provider>;
}

export function AgentChat({ identityKey, displayName = '', modalities = { image: false, audio: false } }: { identityKey: string; displayName?: string; modalities?: Modalities }) {
  const { controller, openResource, conversationIntent } = useLumeWorkspace();
  const workspace = useLumeState();
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeConversation = useRef<string | null>(null);
  useLayoutEffect(() => { activeConversation.current = selectedId; }, [selectedId]);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const hydratedConversation = useRef<string | undefined>(undefined);
  const [error, setError] = useState('');
  const visibleCase = workspace.resource?.kind === 'case' || workspace.resource?.kind === 'file' ? workspace.resource.caseId : null;
  const context: AgentContext = { ...workspace.sources, caseId: visibleCase ?? workspace.sources.caseId };
  const setContext = (sources: AgentContext) => controller.dispatch({ type: 'sources', sources });
  const [contextOpen, setContextOpen] = useState(false);
  const [contextHref, setContextHref] = useState(workspace.href);
  const listOpen = useSyncExternalStore(subscribeListOpen, readListOpen, serverListOpen);
  const [uploading, setUploading] = useState(0);
  const [draftFiles, setDraftFiles] = useState<Record<string, ChatAttachment[]>>({});
  const sendNavigation = useRef<{ conversationId: string; navigation: number } | undefined>(undefined);
  const intentId = useRef<string | null>(null);
  const [handledIntent, setHandledIntent] = useState(0);
  if (contextHref !== workspace.href) { setContextHref(workspace.href); setContextOpen(false); }
  if (conversationIntent && conversationIntent.serial !== handledIntent) {
    setHandledIntent(conversationIntent.serial);
    setSelectedId(conversationIntent.id);
  }
  useLayoutEffect(() => {
    if (!conversationIntent) return;
    intentId.current = conversationIntent.id;
  }, [conversationIntent]);
  const loseAccess = useCallback(() => {
    for (const key of memoryMessages.keys()) if (key.startsWith(identityKey + ':')) clearMessages(key);
    try {
      for (const key of Object.keys(sessionStorage)) if (key.startsWith(MESSAGE_CACHE + identityKey + ':')) sessionStorage.removeItem(key);
    } catch { /* Storage may be disabled. */ }
    setMessages([]); setSelectedId(null); setConversations([]); setDraftFiles({});
    router.replace('/sign-in'); router.refresh();
  }, [identityKey, router, setDraftFiles]);
  const handledCalls = useRef(new Set<string>());
  const historyToggle = useRef<HTMLButtonElement>(null);
  function toggleList() {
    writeListOpen(!listOpen);
  }

  const attachFiles = useCallback(async (files: File[]) => {
    if(!selectedId) return;
    setError("");
    const room=MAX_CHAT_ATTACHMENTS-(draftFiles[selectedId]?.length??0)-uploading;
    const problems:string[]=[];
    if(files.length>room) problems.push(room>0?`Anexe até seis arquivos por mensagem; ${files.length-room} ficaram de fora.`:'Anexe até seis arquivos por mensagem.');
    const accepted=files.slice(0,Math.max(0,room)).filter(file=>{
      const image=file.type.startsWith('image/');
      if(file.size>(image?MAX_CHAT_IMAGE_BYTES:MAX_CHAT_FILE_BYTES)) {problems.push(`${file.name}: ${image?'a imagem excede 10 MB':'o arquivo excede 25 MB'}.`);return false;}
      return true;
    });
    const report=()=>{ if(problems.length) setError(problems.join(' ')); };
    if(!accepted.length) {report();return;}
    setUploading(count=>count+accepted.length);
    await Promise.all(accepted.map(async file=>{
      try {
        const body = new FormData();
        body.set("file", file);
        body.set('conversationId',selectedId);
        const response = await fetch('/api/chat/attachments', { method: 'POST', body });
        const result = await response.json().catch(()=>({})) as {error?:string;attachment?:ChatAttachment};
        if(!response.ok||!result.attachment) throw new Error(result.error??'Não foi possível enviar o arquivo.');
        setDraftFiles(current=>({...current,[selectedId]:[...(current[selectedId]??[]),result.attachment!]}));
      } catch (cause) {
        const reason=cause instanceof Error ? cause.message : "Não foi possível enviar o arquivo.";
        problems.push(accepted.length>1?`${file.name}: ${reason}`:reason);
      } finally {
        setUploading(count=>count-1);
      }
    }));
    report();
  }, [selectedId,draftFiles,uploading,setDraftFiles]);

  async function removeDraftFile(id:string) {
    const response=await fetch(`/api/chat/attachments/${encodeURIComponent(id)}`,{method:'DELETE'});
    if(!response.ok) {setError('Não foi possível remover o anexo. Tente novamente.');return;}
    setDraftFiles(current=>Object.fromEntries(Object.entries(current).map(([key,files])=>[key,files.filter(file=>file.id!==id)])));
  }

  const loadConversations = useCallback(async () => {
    const response = await fetch("/api/conversations");
    if (response.status === 401 || response.status === 403) { loseAccess(); throw new ConversationReadError(response.status); }
    if (!response.ok) throw new Error("Não foi possível carregar o histórico.");
    const next = unwrapConversations(await response.json());
    setConversations(next);
    return next;
  }, [loseAccess]);

  const creatingConversation = useRef<ReturnType<typeof createConversation> | null>(null);
  const createConversation = useCallback(async () => {
    setError("");
    writeListOpen(false);
    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error("Não foi possível criar uma conversa.");
    const conversation = unwrapConversation(await response.json());
    if (!conversation) throw new Error("A nova conversa não retornou um identificador.");
    setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
    storeMessages(`${identityKey}:${conversation.id}`, []);
    hydratedConversation.current = conversation.id;
    setMessages([]);
    setLoadedConversationId(conversation.id);
    setSelectedId(conversation.id);
    return conversation;
  }, [identityKey]);

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const next = await loadConversations();
        if (cancelled) return;
        if (intentId.current) setSelectedId(intentId.current);
        else if (next[0]) setSelectedId(next[0].id);
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
  }, [createConversation, loadConversations]);

  useEffect(() => {
    if (!selectedId) return;
    if (hydratedConversation.current === selectedId) {
      hydratedConversation.current = undefined;
      return;
    }
    const controller = new AbortController();
    fetch(`/api/conversations/${encodeURIComponent(selectedId)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new ConversationReadError(response.status);
        const next = unwrapMessages(await response.json());
        storeMessages(`${identityKey}:${selectedId}`, next);
        setMessages(next);
        setLoadedConversationId(selectedId);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Não foi possível abrir esta conversa.");
        if (cause instanceof ConversationReadError && accessLost(cause.status)) {
          clearMessages(`${identityKey}:${selectedId}`);
          setMessages([]); setLoadedConversationId(null); setSelectedId(null);
          setConversations(current => current.filter(item => item.id !== selectedId));
          setDraftFiles(current => { const next = { ...current }; delete next[selectedId]; return next; });
          if (cause.status === 401) loseAccess();
          return;
        }
        setMessages(cachedMessages(`${identityKey}:${selectedId}`) ?? []);
        setLoadedConversationId(selectedId);
      });
    return () => controller.abort();
  }, [selectedId, identityKey, loseAccess]);

  async function removeConversation(id: string) {
    const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) {
      setError("Não foi possível excluir a conversa.");
      return;
    }
    clearMessages(`${identityKey}:${id}`);
    const remaining = conversations.filter((conversation) => conversation.id !== id);
    setConversations(remaining);
    if (selectedId === id) {
      if (remaining[0]) setSelectedId(remaining[0].id);
      else void createConversation().catch((cause) => setError(cause instanceof Error ? cause.message : "Não foi possível criar uma conversa."));
    }
  }

  const selectedCount = new Set([...context.documentIds, ...(workspace.resource?.kind === 'file' ? [workspace.resource.documentId] : [])]).size + context.researchReferenceIds.length;

  const composerTools: ComposerToolsProps = {
    modalities,
    uploading,
    onPickFiles: (files) => void attachFiles(files),
    onError: setError,
    pendingFiles:selectedId?draftFiles[selectedId]??[]:[],
    onRemoveFile:id=>void removeDraftFile(id),
    contextReady: workspace.resource !== null,
    contextLabel: `${workspace.resource?.title ?? 'Carregando contexto'}${!visibleCase && context.caseId ? ` · ${context.caseLabel ?? 'Caso selecionado'}` : ''}${selectedCount ? ` · ${selectedCount} fonte${selectedCount === 1 ? '' : 's'}` : ''}`,
    runningTarget: null,
  };

  const visibleMessages = useMemo(() => selectedId && loadedConversationId === selectedId ? messages : [],
    [selectedId, loadedConversationId, messages]);
  const waitingForMessages = Boolean(selectedId && loadedConversationId !== selectedId);

  const loadedCalls = useMemo(() => new Set(visibleMessages.flatMap(message => message.parts.flatMap(part =>
    part.type === "data-tool" && part.data && typeof part.data === "object" && "callId" in part.data ? [String(part.data.callId)] : []))), [visibleMessages]);

  const openDocument = useCallback((id: string) => {
    void openResource(`/app/documents/${encodeURIComponent(id)}`);
  }, [openResource]);
  const documentLinks = useMemo<DocumentLinks>(() => ({
    open: openDocument,
    openResource: href => { void openResource(href); },
    changed: key => controller.dispatch({ type: 'changed', key }),
    openOrReloadFromToolStep: step => {
      if (!step.callId || loadedCalls.has(step.callId) || handledCalls.current.has(step.callId)) return;
      if (step.state !== 'completed' || !step.href || !step.name) return;
      handledCalls.current.add(step.callId);
      const id = (DOCUMENT_WRITES.has(step.name) || /^k5_case_pages_(create|update|publish|restore)$/.test(step.name)) ? documentKeyFrom(step.href) : null;
      if (id) controller.dispatch({ type: 'changed', key: id });
      if (canonicalCanvasHref(step.href)) void openResource(step.href, sendNavigation.current?.conversationId === selectedId ? sendNavigation.current.navigation : -1);
    },
  }), [loadedCalls, openDocument, openResource, controller, selectedId]);

  function selectConversation(id: string) {
    setSelectedId(id);
    writeListOpen(false);
    requestAnimationFrame(() => historyToggle.current?.focus());
  }

  return (
    <UserNameContext value={displayName}><TooltipProvider>
      <DocumentLinksContext.Provider value={documentLinks}>
      <div className="agent-chat flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="lume-conversation-tools flex shrink-0 items-center justify-between gap-1 px-3 pb-2">
          <div className="flex min-w-0 items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button ref={historyToggle} variant="ghost" size="icon" className="-ml-2 size-11 text-muted-foreground md:ml-0 md:size-9" aria-label={listOpen ? "Ocultar conversas" : "Mostrar conversas"} aria-expanded={listOpen} aria-controls="agent-conversations" onClick={toggleList}>
                  {listOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{listOpen ? "Ocultar conversas" : "Mostrar conversas"}</TooltipContent>
            </Tooltip>
            <h2 className="sr-only">Conversa privada</h2>
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
              <SheetTrigger asChild><Button variant="ghost" size="icon" className="size-11 md:size-9" aria-label={selectedCount ? `Artefatos, ${selectedCount} fontes do Cofre` : "Artefatos"}><FileStack /></Button></SheetTrigger>
              <SheetContent side="right" showCloseButton={false} className="min-w-0 overflow-x-hidden gap-0 bg-background sm:max-w-md">
                <SheetHeader className="sr-only"><SheetTitle>Artefatos desta conversa</SheetTitle></SheetHeader>
                {contextOpen && <AgentArtifactsPanel conversationId={selectedId} context={context} onChange={setContext} lockedCase={Boolean(visibleCase)}
                  onOpenDocument={id => { setContextOpen(false); openDocument(id); }} onClose={() => setContextOpen(false)} />}
              </SheetContent>
            </Sheet>
          </div>
        </header>

        {error && <p className="flex items-start gap-2 border-b px-4 py-2 text-sm text-destructive md:px-8" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}

        <div className="relative flex min-h-0 flex-1">
          <aside id="agent-conversations" aria-label="Conversas" inert={!listOpen} aria-hidden={!listOpen} className="agent-chat-history absolute inset-0 z-20 min-h-0 w-full flex-col overflow-y-auto border-t bg-panel">
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
          <div className="agent-chat-content flex min-h-0 min-w-0 flex-1 flex-col" inert={listOpen} aria-hidden={listOpen}>
            {loading || waitingForMessages ? (
              <div className="grid flex-1 place-items-center text-sm text-muted-foreground" role="status" aria-live="polite" aria-busy="true"><span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Carregando conversa…</span></div>
            ) : selectedId ? (
              <RuntimeThread
                key={selectedId}
                conversationId={selectedId}
                messages={visibleMessages}
                identityKey={identityKey}
                onFilesSent={ids=>setDraftFiles(current=>({...current,[selectedId]:(current[selectedId]??[]).filter(file=>!ids.includes(file.id))}))}
                tools={composerTools}
                onFinish={() => {
                  void loadConversations().catch(() => undefined);
                  void fetch(`/api/conversations/${encodeURIComponent(selectedId)}`)
                    .then(async (response) => {
                      if (accessLost(response.status)) {
                        clearMessages(`${identityKey}:${selectedId}`);
                        if (response.status === 401) { loseAccess(); return; }
                        if (activeConversation.current !== selectedId) return;
                        setMessages([]); setLoadedConversationId(null); setSelectedId(null);
                        setConversations(current => current.filter(item => item.id !== selectedId));
                        setDraftFiles(current => { const next = { ...current }; delete next[selectedId]; return next; });
                        setError('Não foi possível abrir esta conversa.');
                        return;
                      }
                      if (!response.ok) return;
                      storeMessages(`${identityKey}:${selectedId}`, unwrapMessages(await response.json()));
                    })
                    .catch(() => undefined);
                }}
                onError={setError}
                onSend={navigation => { sendNavigation.current = { conversationId: selectedId, navigation }; }}
                onAccessLost={loseAccess}
              />
            ) : (
              <div className="grid flex-1 place-items-center px-6 text-center text-sm text-subtle-foreground">Nenhuma conversa disponível.</div>
            )}
          </div>

        </div>
      </div>
      </DocumentLinksContext.Provider>
    </TooltipProvider></UserNameContext>
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
