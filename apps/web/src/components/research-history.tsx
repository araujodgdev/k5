import { Scale, Search } from 'lucide-react';
import { CanvasHeader, CanvasPage, CanvasRow } from '@/components/canvas/canvas-page';
import type { SearchHistoryItem } from '@/lib/research/contracts';
import { trademarkCountries, type TrademarkHistoryItem } from '@/lib/research/trademarks/contracts';
import { NewResearchMenu } from './research-new-search';

const zone = 'America/Sao_Paulo';
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayMonth = new Intl.DateTimeFormat('pt-BR', { timeZone: zone, day: '2-digit', month: '2-digit' });
const monthName = new Intl.DateTimeFormat('pt-BR', { timeZone: zone, month: 'long' });
const DAY_MS = 86_400_000;

/** How long ago a search ran, in the board's words: "hoje", "há 2 dias", "setembro". */
function researchWhen(date: Date, now = new Date()) {
  const days = Math.round((Date.parse(dayKey.format(now)) - Date.parse(dayKey.format(date))) / DAY_MS);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days} dias`;
  const year = dayKey.format(date).slice(0, 4);
  return year === dayKey.format(now).slice(0, 4) ? monthName.format(date) : year;
}

/** A search's state in words; a finished one says nothing. */
const states: Record<string, string> = {
  queued: 'na fila', running: 'pesquisando', partial: 'resultados parciais', blocked: 'não concluída', failed: 'não concluída', cancelled: 'cancelada',
};

type Entry = { id: string; kind: 'jurisprudence' | 'trademarks'; title: string; detail: string; date: Date };

function entries(judgments: readonly SearchHistoryItem[], trademarks: readonly TrademarkHistoryItem[]): Entry[] {
  const fromJudgments = judgments.map((item): Entry => ({
    id: item.id, kind: 'jurisprudence', title: item.theme, date: new Date(item.createdAt),
    detail: [item.filters.court || 'Todos os tribunais', states[item.status]].filter(Boolean).join(' · '),
  }));
  const fromTrademarks = trademarks.map((item): Entry => {
    const country = trademarkCountries.find(entry => entry.code === item.input.country)?.name ?? item.input.country;
    const found = item.resultCount === 1 ? '1 registro' : `${item.resultCount} registros`;
    return { id: item.id, kind: 'trademarks', title: item.title, date: new Date(item.createdAt),
      detail: [country, item.resultCount || !states[item.state] ? found : null, states[item.state]].filter(Boolean).join(' · ') };
  });
  return [...fromJudgments, ...fromTrademarks].sort((a, b) => b.date.getTime() - a.date.getTime());
}

/** Pesquisa (`Main.dc.html`, `v.modulo` with `pesquisa`): the person's jurisprudence and trademark searches, newest first. */
export function ResearchHistory({ judgments, trademarks }: { judgments: readonly SearchHistoryItem[]; trademarks: readonly TrademarkHistoryItem[] }) {
  const rows = entries(judgments, trademarks);
  return (
    <CanvasPage className="md:gap-6">
      <CanvasHeader eyebrow="Jurisprudência e marcas" title="Pesquisa" actions={<NewResearchMenu />} />
      {rows.length ? (
        <div role="list" aria-label="Pesquisas recentes" className="flex flex-col gap-0.5">
          {rows.map(row => (
            <div role="listitem" key={`${row.kind}:${row.id}`}>
              <CanvasRow stacked icon={row.kind === 'jurisprudence' ? <Scale /> : <Search />}
                href={`/app/research?mode=${row.kind}&search=${encodeURIComponent(row.id)}`}
                title={row.title} detail={row.detail} meta={dayMonth.format(row.date)} status={researchWhen(row.date)} />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[13.5px] text-muted-foreground">Nenhuma pesquisa ainda. Peça ao Lume ou comece por Nova pesquisa.</p>
      )}
    </CanvasPage>
  );
}
