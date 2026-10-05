import assert from 'node:assert/strict';
import test from 'node:test';
import { calculate, requiredObservations } from '../src/lib/calc/engine';
import { calculationInput, type CalculationInput, type Observation } from '../src/lib/calc/contracts';
import { calculationCsv } from '../src/lib/calc/export';

const debt = { kind: 'correction', asOf: '2025-03-01', entries: [{ description: 'Principal', dueOn: '2025-01-01', amountCents: 100000 }], payments: [], index: 'none', interest: { kind: 'monthly', percent: '1' }, penaltyPercent: '2' } satisfies CalculationInput;
const observation = (series: Observation['series'], month: string, value: string): Observation => ({ series, month, value, source: 'https://www.bcb.gov.br', fetchedAt: '2026-10-04T00:00:00Z' });

test('simple interest, one-off penalty and partial payments follow the cash timeline', () => {
  assert.equal(calculate(debt).totalCents, 104000);
  const paid = calculate({ ...debt, payments: [{ installment: 1, paidOn: '2025-02-01', amountCents: 53000 }] });
  assert.equal(paid.totalCents, 50500);
  assert.equal(paid.rows.at(-1)?.interestCents, 500);
  assert.throws(() => calculate({ ...debt, payments: [{ installment: 1, paidOn: '2025-01-01', amountCents: 100001 }] }), /excede/);
  assert.equal(calculate({ ...debt, payments: [{ installment: 1, paidOn: '2025-01-01', amountCents: 100000 }] }).totalCents, 0);
});
test('closed monthly indices and simple legal interest preserve sources and cents', () => {
  const input = { ...debt, index: 'ipca', interest: { kind: 'none' }, penaltyPercent: '0' } satisfies CalculationInput;
  assert.deepEqual(requiredObservations(input), [{ series: 'ipca', month: '2025-02' }]);
  assert.throws(() => calculate(input), /ausente/);
  assert.equal(calculate(input, [observation('ipca', '2025-02', '1.31')]).totalCents, 101310);
  assert.equal(calculate(input, [observation('ipca', '2025-02', '-0.5')]).totalCents, 99500);
  const legal = calculate({ ...debt, interest: { kind: 'legal' }, penaltyPercent: '0' }, [observation('legal', '2025-01', '0.589427'), observation('legal', '2025-02', '0.902209')]);
  assert.equal(legal.totalCents, 101492);
  assert.equal(legal.observations.length, 2);
});
test('consumer repetition doubles only the entered overpayment, then subtracts reimbursement', () => {
  const consumer = { ...debt, kind: 'consumer', interest: { kind: 'none' }, penaltyPercent: '0', restitution: 'double', legalBasis: 'Excesso pago, hipótese jurídica conferida', entries: [{ description: 'Excesso pago de R$ 100', dueOn: '2025-01-01', amountCents: 10000 }] } satisfies CalculationInput;
  assert.equal(calculate(consumer).totalCents, 20000);
  assert.equal(calculate({ ...consumer, payments: [{ installment: 1, paidOn: '2025-02-01', amountCents: 5000 }] }).totalCents, 15000);
  assert.equal(calculate({ ...consumer, restitution: 'simple' }).totalCents, 10000);
});
test('federal tax adds monthly SELIC, caps late penalty, excludes same-month interest', () => {
  const tax = { kind: 'tax', operation: 'debt', principalCents: 100000, originOn: '2024-12-20', moraStart: '2024-12-23', asOf: '2025-03-20', legalBasis: 'Tributo federal, art. 61 da Lei 9.430' } satisfies CalculationInput;
  const indices = [observation('selic', '2025-01', '1.01'), observation('selic', '2025-02', '0.99')];
  assert.equal(calculate(tax, indices).totalCents, 123000);
  assert.equal(calculate({ ...tax, operation: 'credit' }, indices).totalCents, 103000);
  assert.equal(calculate({ ...tax, originOn: '2025-03-10', moraStart: '2025-03-11', asOf: '2025-03-20' }).totalCents, 103300);
  assert.equal(calculate({ ...tax, originOn: '2025-03-10', moraStart: '2025-03-11', asOf: '2025-03-10' }).totalCents, 100000);
  assert.equal(calculate({ ...tax, originOn: '2025-02-20', moraStart: '2025-02-21', asOf: '2025-03-01' }).rows[0].interestCents, 1000);
});
test('rent anniversary, pension title and labor settlement expose their individual bases', () => {
  const rent = { ...debt, kind: 'rent', index: 'none', interest: { kind: 'none' }, penaltyPercent: '0', annualAdjustmentPercent: '10', anniversary: '2025-01-01', contractBasis: 'Reajuste fixo anual previsto no contrato' } satisfies CalculationInput;
  assert.equal(calculate(rent).totalCents, 110000);
  assert.equal(calculate({ ...rent, entries: [{ ...rent.entries[0], dueOn: '2024-12-31' }] }).totalCents, 100000);
  assert.equal(calculate({ ...debt, kind: 'pension', basis: 'Pensão fixa, título judicial conferido' }).totalCents, 104000);
  const labor = { kind: 'labor', salaryCents: 300000, salaryDays: 10, thirteenthMonths: 6, vacationMonths: 6, vacationPeriods: 1, noticeDays: 30, fgtsBaseCents: 1000000, termination: 'dismissal', deductionsCents: 50000, basis: 'Avos conferidos com projeção do aviso' } satisfies CalculationInput;
  assert.equal(calculate(labor).totalCents, 1500000);
  assert.equal(calculate({ ...labor, termination: 'agreement' }).totalCents, 1150000);
  assert.equal(calculate({ ...labor, termination: 'resignation', noticeDays: 0 }).totalCents, 800000);
});
test('Price and SAC compare complete schedules, including zero interest and final cents', () => {
  const revision = { kind: 'revision', principalCents: 100000, contractualMonthlyPercent: '1', alternativeMonthlyPercent: '0', installments: 2, paidInstallments: 1, system: 'sac', rateSource: 'Taxa alternativa informada no parecer' } satisfies CalculationInput;
  assert.equal(calculate(revision).totalCents, 1500);
  assert.equal(calculate({ ...revision, system: 'price' }).totalCents, 1502);
  assert.equal(calculate({ ...revision, contractualMonthlyPercent: '0', principalCents: 100001 }).totalCents, 0);
  assert.equal(calculate({ ...revision, contractualMonthlyPercent: '0', alternativeMonthlyPercent: '1' }).totalCents, -1500);
});
test('invalid inputs and spreadsheet formulas cannot silently become valid financial data', () => {
  assert.equal(calculationInput.safeParse({ ...debt, entries: [{ ...debt.entries[0], dueOn: '2025-02-30' }] }).success, false);
  assert.equal(calculationInput.safeParse({ ...debt, payments: [{ installment: 2, paidOn: '2025-02-01', amountCents: 1 }] }).success, false);
  const input = { ...debt, entries: [{ ...debt.entries[0], description: '=HYPERLINK("bad")' }] };
  const csv = calculationCsv({ id: 'example', title: '+Formula', version: 1, latestVersion: 1, clientId: null, caseId: null, notes: '', input, result: calculate(input), createdAt: '2025-03-01T00:00:00Z' });
  assert.match(csv, /'\+Formula/);
  assert.ok(csv.startsWith('\uFEFF'));
});
