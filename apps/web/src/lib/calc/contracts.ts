import { z } from 'zod';

export const moneyCents = z.number().int().min(0).max(99_999_999_999);
export const date = z.iso.date().refine(value => value >= '1995-01-01' && value <= '2100-12-31', 'Use uma data entre 1995 e 2100.');
export const rate = z.string().regex(/^\d{1,3}(\.\d{1,6})?$/, 'Informe uma taxa entre 0 e 100, com até seis casas decimais.').refine(value => Number(value) <= 100);
export const series = z.enum(['ipca', 'inpc', 'selic', 'legal']);
export const observation = z.object({ series, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), value: z.string().regex(/^-?\d{1,3}(\.\d{1,8})?$/), source: z.string().max(500), fetchedAt: z.iso.datetime({ offset: true }) });
export type Observation = z.infer<typeof observation>;
export type Series = z.infer<typeof series>;

const installment = z.object({ description: z.string().trim().min(1).max(120), dueOn: date, interestFrom: date.optional(), amountCents: moneyCents.positive() });
const payment = z.object({ installment: z.number().int().min(1).max(240), paidOn: date, amountCents: moneyCents.positive() });
const monetary = {
  asOf: date,
  entries: z.array(installment).min(1).max(240),
  payments: z.array(payment).max(480).default([]),
  index: z.enum(['none', 'ipca', 'inpc']),
  interest: z.discriminatedUnion('kind', [z.object({ kind: z.literal('none') }), z.object({ kind: z.literal('monthly'), percent: rate }), z.object({ kind: z.literal('legal') })]),
  penaltyPercent: rate,
};
export const calculationInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('correction'), ...monetary }),
  z.object({ kind: z.literal('pension'), ...monetary, basis: z.string().trim().min(5).max(2000) }),
  z.object({ kind: z.literal('rent'), ...monetary, contractBasis: z.string().trim().min(5).max(2000), annualAdjustmentPercent: rate, anniversary: date }),
  z.object({ kind: z.literal('consumer'), ...monetary, restitution: z.enum(['simple', 'double']), legalBasis: z.string().trim().min(5).max(2000) }),
  z.object({ kind: z.literal('tax'), operation: z.enum(['debt', 'credit']), asOf: date, principalCents: moneyCents.positive(), originOn: date, moraStart: date, legalBasis: z.string().trim().min(5).max(2000) }),
  z.object({ kind: z.literal('revision'), principalCents: moneyCents.positive(), contractualMonthlyPercent: rate, alternativeMonthlyPercent: rate, installments: z.number().int().min(1).max(600), paidInstallments: z.number().int().min(0).max(600), system: z.enum(['price', 'sac']), rateSource: z.string().trim().min(5).max(2000) }),
  z.object({ kind: z.literal('labor'), salaryCents: moneyCents.positive(), salaryDays: z.number().int().min(0).max(30), thirteenthMonths: z.number().int().min(0).max(12), vacationMonths: z.number().int().min(0).max(12), vacationPeriods: z.number().int().min(0).max(10), noticeDays: z.number().int().min(0).max(90), fgtsBaseCents: moneyCents, termination: z.enum(['dismissal', 'resignation', 'agreement']), deductionsCents: moneyCents, basis: z.string().trim().min(5).max(2000) }),
]).superRefine((input, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if ('entries' in input) {
    const periods = input.entries.reduce((sum, entry) => sum + Math.max(0, (Number(input.asOf.slice(0, 4)) - Number(entry.dueOn.slice(0, 4))) * 12 + Number(input.asOf.slice(5, 7)) - Number(entry.dueOn.slice(5, 7))) + 2, 0);
    if (periods + input.payments.length > 10000) issue('Divida o cálculo em períodos menores, até 10 mil linhas de memória.');
    if (input.entries.some(entry => entry.dueOn > input.asOf)) issue('Há uma parcela posterior à data-base.');
    for (const payment of input.payments) {
      const entry = input.entries[payment.installment - 1];
      if (!entry || payment.paidOn < entry.dueOn || payment.paidOn > input.asOf) issue('Vincule cada pagamento a uma parcela e a uma data entre o vencimento e a data-base.');
    }
    if (input.interest.kind === 'legal' && input.entries.some(entry => (entry.interestFrom ?? entry.dueOn) < '2024-08-30')) issue('A Taxa Legal está disponível a partir de 30/08/2024. Separe os períodos anteriores.');
    if (input.entries.some(entry => entry.interestFrom && entry.interestFrom < entry.dueOn)) issue('O início dos juros não pode anteceder a origem da parcela.');
    if (input.kind === 'consumer' && input.penaltyPercent !== '0') issue('Repetição de indébito não acrescenta multa de mora automaticamente. Use multa zero.');
  }
  if (input.kind === 'tax') {
    if (input.originOn > input.asOf || input.moraStart < input.originOn || (input.operation === 'debt' && input.moraStart <= input.originOn)) issue('Confira a origem, o início da mora e a data-base. A mora do débito começa após o vencimento.');
    if (input.originOn < (input.operation === 'credit' ? '1998-01-01' : '1997-01-01')) issue('Este regime federal não abrange a data de origem informada.');
  }
  if (input.kind === 'revision' && input.paidInstallments > input.installments) issue('As parcelas pagas não podem exceder o prazo do contrato.');
  if (input.kind === 'labor' && input.termination === 'resignation' && input.noticeDays > 0) issue('Pedido de demissão não gera aviso indenizado a receber. Informe eventual desconto em deduções.');
});
export type CalculationInput = z.infer<typeof calculationInput>;
export type CalculationKind = CalculationInput['kind'];

