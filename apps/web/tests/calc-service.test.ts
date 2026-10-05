import { testDb } from './test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { saveCalculation, getCalculation, listCalculations, calculatePreview } from '../src/lib/calc/service';
import { saveFeeQuote, billFeeQuote, listFeeQuotes, getFeeQuote } from '../src/lib/honorarios/quotes';
import { getHonorario } from '../src/lib/honorarios/service';
import { priceFees, type FeeTerms } from '../src/lib/honorarios/pricing';
import type { CalculationInput } from '../src/lib/calc/contracts';

async function fixture() {
  const userId = randomUUID(); const officeId = randomUUID(); const clientId = randomUUID();
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@test.local`, 'Advogada');
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório Calc');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id) VALUES(?,?,?)').run(randomUUID(), officeId, userId);
  await testDb.prepare("INSERT INTO crm_client(id,office_id,name,stage,created_at,updated_at) VALUES(?,?,?,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run(clientId, officeId, 'Cliente Calc');
  return { context: { userId, officeId }, clientId };
}
const input = { kind: 'consumer', restitution: 'double', legalBasis: 'Pagamento indevido conferido no extrato', asOf: '2025-03-01', index: 'none', interest: { kind: 'none' }, penaltyPercent: '0', entries: [{ description: 'Excesso pago', dueOn: '2025-01-01', amountCents: 10000 }], payments: [] } satisfies CalculationInput;
const terms = { uf: 'PE', referenceId: 'PE-2026-p1-1.1', serviceOn: '2026-10-04', scope: 'Consulta e análise de documentos', paymentTerms: 'Entrada na contratação e êxito no recebimento', justification: '', calculation: null, allocations: [], components: [{ kind: 'fixed', label: 'Consulta', due: 'contract', condition: '', amountCents: 50000 }, { kind: 'percentage', label: 'Êxito', due: 'success', condition: 'Recebimento efetivo do cliente', baseCents: 100000, percent: '20' }] } satisfies FeeTerms;

test('Calc saves server results, immutable versions, concurrent retries and office boundaries', async () => {
  const owner = await fixture(); const other = await fixture();
  const payload = { title: 'Consumidor', expectedVersion: 0, clientId: owner.clientId, input, idempotencyKey: randomUUID() };
  const [one, replay] = await Promise.all([saveCalculation(owner.context, payload), saveCalculation(owner.context, payload)]);
  assert.deepEqual(one, replay); assert.equal(one.result.totalCents, 20000);
  assert.equal((await listCalculations(owner.context, {})).total, 1);
  await assert.rejects(getCalculation(other.context, { id: one.id }), { code: 'NOT_FOUND' });
  await assert.rejects(saveCalculation(owner.context, { ...payload, title: 'Mudança' }), { code: 'CONFLICT' });
  const v2 = await saveCalculation(owner.context, { ...payload, id: one.id, expectedVersion: 1, input: { ...input, restitution: 'simple' }, idempotencyKey: randomUUID() });
  assert.equal(v2.version, 2); assert.equal(v2.result.totalCents, 10000);
  assert.equal((await getCalculation(owner.context, { id: one.id, version: 1 })).result.totalCents, 20000);
  await assert.rejects(saveCalculation(owner.context, { ...payload, id: one.id, expectedVersion: 1, idempotencyKey: randomUUID() }), { code: 'CONFLICT' });
  await assert.rejects(saveCalculation(owner.context, { ...payload, clientId: other.clientId, idempotencyKey: randomUUID() }), { code: 'NOT_FOUND' });
  await testDb.prepare('DELETE FROM office_member WHERE user_id=?').run(owner.context.userId);
  await assert.rejects(getCalculation(owner.context, { id: one.id }), { code: 'FORBIDDEN' });
});
test('quotes separate contingent fees, bill each component once and preserve actual success base', async () => {
  const owner = await fixture(); const other = await fixture();
  const caseId = randomUUID();
  await testDb.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, owner.context.officeId, 'Caso dos honorários', owner.context.userId);
  await testDb.prepare('INSERT INTO case_participant(office_id,case_id,user_id,invited_by) VALUES(?,?,?,?)').run(owner.context.officeId, caseId, other.context.userId, owner.context.userId);
  const payload = { title: 'Proposta consulta e êxito', clientId: owner.clientId, caseId, expectedVersion: 0, terms, idempotencyKey: randomUUID() };
  const quote = await saveFeeQuote(owner.context, payload);
  assert.equal(quote.pricing.contractedCents, 50000); assert.equal(quote.pricing.contingentCents, 20000);
  assert.equal(quote.billed.length, 0);
  assert.equal((await listFeeQuotes(other.context)).items.length, 0);
  await assert.rejects(getFeeQuote(other.context, { id: quote.id }), { code: 'NOT_FOUND' });
  const bill = { id: quote.id, version: 1, component: 0, firstDueOn: '2026-01-31', count: 3, evidence: 'Contrato aprovado e assinado', idempotencyKey: randomUUID() };
  const [first, repeat] = await Promise.all([billFeeQuote(owner.context, bill), billFeeQuote(owner.context, bill)]);
  assert.deepEqual(first, repeat); assert.equal(first.billed.length, 1);
  const agreement = await getHonorario(owner.context, { agreementId: first.billed[0].agreementId });
  assert.deepEqual(agreement.installments.map(row => row.amountCents), [16666, 16666, 16668]);
  assert.deepEqual(agreement.installments.map(row => row.dueOn), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.equal(agreement.agreement.pricing?.reference?.fixedCents, 50000);
  const participant = await getHonorario(other.context, { agreementId: first.billed[0].agreementId });
  assert.equal(participant.agreement.pricing, null);
  assert.equal(participant.agreement.notes.includes(bill.evidence), false);
  assert.equal(participant.agreement.totalCents, 50000);
  await assert.rejects(billFeeQuote(owner.context, { ...bill, idempotencyKey: randomUUID() }), { code: 'CONFLICT' });
  await assert.rejects(saveFeeQuote(owner.context, { ...payload, id: quote.id, expectedVersion: 1, idempotencyKey: randomUUID() }), { code: 'CONFLICT' });
  await assert.rejects(billFeeQuote(owner.context, { ...bill, component: 1, idempotencyKey: randomUUID() }), { code: 'INVALID' });
  const success = await billFeeQuote(owner.context, { ...bill, component: 1, realizedBaseCents: 200000, evidence: 'Cliente recebeu R$ 2.000, comprovante conferido', idempotencyKey: randomUUID() });
  assert.equal(success.billed[1].amountCents, 40000);
  assert.equal(success.pricing.contingentCents, 20000);
});
test('fee methods preserve decimal cents and reference metadata without inventing OAB composition', () => {
  const pricing = priceFees({ ...terms, allocations: [{ name: 'Associada', percent: '30' }], components: [{ kind: 'hours', label: 'Estudo', due: 'contract', condition: '', rateCents: 50000, quantity: '1.25' }, { kind: 'monthly', label: 'Assessoria', due: 'contract', condition: '', amountCents: 100000, months: 3 }] });
  assert.equal(pricing.contractedCents, 362500);
  assert.equal(pricing.reference?.source.includes('oabpe.org.br'), true);
  assert.throws(() => priceFees({ ...terms, uf: 'RS' }), /Referência/);
  assert.throws(() => priceFees({ ...terms, allocations: [{ name: 'Associada', percent: '60' }, { name: 'Titular', percent: '60' }] }));
});

test('proposal revisions preserve the original price and cannot bill an outdated version', async () => {
  const owner = await fixture();
  const original = await saveFeeQuote(owner.context, { title: 'Proposta revisável', clientId: owner.clientId, expectedVersion: 0, terms, idempotencyKey: randomUUID() });
  const revised = await saveFeeQuote(owner.context, { id: original.id, title: original.title, clientId: owner.clientId, expectedVersion: 1, terms: { ...terms, components: [{ kind: 'fixed', label: 'Consulta', due: 'contract', condition: '', amountCents: 80000 }] }, idempotencyKey: randomUUID() });
  const historical = await getFeeQuote(owner.context, { id: original.id, version: 1 });
  assert.equal(historical.latestVersion, 2);
  assert.equal(historical.pricing.contractedCents, 50000);
  assert.equal(revised.pricing.contractedCents, 80000);
  await assert.rejects(billFeeQuote(owner.context, { id: original.id, version: 1, component: 0, firstDueOn: '2026-10-10', count: 1, evidence: 'Aceite referente à versão antiga', idempotencyKey: randomUUID() }), { code: 'CONFLICT' });
});

test('official index transport rejects incomplete data, caches complete series and preserves saved observations', async t => {
  const owner = await fixture();
  const tax = { kind: 'tax', operation: 'credit', originOn: '2025-12-20', moraStart: '2025-12-20', asOf: '2026-03-20', principalCents: 100000, legalBasis: 'Pagamento federal indevido comum' } satisfies CalculationInput;
  const fetchMock = t.mock.method(globalThis, 'fetch', async (request: RequestInfo | URL) => {
    assert.match(String(request), /^https:\/\/api\.bcb\.gov\.br\/dados\/serie\/bcdata\.sgs\.4390/);
    return new Response(JSON.stringify([{ data: '01/01/2026', valor: '1.01' }]));
  });
  await assert.rejects(calculatePreview(owner.context, { input: tax }), /série SELIC completa/);
  fetchMock.mock.mockImplementation(async () => new Response(JSON.stringify([{ data: '01/01/2026', valor: '1.01' }, { data: '01/02/2026', valor: '0.99' }])));
  const saved = await saveCalculation(owner.context, { title: 'Crédito com índices de teste', expectedVersion: 0, input: tax, idempotencyKey: randomUUID() });
  assert.equal(saved.result.totalCents, 103000);
  assert.equal(saved.result.observations.length, 2);
  fetchMock.mock.mockImplementation(async () => { throw new Error('DNS unavailable'); });
  assert.equal((await calculatePreview(owner.context, { input: tax })).totalCents, 103000);
  await testDb.prepare("UPDATE legal_index_observation SET fetched_at='2025-01-01T00:00:00.000Z' WHERE series='selic'").run();
  await assert.rejects(calculatePreview(owner.context, { input: tax }), /Nenhum índice foi estimado/);
  assert.deepEqual((await getCalculation(owner.context, { id: saved.id })).result.observations, saved.result.observations);
});
