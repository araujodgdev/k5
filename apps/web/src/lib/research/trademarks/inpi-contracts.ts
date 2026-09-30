import { z } from 'zod';

export const viennaCode = z.string().trim().regex(/^\d{1,2}\.\d{1,2}(?:\.\d{1,2})?$/)
  .transform(value => value.split('.').map(Number).join('.'))
  .refine(value => { const [category, division, section] = value.split('.').map(Number); return category >= 1 && category <= 29 && division >= 1 && division <= 99 && (section===undefined || section >= 1 && section <= 99); })
  .pipe(z.string().regex(/^\d{1,2}\.\d{1,2}(?:\.\d{1,2})?$/));
export const normalizeTrademarkName = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
export const inpiProcessNumber = z.string().regex(/^\d{9}$/);
export const inpiDetailUrl = (number: string) => `https://servicos.busca.inpi.gov.br/marcas/${inpiProcessNumber.parse(number)}`;

export const inpiRecord = z.object({
  processNumber: inpiProcessNumber, name: z.string().nullable(), owners: z.array(z.string()).nullable(),
  niceClasses: z.array(z.number().int().min(1).max(45)).nullable(), viennaCodes: z.array(viennaCode).nullable(),
  fields: z.record(z.string(), z.string()),
  events: z.array(z.object({ code: z.string().min(1), description: z.string().min(1), complement: z.string().nullable() })).min(1),
});
export type InpiRecord = z.infer<typeof inpiRecord>;

export function situationGroup(description: string): 'active' | 'pending' | 'ended' | 'unknown' {
  const text = normalizeTrademarkName(description);
  if (/REGISTRO DE MARCA EM VIGOR|CONCESSAO DE REGISTRO|MANTIDA A CONCESSAO/.test(text)) return 'active';
  if (/EXTINCAO DE REGISTRO|REGISTRO(?: DE MARCA)? EXTINTO|REGISTRO(?: DE MARCA)? ANULADO|ARQUIVAMENTO DEFINITIVO|PEDIDO.*ARQUIVADO|INDEFERIMENTO DO PEDIDO|PEDIDO.*INDEFERIDO|PEDIDO INEXISTENTE/.test(text)) return 'ended';
  if (/AGUARDANDO|PUBLICACAO DE PEDIDO.*OPOSICAO|DEFERIMENTO DO PEDIDO|DEFERIMENTO DE DESIGNACAO|EXIGENCIA DE MERITO$|SOBRESTAMENTO DO EXAME|NOTIFICACAO DE RECURSO|NOTIFICACAO DE OPOSICAO/.test(text)) return 'pending';
  return 'unknown';
}