export const resultRow = z.object({ label: z.string(), date: z.string(), principalCents: z.number().int(), correctionCents: z.number().int(), interestCents: z.number().int(), penaltyCents: z.number().int(), paidCents: z.number().int(), totalCents: z.number().int(), formula: z.string() });
export const calculationResult = z.object({ engineVersion: z.string(), totalCents: z.number().int().safe(), rows: z.array(resultRow), notes: z.array(z.string()), sources: z.array(z.string()), observations: z.array(observation) });
export type CalculationResult = z.infer<typeof calculationResult>;
export const calculateInput = z.object({ input: calculationInput });
export const saveCalculationInput = z.object({ id: z.string().uuid().optional(), expectedVersion: z.number().int().nonnegative(), title: z.string().trim().min(3).max(180), clientId: z.string().max(64).nullable().default(null), caseId: z.string().max(64).nullable().default(null), notes: z.string().max(4000).default(''), input: calculationInput, idempotencyKey: z.string().uuid() });
export const getCalculationInput = z.object({ id: z.string().uuid(), version: z.number().int().positive().optional() });
export const listCalculationsInput = z.object({ query: z.string().max(180).default(''), limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(100000).default(0) });
export const savedCalculation = z.object({ id: z.string().uuid(), title: z.string(), version: z.number().int(), latestVersion: z.number().int(), clientId: z.string().nullable(), caseId: z.string().nullable(), notes: z.string(), input: calculationInput, result: calculationResult, createdAt: z.iso.datetime({ offset: true }) });
export type SavedCalculation = z.infer<typeof savedCalculation>;
export const calculationsList = z.object({ items: z.array(z.object({ id: z.string(), title: z.string(), kind: z.string(), version: z.number().int(), totalCents: z.number().int(), updatedAt: z.string() })), total: z.number().int() });

export const calculators = [
  { kind: 'correction', name: 'Correção de valores', description: 'Atualize parcelas, juros e pagamentos, com memória por período.' },
  { kind: 'labor', name: 'Trabalhista', description: 'Rescisão CLT de mensalista, com avos e bases conferidos por você.' },
  { kind: 'revision', name: 'Revisional bancário', description: 'Compare taxas e cronogramas nos sistemas Price e SAC.' },
  { kind: 'pension', name: 'Pensão alimentícia', description: 'Atualize parcelas fixadas no título e desconte pagamentos.' },
  { kind: 'rent', name: 'Aluguel', description: 'Reajuste contratual percentual e atualização de aluguéis vencidos.' },
  { kind: 'consumer', name: 'Consumidor', description: 'Restituição simples ou em dobro de valores indevidamente pagos.' },
  { kind: 'tax', name: 'Tributário', description: 'Débitos e créditos federais com SELIC e memória mensal.' },
] satisfies { kind: CalculationKind; name: string; description: string }[];
