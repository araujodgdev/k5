import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformPage } from "@/lib/platform";
import { listAgentTraces } from "@/lib/agent-traces";
import { traceStatusLabels, traceDuration } from "@/lib/agent-trace-format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Execuções · Administração" };

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" });
const filters = [["", "Todas"], ["failed", "Com falha"], ["halted", "Interrompidas"], ["running", "Em andamento"]] as const;

/** The Lume's recent chat turns, newest first, to open one and follow what the agent did. */
export default async function PlatformTracesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const context = await requirePlatformPage();
  if (!context) notFound();
  const { status = "" } = await searchParams;
  const traces = await listAgentTraces(context.db, { status });
  return (
    <section>
      <p className="max-w-3xl text-sm text-muted-foreground">Cada resposta do Lume nos últimos 30 dias: etapas do modelo, ferramentas, buscas e erros. Os registros trazem conteúdo de clientes; use-os só para depurar.</p>
      <nav aria-label="Filtrar execuções" className="mt-5 flex flex-wrap gap-1">
        {filters.map(([value, label]) => (
          <Link key={value} href={value ? `/app/admin/traces?status=${value}` : "/app/admin/traces"} aria-current={status === value ? "page" : undefined}
            className={cn("inline-flex min-h-11 items-center border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9",
              status === value ? "border-foreground text-foreground" : "border-line text-muted-foreground hover:text-foreground")}>{label}</Link>
        ))}
      </nav>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Execuções recentes do Lume</caption>
          <thead className="border-b text-[13px] text-muted-foreground"><tr>
            <th className="py-3 pr-4 font-normal">Início</th><th className="px-4 py-3 font-normal">Escritório</th>
            <th className="hidden px-4 py-3 font-normal md:table-cell">Modelo</th><th className="px-4 py-3 font-normal">Resultado</th>
            <th className="hidden px-4 py-3 text-right font-normal sm:table-cell">Etapas</th><th className="hidden px-4 py-3 text-right font-normal sm:table-cell">Ferramentas</th>
            <th className="py-3 pl-4 text-right font-normal">Duração</th>
          </tr></thead>
          <tbody>{traces.map(trace => (
            <tr key={trace.id} className="border-b last:border-0">
              <td className="py-3 pr-4 whitespace-nowrap"><Link href={`/app/admin/traces/${trace.id}`} className="underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">{dateFormat.format(new Date(trace.startedAt))}</Link></td>
              <td className="px-4 py-3">{trace.officeName}<span className="block text-[13px] text-muted-foreground">{trace.userEmail}</span></td>
              <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{trace.modelId}</td>
              <td className={cn("px-4 py-3", trace.status === "failed" && "text-destructive")}>{traceStatusLabels[trace.status] ?? trace.status}</td>
              <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">{trace.steps}</td>
              <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">{trace.toolCalls}</td>
              <td className="py-3 pl-4 text-right tabular-nums text-muted-foreground">{traceDuration(trace.startedAt, trace.finishedAt)}</td>
            </tr>
          ))}</tbody>
        </table>
        {traces.length === 0 && <p className="py-12 text-subtle-foreground">Nenhuma execução registrada{status ? " com este filtro" : ""}.</p>}
      </div>
    </section>
  );
}
