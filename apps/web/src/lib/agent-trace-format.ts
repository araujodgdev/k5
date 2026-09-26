export const traceStatusLabels: Record<string, string> = {
  running: "Em andamento", completed: "Concluída", halted: "Interrompida", failed: "Falhou", cancelled: "Parada pela pessoa",
};

export const traceEventLabels: Record<string, string> = {
  step: "Etapa do modelo", "tool-call": "Chamada de ferramenta", "tool-result": "Resultado de ferramenta", source: "Fonte da busca",
  approval: "Aguardando confirmação", citations: "Revisão de citações", halt: "Interrupção", error: "Erro",
};

export function traceDuration(startedAt: string | Date, finishedAt: string | Date | null) {
  if (!finishedAt) return "—";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  return formatMs(ms);
}

export function formatMs(ms: number) {
  return ms < 1000 ? `${Math.max(0, Math.round(ms))} ms` : `${(ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`;
}

/** Event data is stored as JSON text; shown indented, or as is when it does not parse. */
export function prettyEventData(data: string) {
  try { return JSON.stringify(JSON.parse(data), null, 2); } catch { return data; }
}
