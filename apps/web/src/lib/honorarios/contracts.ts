import { z } from 'zod';

const id = z.string().min(1).max(64);
export const civilDate = z.iso.date();
export const cents = z.number().int().min(0).max(99_999_999_999);
const amount = cents.positive();
const key = z.string().min(8).max(128);
const instant = z.iso.datetime({ offset: true });
export const paymentMethod = z.enum(['pix', 'transfer', 'cash', 'card', 'boleto', 'other']);
const reference = { clientId: id, clientName: z.string(), caseId: id.nullable(), caseName: z.string().nullable(), title: z.string() };
const balances = { totalCents: cents, receivedCents: cents, pendingCents: cents };
export const honorarioAgreementDto = z.object({
  id, ...reference, notes: z.string(), status: z.enum(['active', 'cancelled']), ...balances, canManage: z.boolean(),
  createdAt: instant, cancelledAt: instant.nullable(), cancelReason: z.string().nullable(),
});
export const honorarioInstallmentDto = z.object({
  id, agreementId: id, number: z.number().int().positive(), installmentCount: z.number().int().positive(),
  ...reference, dueOn: civilDate, amountCents: cents, receivedCents: cents, pendingCents: cents,
  status: z.enum(['pending', 'partial', 'received', 'cancelled']), overdue: z.boolean(), canManage: z.boolean(),
});
export const honorarioReceiptDto = z.object({
  id, installmentId: id, amountCents: amount, receivedOn: civilDate, method: paymentMethod,
  notes: z.string(), createdAt: instant, createdByName: z.string(),
  reversal: z.object({ reason: z.string(), createdAt: instant, createdByName: z.string() }).nullable(),
});
export const honorarioDetailDto = z.object({ agreement: honorarioAgreementDto, installments: z.array(honorarioInstallmentDto), receipts: z.array(honorarioReceiptDto) });
const aggregateCents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const honorariosListDto = z.object({ installments: z.array(honorarioInstallmentDto), total: z.number().int().nonnegative(), summary: z.object({ totalCents: aggregateCents, receivedCents: aggregateCents, pendingCents: aggregateCents, overdueCents: aggregateCents }), today: civilDate });
export const honorariosOptionsDto = z.object({ clients: z.array(z.object({ id, name: z.string() })), cases: z.array(z.object({ id, name: z.string() })) });
export const listHonorariosInput = z.object({
  view: z.enum(['pending', 'received', 'cancelled']).default('pending'), query: z.string().trim().max(180).optional(),
  clientId: id.optional(), caseId: id.optional(), dueFrom: civilDate.optional(), dueTo: civilDate.optional(),
  limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(100000).default(0),
}).refine(v => !v.dueFrom || !v.dueTo || v.dueFrom <= v.dueTo, 'O vencimento final deve ser igual ou posterior ao inicial.');
export const getHonorarioInput = z.object({ agreementId: id });
export const honorariosOptionsInput = z.object({ purpose: z.enum(['create', 'filter']).default('create'), query: z.string().trim().max(180).optional(), clientId: id.optional(), caseId: id.optional(), limit: z.number().int().min(1).max(100).default(50) });
export const createHonorarioInput = z.object({
  clientId: id, caseId: id.nullable().default(null), title: z.string().trim().min(2).max(180), notes: z.string().trim().max(4000).default(''),
  installments: z.array(z.object({ amountCents: amount, dueOn: civilDate })).min(1).max(120), idempotencyKey: key,
}).refine(v => v.installments.reduce((sum, row) => sum + row.amountCents, 0) <= 99_999_999_999, 'O total excede o valor permitido.');
export const receiveHonorarioInput = z.object({ installmentId: id, amountCents: amount, receivedOn: civilDate, method: paymentMethod, notes: z.string().trim().max(2000).default(''), idempotencyKey: key });
export const reverseHonorarioInput = z.object({ receiptId: id, reason: z.string().trim().min(3).max(1000), idempotencyKey: key, approvalId: z.string().uuid().optional() });
export const cancelHonorarioInput = z.object({ agreementId: id, reason: z.string().trim().min(3).max(1000), idempotencyKey: key, approvalId: z.string().uuid().optional() });
export type HonorarioAgreement = z.output<typeof honorarioAgreementDto>;
export type HonorarioInstallment = z.output<typeof honorarioInstallmentDto>;
export type HonorarioReceipt = z.output<typeof honorarioReceiptDto>;
export type HonorarioDetail = z.output<typeof honorarioDetailDto>;
export type HonorariosList = z.output<typeof honorariosListDto>;
export type HonorariosOptions = z.output<typeof honorariosOptionsDto>;
