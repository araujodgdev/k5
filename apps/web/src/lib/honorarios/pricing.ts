import { z } from 'zod';
import { D, cents } from '@/lib/calc/math';
import { oabCatalog, oabReference } from './catalog';

const money = z.number().int().min(0).max(99_999_999_999);
const percentage = z.string().regex(/^\d{1,3}(\.\d{1,4})?$/).refine(value => Number(value) <= 100);
const component = { label: z.string().trim().min(2).max(180), due: z.enum(['contract', 'success']), condition: z.string().max(2000) };
export const feeComponent = z.discriminatedUnion('kind', [
  z.object({ ...component, kind: z.literal('fixed'), amountCents: money.positive() }),
  z.object({ ...component, kind: z.literal('hours'), rateCents: money.positive(), quantity: z.string().regex(/^\d{1,5}(\.\d{1,2})?$/).refine(value => Number(value) > 0) }),
  z.object({ ...component, kind: z.literal('percentage'), baseCents: money.positive(), percent: percentage }),
  z.object({ ...component, kind: z.literal('monthly'), amountCents: money.positive(), months: z.number().int().min(1).max(120) }),
]);
export const feeTerms = z.object({
  uf: z.enum(['PE', 'RS']), referenceId: z.string().nullable(), serviceOn: z.iso.date(), scope: z.string().trim().min(5).max(4000), paymentTerms: z.string().trim().min(5).max(4000), justification: z.string().max(2000).default(''),
  components: z.array(feeComponent).min(1).max(20),
  allocations: z.array(z.object({ name: z.string().trim().min(2).max(180), percent: percentage })).max(20).default([]),
  calculation: z.object({ id: z.string().uuid(), version: z.number().int().positive() }).nullable().default(null),
}).superRefine((value, ctx) => {
  if (value.components.some(item => item.due === 'success' && item.condition.trim().length < 5)) ctx.addIssue({ code: 'custom', message: 'Descreva o evento que torna o êxito exigível.' });
  if (value.allocations.length && value.allocations.reduce((sum, item) => sum.plus(item.percent), new D(0)).gt(100)) ctx.addIssue({ code: 'custom', message: 'O rateio não pode exceder 100%.' });
});
export type FeeTerms = z.infer<typeof feeTerms>;
export const feePricing = z.object({ terms: feeTerms, reference: oabReference.nullable(), components: z.array(z.object({ label: z.string(), due: z.enum(['contract', 'success']), totalCents: money, formula: z.string() })), contractedCents: money, contingentCents: money, totalCents: money, warnings: z.array(z.string()), method: z.literal('2026.10.1') });
export type FeePricing = z.infer<typeof feePricing>;
export function priceFees(raw: FeeTerms): FeePricing {
  const terms = feeTerms.parse(raw);
  const reference = terms.referenceId ? oabCatalog.find(item => item.id === terms.referenceId && item.uf === terms.uf) : null;
  if (terms.referenceId && !reference) throw new Error('Referência da OAB não encontrada para a UF.');
  const components = terms.components.map(item => {
    switch (item.kind) {
      case 'fixed': return { label: item.label, due: item.due, totalCents: item.amountCents, formula: 'Valor fixo informado' };
      case 'monthly': return { label: item.label, due: item.due, totalCents: cents(new D(item.amountCents).times(item.months)), formula: `${item.months} mensalidades × R$ ${(item.amountCents / 100).toFixed(2).replace('.', ',')}` };
      case 'hours': return { label: item.label, due: item.due, totalCents: cents(new D(item.rateCents).times(item.quantity)), formula: `${item.quantity.replace('.', ',')} horas × R$ ${(item.rateCents / 100).toFixed(2).replace('.', ',')}` };
      case 'percentage': return { label: item.label, due: item.due, totalCents: cents(new D(item.baseCents).times(item.percent).div(100)), formula: `${item.percent.replace('.', ',')}% × R$ ${(item.baseCents / 100).toFixed(2).replace('.', ',')}` };
      default: { const exhaustive: never = item; return exhaustive; }
    }
  });
  const contractedCents = components.filter(item => item.due === 'contract').reduce((sum, item) => sum + item.totalCents, 0);
  const contingentCents = components.filter(item => item.due === 'success').reduce((sum, item) => sum + item.totalCents, 0);
  const warnings = ['Referência da edição 2026. O início exato da vigência não foi confirmado; confira o ato aplicável ao serviço. O catálogo é uma seleção de 30 atividades, não a tabela integral.'];
  if (reference && contractedCents + contingentCents < reference.fixedCents) warnings.push('O total estimado está abaixo da referência monetária publicada. Confira a regra e registre a justificativa; isso não certifica conformidade ética.');
  if (reference?.percent) warnings.push(`A tabela também publica ${reference.percent}. ${reference.rule}`);
  if (contingentCents) warnings.push('Êxito é estimativa, sem parcelas a receber até a confirmação do evento e da base efetiva. Confira quota litis e sucumbência separadamente.');
  return feePricing.parse({ terms, reference: reference ?? null, components, contractedCents, contingentCents, totalCents: contractedCents + contingentCents, warnings, method: '2026.10.1' });
}
export const saveFeeQuoteInput = z.object({ id: z.string().uuid().optional(), expectedVersion: z.number().int().nonnegative(), title: z.string().trim().min(3).max(180), clientId: z.string().min(1).max(64), caseId: z.string().max(64).nullable().default(null), terms: feeTerms, idempotencyKey: z.string().uuid() });
export const getFeeQuoteInput = z.object({ id: z.string().uuid(), version: z.number().int().positive().optional() });
export const feeQuoteDto = z.object({ id: z.string(), title: z.string(), clientId: z.string(), caseId: z.string().nullable(), version: z.number().int(), latestVersion: z.number().int(), pricing: feePricing, createdAt: z.string(), billed: z.array(z.object({ component: z.number().int(), agreementId: z.string(), amountCents: money, evidence: z.string() })) });
export type FeeQuote = z.infer<typeof feeQuoteDto>;
export const feeQuoteListDto = z.object({ items: z.array(feeQuoteDto) });
export const billFeeQuoteInput = z.object({ id: z.string().uuid(), version: z.number().int().positive(), component: z.number().int().min(0).max(19), firstDueOn: z.iso.date(), count: z.number().int().min(1).max(120), realizedBaseCents: money.optional(), evidence: z.string().trim().min(5).max(2000), idempotencyKey: z.string().uuid() });
