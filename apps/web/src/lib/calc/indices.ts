import 'server-only';
import { z } from 'zod';
import { database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import { observation, type Observation, type CalculationInput, type Series } from './contracts';
import { requiredObservations } from './engine';
import { nextMonth } from './math';

const codes: Record<Series, number> = { ipca: 433, inpc: 188, selic: 4390, legal: 29543 };
const bcbRows = z.array(z.object({ data: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/), valor: z.string().regex(/^-?\d+(\.\d+)?$/) })).max(1300);

export async function loadObservations(input: CalculationInput): Promise<Observation[]> {
  const required = requiredObservations(input);
  const result: Observation[] = [];
  const currentMonth = new Date().toISOString().slice(0, 7);
  for (const series of [...new Set(required.map(item => item.series))]) {
    const months = required.filter(item => item.series === series).map(item => item.month).sort();
    if (months.some(month => series === 'legal' ? month > currentMonth : month >= currentMonth)) throw new CapabilityError('INVALID', 'O período inclui índices ainda não publicados. Escolha uma data-base com competências disponíveis.');
    const cached = observation.array().parse(await database.prepare('SELECT series,month,value,source,fetched_at AS fetchedAt FROM legal_index_observation WHERE series=? AND month>=? AND month<=?').all(series, months[0], months[months.length - 1]));
    const fresh = cached.filter(item => Date.now() - Date.parse(item.fetchedAt) < 7 * 86_400_000);
    if (months.every(month => fresh.some(item => item.month === month))) { result.push(...fresh.filter(item => months.includes(item.month))); continue; }
    const first = `${months[0]}-01`; const final = `${nextMonth(months[months.length - 1])}-01`;
    const br = (day: string) => day.split('-').reverse().join('/');
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codes[series]}/dados?formato=json&dataInicial=${br(first)}&dataFinal=${br(final)}`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: 'no-store' });
      if (!response.ok) throw new Error('BCB indisponível');
      const body: unknown = await response.json();
      const fetchedAt = new Date().toISOString();
      const values = bcbRows.parse(body).map(item => observation.parse({ series, month: `${item.data.slice(6)}-${item.data.slice(3, 5)}`, value: item.valor, source: `https://www3.bcb.gov.br/sgspub/consultarvalores/consultarValoresSeries.do?method=consultarValores&series=${codes[series]}`, fetchedAt })).filter(item => months.includes(item.month));
      if (!months.every(month => values.filter(item => item.month === month).length === 1)) throw new Error('Série incompleta');
      for (const value of values) await database.prepare(`INSERT INTO legal_index_observation(series,month,value,source,fetched_at) VALUES(?,?,?,?,?) ON CONFLICT(series,month) DO UPDATE SET value=EXCLUDED.value,source=EXCLUDED.source,fetched_at=EXCLUDED.fetched_at`).run(value.series, value.month, value.value, value.source, value.fetchedAt);
      result.push(...values);
    } catch {
      throw new CapabilityError('INVALID', `Não foi possível obter a série ${series.toUpperCase()} completa no Banco Central. Tente novamente. Nenhum índice foi estimado.`);
    }
  }
  return result;
}
