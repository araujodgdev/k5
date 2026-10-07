import { notFound } from "next/navigation";
import { requirePlatformPage } from "@/lib/platform";
import { listAgentTraces } from "@/lib/agent-traces";
import { traceStatusLabels } from "@/lib/agent-trace-format";
import { elapsed } from "@/components/admin/admin-format";
import { DataTable, Pill } from "@/components/canvas/canvas-controls";
import { AdminBar, AdminBlock, AdminGrid, AdminNote } from "@/components/admin/admin-blocks";
import { AdminFilterChip } from "@/components/admin/admin-filters";

export const metadata = { title: "Execuções · Administração" };

const zone = "America/Sao_Paulo";
const dayFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: zone });
const timeFormat = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: zone });
const fullFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: zone });
const filters = [["", "Todas"], ["failed", "Com falha"], ["halted", "Interrompidas"], ["running", "Em andamento"]] as const;

/** Today's turns show the time they started; older ones, the day. */
function started(value: string, today: string) {
  const date = new Date(value);
  return <time dateTime={date.toISOString()} title={fullFormat.format(date)}>{dayFormat.format(date) === today ? timeFormat.format(date) : dayFormat.format(date)}</time>;
}

/** The Lume's recent chat turns, newest first, to open one and follow what the agent did. */
export default async function PlatformTracesPage({ searchParams }: PageProps<"/app/admin/traces">) {
  const context = await requirePlatformPage();
  if (!context) notFound();
  const raw = (await searchParams).status;
  const status = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  const traces = await listAgentTraces(context.db, { status });
  const today = dayFormat.format(new Date());
  return <>
    <AdminGrid>
      <AdminBlock label="Execuções do Lume">
        <AdminNote>Estes registros guardam conteúdo de clientes. Abra só o necessário para investigar.</AdminNote>
        <AdminBar label="Filtrar execuções">
          {filters.map(([value, label]) => (
            <AdminFilterChip key={value} pressed={status === value} href={value ? `/app/admin/traces?status=${value}` : "/app/admin/traces"}>{label}</AdminFilterChip>
          ))}
        </AdminBar>
        <DataTable label="Execuções recentes do Lume" tall rows={traces} rowKey={trace => trace.id} rowHref={trace => `/app/admin/traces/${trace.id}`}
          empty={`Nenhuma execução registrada${status ? " com este filtro" : ""}.`} columns={[
            { header: "Início", width: "52px", mono: true, cell: trace => started(trace.startedAt, today) },
            { header: "Escritório", width: "minmax(0, 1fr)", strong: true, cell: trace => trace.officeName, sub: trace => trace.userEmail },
            { header: "Modelo", width: "108px", mono: true, cell: trace => trace.modelId },
            { header: "Resultado", width: "196px", cell: trace => <Pill tone={trace.status === "failed" ? "accent" : "muted"}>{traceStatusLabels[trace.status] ?? trace.status}</Pill>,
              sub: trace => trace.error ?? undefined },
            { header: "Etapas", width: "52px", align: "end", mono: true, phone: false, cell: trace => trace.steps },
            { header: "Ferramentas", width: "84px", align: "end", mono: true, phone: false, cell: trace => trace.toolCalls },
            { header: "Duração", width: "64px", align: "end", mono: true, cell: trace => elapsed(trace.startedAt, trace.finishedAt) },
          ]} />
      </AdminBlock>
    </AdminGrid>
  </>;
}
