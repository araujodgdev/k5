import { z } from 'zod';

export const trademarkCountries = [
  { code: 'BR', name: 'Brasil' }, { code: 'AR', name: 'Argentina' }, { code: 'CL', name: 'Chile' },
  { code: 'CO', name: 'Colômbia' }, { code: 'MX', name: 'México' }, { code: 'US', name: 'Estados Unidos' },
  { code: 'CA', name: 'Canadá' }, { code: 'PT', name: 'Portugal' }, { code: 'ES', name: 'Espanha' },
  { code: 'FR', name: 'França' }, { code: 'DE', name: 'Alemanha' }, { code: 'GB', name: 'Reino Unido' },
  { code: 'CN', name: 'China' }, { code: 'JP', name: 'Japão' }, { code: 'AU', name: 'Austrália' },
] as const;
export const trademarkSituation = z.enum(['all', 'active', 'pending', 'ended']);
export const trademarkQuery = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('name'), name: z.string().trim().min(2).max(200), strategy: z.enum(['contains', 'exact', 'fuzzy', 'phonetic']).default('contains') }),
  z.object({ kind: z.literal('logo'), uploadId: z.uuid(), strategy: z.literal('concept').default('concept') }),
]);
export const trademarkSearchInput = z.object({
  query: trademarkQuery,
  country: z.string().regex(/^[A-Z]{2}$/).refine(code => trademarkCountries.some(country => country.code === code)).default('BR'),
  situation: trademarkSituation.default('all'),
  niceClass: z.number().int().min(1).max(45).nullable().default(null),
  idempotencyKey: z.string().min(8).max(128).optional(),
});
export type TrademarkSearchInput = z.infer<typeof trademarkSearchInput>;
export const trademarkRunStates = z.enum(['queued', 'running', 'completed', 'partial', 'blocked', 'failed', 'cancelled']);
export const trademarkSource = z.object({
  provider: z.literal('wipo'), url: z.url(), originUrl: z.url().nullable(), capturedAt: z.string(),
});
export const trademarkSummary = z.object({
  id: z.uuid(), nativeId: z.string(), name: z.string(), representationUrl: z.string().nullable(),
  owner: z.string().nullable(), office: z.string().nullable(), situation: z.string().nullable(),
  territory: z.string().nullable().default(null), recordType: z.string().nullable().default(null),
  niceClasses: z.array(z.number().int().min(1).max(45)), applicationNumber: z.string().nullable(),
  source: trademarkSource, detailState: z.enum(['pending', 'ready', 'failed', 'blocked']),
});
export type TrademarkSummary = z.infer<typeof trademarkSummary>;
export const trademarkDetail = trademarkSummary.extend({
  searchId: z.uuid(), fields: z.array(z.object({ label: z.string(), value: z.string() })),
  version: z.string(), detailError: z.string().nullable(),
});
export type TrademarkDetail = z.infer<typeof trademarkDetail>;
export const trademarkSearchView = z.object({
  id: z.uuid(), input: trademarkSearchInput.omit({ idempotencyKey: true }), title: z.string(),
  state: trademarkRunStates, step: z.string(), error: z.string().nullable(), createdAt: z.string(),
  results: z.array(trademarkSummary), totalReported: z.number().int().nonnegative().nullable(),
  pagesLoaded: z.number().int().nonnegative(), hasMore: z.boolean(), sourceUrl: z.url().nullable(),
});
export type TrademarkSearchView = z.infer<typeof trademarkSearchView>;
export const trademarkHistoryItem = trademarkSearchView.omit({ results: true }).extend({ resultCount: z.number() });
export type TrademarkHistoryItem = z.infer<typeof trademarkHistoryItem>;
export const trademarkUpload = z.object({ id: z.uuid(), name: z.string(), mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']) });
export type TrademarkUpload = z.infer<typeof trademarkUpload>;

export class TrademarkError extends Error {
  constructor(public readonly code: 'invalid_input' | 'not_found' | 'forbidden' | 'unavailable' | 'blocked' | 'budget_exceeded', message: string) { super(message); }
}

export const trademarkLabels: Record<z.infer<typeof trademarkSituation>, string> = {
  all: 'Todos os status', active: 'Registros ativos', pending: 'Pedidos em andamento', ended: 'Marcas encerradas',
};
export const activeTrademarkRun = (state: z.infer<typeof trademarkRunStates>) => state === 'queued' || state === 'running';

export function wipoRecordUrl(nativeId: string): string {
  if (!/^[A-Z0-9_-]{3,100}$/i.test(nativeId)) throw new TrademarkError('invalid_input', 'Identificador da marca inválido.');
  return `https://branddb.wipo.int/en/advancedsearch/brand/${encodeURIComponent(nativeId)}`;
}

export function safeSourceUrl(value: string | null, base = 'https://branddb.wipo.int'): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
