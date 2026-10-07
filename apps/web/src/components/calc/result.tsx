'use client';

import { Download } from 'lucide-react';
import { CanvasSection } from '@/components/canvas/canvas-page';
import { money, dateLabel } from '@/components/honorarios/editor';
import type { CalculationResult, SavedCalculation } from '@/lib/calc/contracts';

const columns = ['Parcela / rubrica', 'Data', 'Principal', 'Correção', 'Juros', 'Multa', 'Pagamento', 'Saldo / valor'];
const exportLink = 'inline-flex h-11 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:h-8 [&_svg]:size-3.5';

/** The result of a calculation: the total on a raised tile, the exports, and the full memory as a table. */
export function CalcResult({ result, saved }: { result: CalculationResult; saved?: SavedCalculation }) {
  return <section className="flex min-w-0 flex-col gap-6" aria-label="Resultado do cálculo">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-60 flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3.5">
        <h3 className="text-[12.5px] text-muted-foreground">Resultado</h3>
        <p className="font-mono text-[26px] leading-[1.35] tracking-[-0.01em]" data-testid="calc-total">{money(result.totalCents)}</p>
      </div>
      {saved ? <div className="-mr-2 flex flex-wrap gap-1">
        <a className={exportLink} href={`/api/calc/${saved.id}/export?version=${saved.version}&format=pdf`}><Download aria-hidden="true" />Baixar memória PDF</a>
        <a className={exportLink} href={`/api/calc/${saved.id}/export?version=${saved.version}&format=csv`}><Download aria-hidden="true" />Baixar planilha CSV</a>
        <a className={exportLink} href={`/api/calc/${saved.id}/export?version=${saved.version}&format=json`}><Download aria-hidden="true" />Baixar dados completos</a>
      </div> : <p className="text-xs text-muted-foreground">Salve uma versão para exportar.</p>}
    </div>
    <CanvasSection title="Memória de cálculo">
      <div className="-mx-4 max-w-[100vw] overflow-x-auto px-4 md:mx-0 md:px-0" tabIndex={0} role="region" aria-label="Memória de cálculo, role para ver todas as colunas">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-border text-xs text-muted-foreground"><tr>{columns.map(label => <th key={label} className="px-3 pb-2 font-medium whitespace-nowrap first:pl-0">{label}</th>)}</tr></thead>
          <tbody>{result.rows.map((row, index) => <tr key={index}>
            <td className="min-w-60 py-2.5 pr-3"><p>{row.label}</p><p className="mt-0.5 text-xs text-muted-foreground">{row.formula}</p></td>
            <td className="px-3 py-2.5 font-mono text-[12.5px] whitespace-nowrap">{row.date ? dateLabel(row.date) : '—'}</td>
            {[row.principalCents, row.correctionCents, row.interestCents, row.penaltyCents, row.paidCents, row.totalCents].map((value, i) => <td className="px-3 py-2.5 text-right font-mono text-[12.5px] whitespace-nowrap" key={i}>{money(value)}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </CanvasSection>
    {result.notes.length > 0 && <ul className="flex flex-col gap-2 text-[13.5px] text-muted-foreground">{result.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
    {result.observations.length > 0 && <details className="text-[13px]"><summary className="cursor-pointer text-muted-foreground hover:text-foreground">Índices utilizados ({result.observations.length})</summary>
      <div className="mt-3 grid gap-1.5 font-mono text-xs">{result.observations.map(item => <p key={`${item.series}:${item.month}`}>{item.series.toUpperCase()} · {item.month} · {item.value}% · consulta em {new Date(item.fetchedAt).toLocaleDateString('pt-BR')}</p>)}</div></details>}
    <div className="grid gap-1.5 text-xs text-muted-foreground">{result.sources.map((source, i) => <a key={`${source}:${i}`} href={source} target="_blank" rel="noreferrer" className="break-all underline decoration-border-strong underline-offset-4 hover:text-foreground">Fonte {i + 1}: {source}</a>)}<p>Método {result.engineVersion}. Valores em reais; memória preservada por versão.</p></div>
  </section>;
}
