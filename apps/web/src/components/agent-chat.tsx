"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { useAISDKRuntime } from "@assistant-ui/ai-sdk";
import {
  ArrowDown,
  Check,
  CircleAlert,
  ExternalLink,
  Copy,


  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import type { AgentContext } from "@/components/agent-sources-panel";
import { readListOpen, subscribeListOpen, writeListOpen, serverListOpen } from "@/lib/agent-history";
import { Skeleton } from "@/components/ui/skeleton";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { type Modalities } from "@/lib/ai-modalities";
import { cn } from "@/lib/utils";
import { attachmentPart, MAX_CHAT_ATTACHMENTS, MAX_CHAT_FILE_BYTES, MAX_CHAT_IMAGE_BYTES, type ChatAttachment } from '@/lib/chat-attachment-contract';
import type { CitationItem } from "@/lib/citations/verdict";
import { citationLabel, sourceHref, toReview } from "@/lib/citations/labels";
import { SmartWorking } from "@/components/smart-options";
import { THINKING, toolModule, type ChatStatus } from "@/lib/chat-status";
import { applyApprovalDecisions, approvalDecision, type ApprovalDecision } from "@/lib/chat-approval-state";
import { citationMarkdown, webReference } from "@/lib/citations/web-references";

import { Composer, type ComposerToolsProps } from '@/components/lume-panel/composer';
import { EmptyState } from '@/components/lume-panel/empty-state';
import { ConversationList } from '@/components/lume-panel/history';
import { PanelHeader } from '@/components/lume-panel/panel-header';
import { UserMessage } from '@/components/lume-panel/messages';
import { PlanCard } from '@/components/lume-panel/plan-card';
import { buildPlan, showsPlan, MODULE_LABELS, panelStatus } from '@/components/lume-panel/plan';
import { DocumentLinksContext as PlanLinksContext } from '@/components/lume-panel/chat-context';
import { subjectChip } from '@/components/lume-panel/icons';
import { resourceSubject } from '@/components/lume/redesign-shell-state';
import { useShell } from '@/components/shell/shell-context';
import { canvasCommandSchema, isCanvasHref } from '@/lib/canvas-protocol';
import { resourceKey } from '@/lib/lume-workspace';

const DOCUMENT_WRITES = new Set(["k5_artifacts_create", "k5_artifacts_edit", "k5_artifacts_update", "k5_artifacts_restore_version"]);
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

function AssistantText({ text }: { text: string }) {
  const content = useAuiState(state => state.message.content);
  const sources = content.flatMap(part => {
    if (part.type !== 'data' || part.name !== 'web-sources') return [];
    const parsed = webReference.array().safeParse(part.data && typeof part.data === 'object' && 'sources' in part.data ? part.data.sources : []);
    return parsed.success ? parsed.data : [];
  });
  return <Markdown text={citationMarkdown(text, sources)} />;
}

type StepData = { callId?: string; name?: string; summary?: string; state?: string; href?: string; canvasAction?: 'open' | 'touch' };

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
  const moduleSlug = toolModule(data.name ?? '');
  const running = data.state === 'running';
  const waiting = data.state === 'awaiting_approval' || data.state === 'interrupted' || data.state === 'cancelled';
  return (
    <p className={cn("mb-2 flex items-start gap-2 text-[13px] leading-5", failed ? "text-destructive" : "text-subtle-foreground")}>
      {running ? <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : failed || waiting ? <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> : <Check className="mt-0.5 size-3.5 shrink-0 text-brand-ink" aria-hidden="true" />}
      <span className="min-w-0"><span className="mr-2 font-medium text-foreground">{moduleSlug ? MODULE_LABELS[moduleSlug] : null}</span>{data.summary}{data.href && <> · <OpenLink href={data.href} /></>}</span>
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
    <div className="mt-3 grid gap-3 rounded-lg border border-brand/40 bg-card p-3.5" role="group" aria-label="Confirmação">
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
  const documents = useContext(DocumentLinksContext);
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
      canvasAction: 'canvasAction' in data && (data.canvasAction === 'open' || data.canvasAction === 'touch') ? data.canvasAction : undefined,
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
  const values = [...steps.values()];
  useEffect(() => { for (const step of values) documents?.openOrReloadFromToolStep(step); });
  const decisions = useContext(ApprovalDecisionsContext)?.decisions;
  const plan = buildPlan(content.flatMap(part => part.type === 'data' ? [{ name: part.name, data: part.data }] : []), { decisions });
  if (showsPlan(plan)) return <PlanCard plan={plan} />;
  if (!steps.size) return null;
  return <div aria-label="Atividade do Lume" className="mb-4 border-l border-brand/30 pl-3">{[...steps].map(([key, step]) => <ToolStep key={key} data={step} />)}</div>;
}

const assistantParts = { Text: AssistantText, data: { by_name: { tool: () => null, approval: ApprovalStep, jurisprudence: JurisprudenceList, citations: CitationsList, 'web-sources': WebSources } } };

const WorkingContext = createContext("");
const UserNameContext = createContext('');

function ChatWelcome() {
  const name = useContext(UserNameContext);
  const { resource } = useLumeState();
  return <EmptyState userName={name} subject={resourceSubject(resource)} />;
}

function AssistantMessage() {
  const working = useContext(WorkingContext);
  return (
    <MessagePrimitive.Root className="group flex w-full flex-col gap-1.5 text-[15px] leading-[1.6]">
      <div className="min-w-0 text-[14.5px] leading-[1.6] text-foreground max-md:text-[15px]">
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

function LumeThread({ tools }: { tools: ComposerToolsProps }) {
  const [away, setAway] = useState(false);
  const { resource } = useLumeState();
  return <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
    <ThreadPrimitive.Viewport data-chat-viewport className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 pt-[18px] max-md:px-4" turnAnchor="bottom" onScroll={event => {
      const el = event.currentTarget;
      setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 240);
    }}>
      <ThreadPrimitive.Empty><ChatWelcome /></ThreadPrimitive.Empty>
      <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
      <ThreadPrimitive.ViewportFooter className="lume-composer-wrap sticky bottom-0 z-10 mt-auto shrink-0 pb-3 pt-3">
        {away && <ThreadPrimitive.ScrollToBottom aria-label="Voltar ao mais recente" behavior="auto" className="absolute -top-12 left-1/2 grid size-11 -translate-x-1/2 place-items-center rounded-full border bg-background shadow-[var(--shadow-float)] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:hidden"><ArrowDown className="size-4" /></ThreadPrimitive.ScrollToBottom>}
        <Composer tools={tools} chip={subjectChip(resourceSubject(resource))} />
      </ThreadPrimitive.ViewportFooter>
    </ThreadPrimitive.Viewport>
  </ThreadPrimitive.Root>;
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
  const shell = useShell();
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
      return { body: { ...scope, canvas: body?.canvas, sharedProposalId: body?.sharedProposalId ?? null, conversationId, attachmentIds, message, trigger, messageId, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } };
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
  const [activityHref, setActivityHref] = useState<string>();
  const chat = useChat({
    id: conversationId, messages, transport, resume: true, onFinish,
    onError: error => onError(chatErrorMessage(error)),
    onData: part => {
      if (part.type === 'data-canvas') {
        const parsed = canvasCommandSchema.safeParse(part.data);
        if (parsed.success) setActivityHref(parsed.data.href);
      }
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
    setRunTarget(controller.getSnapshot().resource?.title ?? tools.contextLabel);
    setRunHref(scope.canvasHref);
    setActivityHref(undefined);
    const requestOptions = { ...options, body: { ...options?.body, sharedProposalId: selectedProposalRef.current, frozenScope: scope, canvas: { subject: resourceSubject(controller.getSnapshot().resource), tabs: controller.getSnapshot().tabs.filter(resource => isCanvasHref(resource.href)).slice(0, 16).map(resource => ({ href: resource.href, title: resource.title })) } } };
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
    setActivityHref(undefined);
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
  const latest = chat.messages.findLast(message => message.role === 'assistant');
  const plan = buildPlan(latest?.parts.flatMap(part => part.type.startsWith('data-') && 'data' in part ? [{ name: part.type.slice(5), data: part.data }] : []) ?? [], { running: running ? working || THINKING : null, decisions });
  const activityState = running ? 'working' : plan.needs ? 'attention' : 'idle';
  const activityStatus = panelStatus(plan, running);
  const setActivity = shell?.setActivity;
  useEffect(() => {
    const snapshot = controller.getSnapshot();
    const touched = snapshot.tabs.find(tab => tab.href === (activityHref ?? runHref));
    setActivity?.({ state: activityState, status: activityStatus, caseId: storedMessageScope(chat.messages.findLast(message => message.role === 'user'))?.caseId, place: touched ? resourceKey(touched) : undefined });
  }, [activityState, activityStatus, activityHref, runHref, controller, setActivity, chat.messages]);
  useEffect(() => () => setActivity?.({ state: 'idle' }), [setActivity]);
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

export function AgentChat({ identityKey, displayName = '', modalities = { image: false, audio: false }, panelControls }: { identityKey: string; displayName?: string; modalities?: Modalities; panelControls: React.ReactNode }) {
  const { controller, openResource, conversationIntent } = useLumeWorkspace();
  const workspace = useLumeState();
  const shell = useShell();
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
  const listOpen = useSyncExternalStore(subscribeListOpen, readListOpen, serverListOpen);
  const [uploading, setUploading] = useState(0);
  const [draftFiles, setDraftFiles] = useState<Record<string, ChatAttachment[]>>({});
  const sendNavigation = useRef<{ conversationId: string; navigation: number } | undefined>(undefined);
  const intentId = useRef<string | null>(null);
  const [handledIntent, setHandledIntent] = useState(0);
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
      if (step.canvasAction !== 'touch' && canonicalCanvasHref(step.href)) void openResource(step.href, sendNavigation.current?.conversationId === selectedId ? sendNavigation.current.navigation : -1);
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
      <PlanLinksContext value={{ open: openDocument, follow: command => { if (command.action === 'open') void openResource(command.href); } }}>
      <div className="agent-chat flex min-h-0 flex-1 flex-col overflow-hidden">
        <PanelHeader mark={shell?.activity.state ?? 'idle'} status={shell?.activity.status ?? ''} historyOpen={listOpen} onHistory={toggleList} onNew={() => void createConversation().catch(cause => setError(chatErrorMessage(cause)))} panelControls={panelControls} historyRef={historyToggle} />
     {error && <p className="flex items-start gap-2 border-b px-4 py-2 text-sm text-destructive md:px-8" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}

        <div className="relative flex min-h-0 flex-1">
          <aside id="agent-conversations" aria-label="Conversas" inert={!listOpen} aria-hidden={!listOpen} className="agent-chat-history absolute inset-0 z-20 min-h-0 w-full flex-col overflow-y-auto border-t bg-pane">
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
      </PlanLinksContext>
      </DocumentLinksContext.Provider>
    </TooltipProvider></UserNameContext>
  );
}

function ConversationCards(props: { conversations: Conversation[]; selectedId: string | null; onSelect: (id: string) => void; onDelete: (id: string) => void }) {
  return <ConversationList {...props} className="p-2" />;
}
