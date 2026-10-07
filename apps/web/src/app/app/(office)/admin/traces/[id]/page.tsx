import { notFound } from "next/navigation";
import { CircleAlert, ExternalLink } from "lucide-react";
import { requirePlatformPage } from "@/lib/platform";
import { agentTraceDetail, sentryTraceUrl } from "@/lib/agent-traces";
import { formatMs, prettyEventData, traceEventLabels, traceStatusLabels } from "@/lib/agent-trace-format";
import { elapsed } from "@/components/admin/admin-format";
import { Pill } from "@/components/canvas/canvas-controls";
import { Button } from "@/components/ui/button";
import { AdminBlock, AdminBlockHead, AdminDetailHead, AdminFact, AdminFacts, AdminGrid, AdminNote, adminButton } from "@/components/admin/admin-blocks";
import { cn } from "@/lib/utils";

export const metadata = { title: "Execução · Administração" };

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" });

/** One chat turn event by event: what the model did, which tools ran with which inputs, and what came back. */
export default async function PlatformTracePage({ params }: PageProps<"/app/admin/traces/[id]">) {
  const context = await requirePlatformPage();
  if (!context) notFound();
  const detail = await agentTraceDetail(context.db, (await params).id);
  if (!detail) notFound();
  const { trace, events } = detail;
  const title = `Execução de ${dateFormat.format(new Date(trace.startedAt))}`;
  return <>
    <AdminDetailHead back={{ href: "/app/admin/traces", label: "Voltar para execuções" }} title={title}
      sub={`${trace.officeName} · ${trace.userEmail}`}
      actions={trace.sentryTraceId && (
        <Button asChild variant="outline" className={adminButton}>
          <a href={sentryTraceUrl(trace.sentryTraceId)} target="_blank" rel="noreferrer">Abrir no Sentry<ExternalLink aria-hidden="true" /></a>
        </Button>
      )} />
    <AdminGrid>
      <AdminBlock card label="Resumo da execução">
        <AdminFacts>
          <AdminFact label="Resultado"><Pill tone={trace.status === "failed" ? "accent" : "muted"}>{traceStatusLabels[trace.status] ?? trace.status}</Pill></AdminFact>
          <AdminFact label="Modelo" mono>{trace.provider} · {trace.modelId}</AdminFact>
          <AdminFact label="Duração" mono>{elapsed(trace.startedAt, trace.finishedAt)}</AdminFact>
          <AdminFact label="Etapas" mono>{trace.steps}</AdminFact>
          <AdminFact label="Ferramentas" mono>{trace.toolCalls}</AdminFact>
          <AdminFact label="Tokens" mono>{trace.inputTokens === null ? "—"
            : `${trace.inputTokens.toLocaleString("pt-BR")} entrada · ${(trace.outputTokens ?? 0).toLocaleString("pt-BR")} saída`}</AdminFact>
        </AdminFacts>
        {trace.error && <p role="status" className="flex items-start gap-2 text-[13.5px] text-destructive"><CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{trace.error}</p>}
      </AdminBlock>
      <AdminBlock labelledBy="trace-timeline">
        <AdminBlockHead id="trace-timeline" level={3} title="Linha do tempo" sub="Abra um evento para ver os dados que o modelo e as ferramentas trocaram." />
        <AdminNote>Estes registros guardam conteúdo de clientes. Abra só o necessário para investigar.</AdminNote>
        {events.length === 0 ? <p className="text-[13.5px] text-muted-foreground">Nenhum evento registrado.</p> : (
          <ol className="flex flex-col gap-0.5 border-t border-border pt-1">
            {events.map(event => (
              <li key={event.seq}>
                <details className="group rounded-md open:bg-muted/60">
                  <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-0.5 rounded-md px-3 py-2 outline-offset-[-2px] outline-ring transition-colors hover:bg-accent focus-visible:outline-2 md:min-h-[46px] [&::-webkit-details-marker]:hidden">
                    <span className="w-16 shrink-0 font-mono text-[12.5px] text-muted-foreground">+{formatMs(event.atMs)}</span>
                    <span className={cn("text-[13.5px]", event.kind === "error" && "text-destructive")}>{traceEventLabels[event.kind] ?? event.kind}</span>
                    {event.name && <span className="min-w-0 truncate font-mono text-[12.5px]">{event.name}</span>}
                    {event.durationMs !== null && <span className="ml-auto font-mono text-[12.5px] text-muted-foreground">{formatMs(event.durationMs)}</span>}
                  </summary>
                  <pre className="mx-3 mb-3 max-h-96 overflow-auto rounded-md border border-border bg-card p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">{prettyEventData(event.data)}</pre>
                </details>
              </li>
            ))}
          </ol>
        )}
      </AdminBlock>
    </AdminGrid>
  </>;
}
