import { z } from 'zod';

export const asaasEnvironment = z.enum(['sandbox', 'production']);
export type AsaasEnvironment = z.infer<typeof asaasEnvironment>;

/** What the Lume keeps about the connected account: enough to recognise it, with the document masked. */
export const asaasAccount = z.object({
  name: z.string().min(1).max(500), email: z.string().max(320).nullable(),
  document: z.string().max(40).nullable(), personType: z.string().max(40).nullable(), status: z.string().max(60).nullable(),
});
export type AsaasAccount = z.infer<typeof asaasAccount>;
export const asaasConnection = z.object({
  environment: asaasEnvironment, walletId: z.string(), account: asaasAccount, version: z.string().uuid(), verifiedAt: z.string(),
});
export const asaasStatus = z.object({ canManage: z.boolean(), connection: asaasConnection.nullable() });
export type AsaasStatus = z.infer<typeof asaasStatus>;

export const asaasConnectInput = z.object({
  apiKey: z.string().trim().max(400).refine(value => /^\$aact_[\x21-\x7e]{10,}$/.test(value),
    'Cole a chave de API completa do Asaas. Ela começa com $aact_.'),
  expectedVersion: z.string().uuid().nullable(),
}).strict();
export const asaasVersionInput = z.object({ expectedVersion: z.string().uuid() }).strict();

export function asaasAccountStatusLabel(value: string | null): string {
  switch (value) {
    case 'APPROVED': return 'Aprovada';
    case 'PENDING': return 'Em análise no Asaas';
    case 'DENIED': return 'Reprovada no Asaas';
    case 'AWAITING_ACTION_AUTHORIZATION': return 'Aguardando autorização no Asaas';
    default: return 'Não informada';
  }
}

export function asaasEnvironmentLabel(value: AsaasEnvironment): string {
  return value === 'production' ? 'Produção' : 'Sandbox (testes, sem dinheiro real)';
}

const id = z.string().min(1).max(64);
const civilDate = z.iso.date();
export const asaasPaymentState = z.enum(['creating', 'open', 'paid', 'cancelled', 'refunded', 'failed']);
export const asaasPaymentDto = z.object({
  id, state: asaasPaymentState, providerStatus: z.string().nullable(), amountCents: z.number().int().positive(), dueOn: civilDate,
  invoiceUrl: z.string().url().nullable(), failure: z.string().nullable(), environment: asaasEnvironment, createdAt: z.iso.datetime({ offset: true }),
  /** A `creating` row whose attempt ended without an answer: it must be confirmed with Asaas. */
  unconfirmed: z.boolean(),
});
export type AsaasPayment = z.infer<typeof asaasPaymentDto>;
export const asaasChargeDto = z.object({
  installmentId: id, connection: z.object({ environment: asaasEnvironment }).nullable(), needsDocument: z.boolean(),
  pendingCents: z.number().int().nonnegative(), chargeable: z.boolean(), suggestedDueOn: civilDate, today: civilDate,
  active: asaasPaymentDto.nullable(), history: z.array(asaasPaymentDto),
});
export type AsaasCharge = z.infer<typeof asaasChargeDto>;

const document = z.string().transform(value => value.replace(/\D/g, '')).refine(value => value.length === 11 || value.length === 14,
  'Informe um CPF com 11 dígitos ou um CNPJ com 14 dígitos.');
export const asaasChargeGetInput = z.object({ installmentId: id }).strict();
export const asaasChargeCreateInput = z.object({
  installmentId: id, dueOn: civilDate, document: document.nullable().default(null), idempotencyKey: z.string().min(8).max(128),
}).strict();
export const asaasChargePaymentInput = z.object({ installmentId: id, paymentId: id }).strict();
export const asaasChargeOperation = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('get'), data: asaasChargeGetInput }),
  z.object({ operation: z.literal('create'), data: asaasChargeCreateInput }),
  z.object({ operation: z.literal('cancel'), data: asaasChargePaymentInput }),
  z.object({ operation: z.literal('confirm'), data: asaasChargePaymentInput }),
]);

export function asaasPaymentLabel(payment: Pick<AsaasPayment, 'state' | 'providerStatus' | 'unconfirmed'>): string {
  switch (payment.state) {
    case 'creating': return payment.unconfirmed ? 'Sem confirmação do Asaas' : 'Sendo criada no Asaas';
    case 'open': return payment.providerStatus === 'OVERDUE' ? 'Vencida, aguardando pagamento' : 'Aguardando pagamento';
    case 'paid': return 'Paga';
    case 'cancelled': return 'Cancelada';
    case 'refunded': return 'Estornada';
    case 'failed': return 'Não criada';
  }
}
