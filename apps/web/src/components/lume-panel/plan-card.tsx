"use client";

import { useContext } from "react";
import Link from "next/link";
import { ArrowUpRight, CircleAlert, CircleCheck, CircleMinus, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { DocumentLinksContext, documentIdFrom } from "./chat-context";
import { MODULE_ICONS } from "./icons";
import { MODULE_LABELS, planSummary, type Plan, type PlanStep, type StepState } from "./plan";

const STATE_ICON: Record<StepState, typeof CircleCheck> = {
  done: CircleCheck, running: LoaderCircle, needs: CircleAlert, failed: CircleAlert, cancelled: CircleMinus,
};
const STATE_LABEL: Record<StepState, string> = {
  done: "Concluída", running: "Em andamento", needs: "Precisa de você", failed: "Não concluída", cancelled: "Cancelada",
};
const STATE_TONE: Record<StepState, string> = {
  done: "text-foreground", running: "text-brand-ink", needs: "text-brand-ink", failed: "text-destructive", cancelled: "text-subtle-foreground",
};

/** "Abrir": a document opens in the canvas (or beside the chat), a download downloads, a page navigates. */
export function OpenStep({ href, title, className }: { href: string; title: string; className?: string }) {
  const documents = useContext(DocumentLinksContext);
  const documentId = documentIdFrom(href);
  const look = cn("inline-flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 text-[12.5px] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:h-11", className);
  const icon = <ArrowUpRight className="size-3.5" aria-hidden="true" />;
  if (href.startsWith("/api/")) return <a href={href} download className={look} aria-label={`Baixar: ${title}`}>Baixar{icon}</a>;
  if (documentId && documents) return <button type="button" className={look} aria-label={`Abrir: ${title}`} onClick={() => documents.open(documentId, title)}>Abrir{icon}</button>;
  return <Link href={href} className={look} aria-label={`Abrir: ${title}`}>Abrir{icon}</Link>;
}

function StepIcon({ state, className }: { state: StepState; className?: string }) {
  const Icon = STATE_ICON[state];
  return <span className={cn("flex pt-px", STATE_TONE[state], className)}>
    <Icon className={cn("size-4", state === "running" && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
    <span className="sr-only">{STATE_LABEL[state]}: </span>
  </span>;
}

function StepRow({ step }: { step: PlanStep }) {
  const ModuleIcon = step.module ? MODULE_ICONS[step.module] : null;
  const reached = step.state !== "cancelled";
  return (
    <li className="flex items-start gap-2.5 rounded-md p-2">
      <StepIcon state={step.state} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {step.module && ModuleIcon && <span className="flex items-center gap-[5px] text-xs font-medium text-muted-foreground max-md:hidden">
          <ModuleIcon className="size-3" aria-hidden="true" />{MODULE_LABELS[step.module]}
        </span>}
        <span className={cn("text-[13.5px] leading-[1.4] break-words max-md:text-sm", reached ? "text-foreground" : "text-muted-foreground")}>{step.title}</span>
        {/* A phone reads the module and the detail on one line under the title. */}
        {(step.detail || step.module) && <span className={cn("line-clamp-2 text-[12.5px] leading-[1.45] break-words text-muted-foreground", !step.detail && "md:hidden")}>
          {step.module && <span className="font-medium md:hidden">{MODULE_LABELS[step.module]}{step.detail && " · "}</span>}{step.detail}
        </span>}
      </span>
      {step.href && <OpenStep href={step.href} title={step.title} />}
    </li>
  );
}

/** The turn's steps in one card, updated in place: done, running, waiting for the person. */
export function PlanCard({ plan }: { plan: Plan }) {
  return (
    <section aria-label="Plano do Lume" className="overflow-hidden rounded-lg border border-border bg-card max-md:rounded-[14px]">
      <header className="flex flex-wrap items-center gap-x-2 border-b border-border px-3.5 py-2.5 text-[13px] max-md:sr-only">
        <h3 className="font-semibold">Plano do Lume</h3>
        <span className="text-muted-foreground" aria-live="polite">{planSummary(plan)}</span>
      </header>
      <ol className="flex flex-col p-1.5 max-md:p-1">{plan.steps.map((step) => <StepRow key={step.id} step={step} />)}</ol>
    </section>
  );
}

/** A turn with a single step shows it as one quiet line instead of a card. */
export function ToolLine({ step }: { step: PlanStep }) {
  const ModuleIcon = step.module ? MODULE_ICONS[step.module] : null;
  const failed = step.state === "failed";
  return (
    <p className={cn("flex items-center gap-2 text-[13px] leading-5", failed ? "text-destructive" : "text-muted-foreground")}>
      {failed ? <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
        : ModuleIcon ? <ModuleIcon className="size-3.5 shrink-0" aria-hidden="true" /> : <CircleCheck className="size-3.5 shrink-0" aria-hidden="true" />}
      <span className="min-w-0 flex-1 break-words">{step.title}{step.detail && <span className="text-subtle-foreground">: {step.detail}</span>}</span>
      {step.href && <OpenStep href={step.href} title={step.title} className="-my-1" />}
    </p>
  );
}
