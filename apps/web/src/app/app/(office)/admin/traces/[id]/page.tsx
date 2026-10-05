import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformPage } from "@/lib/platform";
import { agentTraceDetail, sentryTraceUrl } from "@/lib/agent-traces";
import { formatMs, prettyEventData, traceDuration, traceEventLabels, traceStatusLabels } from "@/lib/agent-trace-format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Execução · Administração" };

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" });

/** One chat turn event by event: what the model did, which tools ran with which inputs, and what came back. */
export default async function PlatformTracePage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePlatformPage();
  if (!context) notFound();
  const detail = await agentTraceDetail(context.db, (await params).id);
  if (!detail) notFound();
  const { trace, events } = detail;
  const facts: Array<[string, string]> = [
    ["Escritório", trace.officeName], ["Pessoa", trace.userEmail], ["Modelo", `${trace.provider} · ${trace.modelId}`],
    ["Resultado", traceStatusLabels[trace.status] ?? trace.status], ["Duração", traceDuration(trace.startedAt, trace.finishedAt)],
    ["Etapas", String(trace.steps)], ["Ferramentas", String(trace.toolCalls)],
    ["Tokens", trace.inputTokens === null ? "—" : `${trace.inputTokens.toLocaleString("pt-BR")} entrada · ${(trace.outputTokens ?? 0).toLocaleString("pt-BR")} saída`],
  ];
  return (
    <section>
      <Link href="/app/admin/traces" className="inline-flex min-h-11 items-center text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:min-h-0">← Execuções</Link>
      <header className="mt-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-2xl">Execução de {dateFormat.format(new Date(trace.startedAt))}</h2>
        {trace.sentryTraceId && <a href={sentryTraceUrl(trace.sentryTraceId)} target="_blank" rel="noreferrer"
          className="inline-flex min-h-11 items-center text-sm underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0">Abrir trace no Sentry</a>}
      </header>
      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-y py-5 text-sm md:grid-cols-4">
        {facts.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-[13px] text-muted-foreground">{label}</dt><dd className="mt-0.5 break-words">{value}</dd></div>)}
      </dl>
      {trace.error && <p className="mt-4 text-sm text-destructive" role="status">Erro: {trace.error}</p>}
      <h3 className="mt-8 mb-2 font-medium">Linha do tempo</h3>
      {events.length === 0 ? <p className="py-8 text-subtle-foreground">Nenhum evento registrado.</p> : (
        <ol className="divide-y border-y">
          {events.map(event => (
            <li key={event.seq} className="py-3">
              <details className="group">
                <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0">
                  <span className="w-16 shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">+{formatMs(event.atMs)}</span>
                  <span className={cn("text-sm", event.kind === "error" && "text-destructive")}>{traceEventLabels[event.kind] ?? event.kind}</span>
                  {event.name && <span className="font-mono text-[13px]">{event.name}</span>}
                  {event.durationMs !== null && <span className="ml-auto text-[13px] tabular-nums text-muted-foreground">{formatMs(event.durationMs)}</span>}
                </summary>
                <pre className="mt-2 max-h-96 overflow-auto bg-muted p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words">{prettyEventData(event.data)}</pre>
              </details>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
