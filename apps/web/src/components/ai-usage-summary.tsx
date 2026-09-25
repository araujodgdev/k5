import { PROFILE_DEFINITIONS, isAiProfile } from "@/lib/ai-profiles";
import type { AiUsageRow } from "@/lib/ai-usage";

const otherLabels: Record<string, string> = {
  extraction: "Extração (antes das etapas)", drafting: "Minutas (antes das etapas)", "research-web": "Pesquisa na web (antes das etapas)",
  transcription: "Transcrição pelo modelo", "transcription-openai": "Transcrição OpenAI", embedding: "Embeddings",
};
const label = (profile: string) => isAiProfile(profile) ? PROFILE_DEFINITIONS[profile].label : otherLabels[profile] ?? profile;
const tokens = (value: number) => value.toLocaleString("pt-BR");
const seconds = (ms: number | null) => ms === null ? "—" : `${(ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`;

const columns = ["Etapa", "Modelo", "Esforço", "Concluídas", "Falhas", "Escalonadas", "p95", "Entrada", "Em cache", "Saída", "Raciocínio"];

/** Counts and token totals per step, model and effort; no prompt or answer is stored or shown. */
export function AiUsageSummary({ rows, days, failed }: { rows: AiUsageRow[]; days: number; failed?: boolean }) {
  return <section className="mt-8" aria-labelledby="ai-usage-title">
    <h3 id="ai-usage-title" className="font-medium">Uso nos últimos {days} dias</h3>
    <p className="mt-1 text-sm text-muted-foreground">Somente contagens, em todos os escritórios. Raciocínio já está incluído na saída.</p>
    {failed ? <p role="alert" className="mt-4 text-sm text-destructive">Não foi possível ler o uso agora.</p>
      : !rows.length ? <p className="mt-4 text-sm text-subtle-foreground">Nenhuma chamada registrada no período.</p>
        : <div className="mt-4 overflow-x-auto" role="region" aria-labelledby="ai-usage-title" tabIndex={0}>
          <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
            <thead><tr className="border-b text-[13px] text-muted-foreground">{columns.map((column, index) =>
              <th key={column} scope="col" className={`py-2 pr-4 font-normal ${index > 2 ? "text-right" : ""}`}>{column}</th>)}</tr></thead>
            <tbody>{rows.map((row) => <tr key={`${row.profile}:${row.modelId}:${row.reasoningEffort ?? ""}`} className="border-b">
              <th scope="row" className="py-2 pr-4 font-normal">{label(row.profile)}</th>
              <td className="py-2 pr-4">{row.modelId}</td>
              <td className="py-2 pr-4">{row.reasoningEffort ?? "—"}</td>
              {[row.completed, row.failed, row.escalated].map((value, index) => <td key={index} className="py-2 pr-4 text-right tabular-nums">{tokens(value)}</td>)}
              <td className="py-2 pr-4 text-right tabular-nums">{seconds(row.p95Ms)}</td>
              {[row.inputTokens, row.cachedInputTokens, row.outputTokens, row.reasoningTokens].map((value, index) => <td key={index} className="py-2 pr-4 text-right tabular-nums">{tokens(value)}</td>)}
            </tr>)}</tbody>
          </table>
        </div>}
  </section>;
}
