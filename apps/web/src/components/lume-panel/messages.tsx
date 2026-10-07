"use client";

import { useContext, useMemo } from "react";
import { ActionBarPrimitive, MessagePrimitive, useAuiState } from "@assistant-ui/react";
import { Copy, ExternalLink, RefreshCw } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { SmartWorking } from "@/components/smart-options";
import { ChatAttachmentView } from "@/components/chat-attachment";
import { THINKING } from "@/lib/chat-status";
import type { CitationItem } from "@/lib/citations/verdict";
import { citationLabel, sourceHref, toReview } from "@/lib/citations/labels";
import { citationMarkdown, webReference } from "@/lib/citations/web-references";
import { ApprovalCard } from "./approval-card";
import { ApprovalDecisionsContext, WorkingContext } from "./chat-context";
import { buildPlan, showsPlan, type PlanPart } from "./plan";
import { PlanCard, ToolLine } from "./plan-card";

export function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="max-w-[86%] rounded-[14px] bg-muted px-3.5 py-2.5 text-[14.5px] leading-[1.55] break-words whitespace-pre-wrap max-md:max-w-[88%] max-md:rounded-2xl max-md:text-[15px]">
        <MessagePrimitive.Parts components={{ data: { by_name: { attachment: ChatAttachmentView } } }} />
      </div>
    </MessagePrimitive.Root>
  );
}

/** The model writes Markdown; this is what turns it into headings, lists and tables. */
function AssistantText({ text }: { text: string }) {
  const content = useAuiState((state) => state.message.content);
  const sources = content.flatMap((part) => {
    if (part.type !== "data" || part.name !== "web-sources") return [];
    const parsed = webReference.array().safeParse(part.data && typeof part.data === "object" && "sources" in part.data ? part.data.sources : []);
    return parsed.success ? parsed.data : [];
  });
  return <Markdown text={citationMarkdown(text, sources)} />;
}

type JurisprudenceData = {
  results?: Array<{ title: string; court: string; caseNumber: string | null; date: string | null; url: string; summary: string; relevanceLabel: string | null }>;
  note?: string;
};

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

/**
 * Case law the Lume found on the web. It is built from the tool result, not from the model's
 * prose, so every item carries the link the search returned and Jev's relevance, in plain text.
 */
function JurisprudenceList({ data }: { data: JurisprudenceData }) {
  const results = data?.results ?? [];
  return (
    <section aria-label="Jurisprudência encontrada na web" className="mt-4 grid gap-2">
      <h3 className="text-sm font-medium">Jurisprudência na web</h3>
      {results.length ? <ol className="grid gap-4">
        {results.map((item) => (
          <li key={item.url} className="grid gap-1">
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="group inline-flex items-start gap-1.5 text-sm font-medium leading-6 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="min-w-0 break-words">{item.title}</span><ExternalLink className="mt-1.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="sr-only"> (abre em nova aba)</span>
            </a>
            <p className="text-[13px] leading-5 text-subtle-foreground">
              {[item.court, item.caseNumber, item.date, hostOf(item.url)].filter(Boolean).join(" · ")}
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
        <ul className="grid gap-3">
          {pending.map((item) => (
            <li key={item.id} className="grid gap-0.5">
              <p className="text-sm font-medium leading-6">{item.text}</p>
              <p className="text-[13px] leading-5 text-subtle-foreground">
                {citationLabel(item)}
                {item.source && <> · {sourceHref(item.source.url)
                  ? <a href={sourceHref(item.source.url)!} target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-4">{item.source.title || "fonte"}<span className="sr-only"> (abre em nova aba)</span></a>
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
  const parsed = webReference.array().safeParse(data && typeof data === "object" && "sources" in data ? data.sources : []);
  if (!parsed.success || !parsed.data.length) return null;
  const sources = [...new Map(parsed.data.map((source) => [source.url, source])).values()];
  return <details className="mt-3 text-[13px] text-subtle-foreground">
    <summary className="cursor-pointer focus-visible:outline focus-visible:outline-ring">Fontes da pesquisa ({sources.length})</summary>
    <div className="mt-2 grid gap-2">{sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="break-words underline underline-offset-4">{source.title || source.url}</a>)}</div>
  </details>;
}

const assistantParts = {
  Text: AssistantText,
  data: { by_name: { tool: () => null, approval: ApprovalCard, jurisprudence: JurisprudenceList, citations: CitationsList, "web-sources": WebSources } },
};

/** The plan of this message, with the running step while it is the turn in progress. */
function useTurnPlan() {
  const content = useAuiState((state) => state.message.content);
  const running = useAuiState((state) => state.message.isLast && state.thread.isRunning);
  const working = useContext(WorkingContext);
  const decisions = useContext(ApprovalDecisionsContext)?.decisions;
  const parts = useMemo<PlanPart[]>(() => content.flatMap((part) => part.type === "data" ? [{ name: part.name, data: part.data }] : []), [content]);
  const label = running ? working || THINKING : null;
  const plan = buildPlan(parts, { running: label, decisions });
  return { parts, plan, label, card: showsPlan(plan) };
}

/** What the turn did, above the answer: one plan card when it took several steps, a quiet line per step otherwise. */
function TurnSteps() {
  const { plan, card } = useTurnPlan();
  if (card) return <PlanCard plan={plan} />;
  const finished = plan.steps.filter((step) => step.state !== "running");
  if (!finished.length) return null;
  return <div aria-label="Atividade do Lume" className="flex flex-col gap-1.5">{finished.map((step) => <ToolLine key={step.id} step={step} />)}</div>;
}

/** The line under the answer while the turn runs, unless the plan card already shows the running step. */
function WorkingLine() {
  const { label, card } = useTurnPlan();
  return label && !card ? <SmartWorking className="text-sm">{label}</SmartWorking> : null;
}

const actionButton = "grid size-7 place-items-center rounded-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:size-11";

export function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="group flex flex-col">
      <div className="flex flex-col gap-3 text-[15px] leading-[1.6] text-foreground max-md:text-[15.5px]">
        <TurnSteps />
        <MessagePrimitive.Parts components={assistantParts} />
        <WorkingLine />
        <MessagePrimitive.Error>
          <p className="text-sm text-destructive" role="alert">Não foi possível concluir a resposta. Tente novamente.</p>
        </MessagePrimitive.Error>
      </div>
      <ActionBarPrimitive.Root className="-ml-1.5 mt-1 flex min-h-7 items-center gap-0.5 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
        <ActionBarPrimitive.Copy className={actionButton} aria-label="Copiar resposta"><Copy className="size-3.5" /></ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload className={actionButton} aria-label="Gerar novamente"><RefreshCw className="size-3.5" /></ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}
