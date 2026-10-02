import { testDb } from './test-setup';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { z } from 'zod';
import { agentTools, runCapability } from '../src/lib/agent-tools';
import { honorariosCapabilities } from '../src/lib/capabilities/honorarios';
import { publishedCapabilities } from '../src/lib/capabilities/contracts';
import type { WorkspaceContext } from '../src/lib/application/context';
import * as dto from '../src/lib/honorarios/contracts';
import * as service from '../src/lib/honorarios/service';
import { CapabilityError } from '../src/lib/capabilities/errors';
import { approvalIdFromMessage } from '../src/lib/application/approvals-service';
import { decideAgentApproval, describeAgentApproval } from '../src/lib/application/agent-approvals';

async function fixture() {
  const officeId = randomUUID(); const userId = randomUUID(); const caseId = randomUUID(); const clientId = randomUUID();
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@test.local`, 'Administradora');
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id) VALUES(?,?,?)').run(randomUUID(), officeId, userId);
  await testDb.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, officeId, 'Caso próprio', userId);
  await testDb.prepare("INSERT INTO crm_client(id,office_id,name,stage,created_at,updated_at) VALUES(?,?,?,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run(clientId, officeId, 'Maria Silva');
  return { context: { officeId, userId } as WorkspaceContext, caseId, clientId };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
test('agent can find the second installment and register its receipt without editing the client', async () => {
  const f = await fixture();
  const created = dto.honorarioDetailDto.parse(await runCapability(f.context, 'k5_honorarios_create', {
    ...creation(f), installments: [{ amountCents: 5000, dueOn: '2024-01-10' }, { amountCents: 5000, dueOn: '2024-02-10' }],
  }));
  const context = { ...f.context, invocation: 'agent' as const };
  const listed = dto.honorariosListDto.parse(await runCapability(context, 'k5_honorarios_list', { query: 'Maria' }));
  const second = listed.installments.find(row => row.number === 2);
  assert.ok(second);
  assert.ok(agentTools(f.context).k5_honorarios_receive);
  const input = { installmentId: second.id, amountCents: second.pendingCents, receivedOn: '2024-03-01', method: 'other', idempotencyKey: randomUUID() };
  const paid = dto.honorarioDetailDto.parse(await runCapability(context, 'k5_honorarios_receive', input));
  assert.equal(paid.installments[1].status, 'received');
  assert.equal(paid.installments[0].status, 'pending');
  assert.deepEqual(await runCapability(context, 'k5_honorarios_receive', input), paid);
  assert.equal(paid.agreement.id, created.agreement.id);
});

test('agent reversals and cancellation wait for confirmation of the exact financial record', async () => {
  const f = await fixture();
  const initial = await create(f, 5000);
  const paid = await receive(f, initial, 5000);
  const context = { ...f.context, invocation: 'agent' as const };
  async function proposal(call: Promise<unknown>) {
    try { await call; } catch (error) {
      assert.ok(error instanceof CapabilityError); assert.equal(error.code, 'APPROVAL_REQUIRED');
      const id = approvalIdFromMessage(error.message); assert.ok(id); return id;
    }
    assert.fail('expected confirmation');
  }
  const reversal = { receiptId: paid.receipts[0].id, reason: 'Lançamento duplicado', idempotencyKey: randomUUID() };
  const id = await proposal(runCapability(context, 'k5_honorarios_reverse', reversal));
  assert.equal((await service.getHonorario(f.context, { agreementId: initial.agreement.id })).agreement.receivedCents, 5000);
  assert.match(await describeAgentApproval(context, 'k5_honorarios_reverse', reversal), /50,00.*parcela 1 de Maria Silva/);
  const other = await fixture();
  await assert.rejects(decideAgentApproval(other.context, id, 'confirm'), { code: 'NOT_FOUND' });
  assert.equal((await decideAgentApproval(f.context, id, 'confirm')).state, 'confirmed');
  assert.equal((await service.getHonorario(f.context, { agreementId: initial.agreement.id })).agreement.receivedCents, 0);
  const cancellation = { agreementId: initial.agreement.id, reason: 'Contrato encerrado', idempotencyKey: randomUUID() };
  const cancelled = await proposal(runCapability(context, 'k5_honorarios_cancel', cancellation));
  await decideAgentApproval(f.context, cancelled, 'cancel');
  assert.equal((await service.getHonorario(f.context, { agreementId: initial.agreement.id })).agreement.status, 'active');
  const confirmed = await proposal(runCapability(context, 'k5_honorarios_cancel', { ...cancellation, idempotencyKey: randomUUID() }));
  assert.equal((await decideAgentApproval(f.context, confirmed, 'confirm')).state, 'confirmed');
  assert.equal((await service.getHonorario(f.context, { agreementId: initial.agreement.id })).agreement.status, 'cancelled');
});

function creation(f: Fixture, amountCents = 10001) {
  return { clientId: f.clientId, caseId: f.caseId, title: 'Honorários contratuais', notes: 'Contrato assinado', installments: [{ amountCents, dueOn: '2024-02-29' }], idempotencyKey: randomUUID() };
}
async function create(f: Fixture, amountCents = 10001) {
  return dto.honorarioDetailDto.parse(await runCapability(f.context, 'k5_honorarios_create', creation(f, amountCents)));
}
function receipt(detail: dto.HonorarioDetail, amountCents = 10001) {
  return { installmentId: detail.installments[0].id, amountCents, receivedOn: '2024-03-01', method: 'pix', idempotencyKey: randomUUID() };
}
async function receive(f: Fixture, detail: dto.HonorarioDetail, amountCents: number) {
  return dto.honorarioDetailDto.parse(await runCapability(f.context, 'k5_honorarios_receive', receipt(detail, amountCents)));
}

test('honorários: exact cents, partial receipts, reversal history, cancellation and filtered summaries', async () => {
  const f = await fixture();
  const initial = dto.honorarioDetailDto.parse(await runCapability(f.context, 'k5_honorarios_create', { ...creation(f), installments: [{ amountCents: 5000, dueOn: '2024-02-29' }, { amountCents: 5001, dueOn: '2099-01-10' }] }));
  assert.equal(initial.agreement.totalCents, 10001);
  assert.deepEqual(initial.installments.map(i => [i.number, i.installmentCount, i.overdue]), [[1, 2, true], [2, 2, false]]);
  const partial = await receive(f, initial, 3333);
  assert.equal(partial.installments[0].status, 'partial');
  assert.equal(partial.installments[0].pendingCents, 1667);
  const settled = await receive(f, initial, 1667);
  assert.equal(settled.installments[0].status, 'received');
  assert.equal(settled.agreement.pendingCents, 5001);
  const listed = dto.honorariosListDto.parse(await runCapability(f.context, 'k5_honorarios_list', { view: 'received', limit: 1, offset: 50 }));
  assert.equal(listed.total, 1); assert.equal(listed.installments.length, 0);
  assert.deepEqual(listed.summary, { totalCents: 10001, receivedCents: 5000, pendingCents: 5001, overdueCents: 0 });
  const filtered = await service.listHonorarios(f.context, { clientId: f.clientId, caseId: f.caseId, query: 'MARIA', dueTo: '2024-03-01' });
  assert.deepEqual(filtered.summary, { totalCents: 5000, receivedCents: 5000, pendingCents: 0, overdueCents: 0 });
  await assert.rejects(runCapability(f.context, 'k5_honorarios_cancel', { agreementId: initial.agreement.id, reason: 'Contrato encerrado', idempotencyKey: randomUUID() }), { code: 'CONFLICT' });
  for (const r of settled.receipts) await runCapability(f.context, 'k5_honorarios_reverse', { receiptId: r.id, reason: 'Registro incorreto', idempotencyKey: randomUUID() });
  const reversed = await service.getHonorario(f.context, { agreementId: initial.agreement.id });
  assert.equal(reversed.receipts.length, 2);
  assert.ok(reversed.receipts.every(r => r.reversal?.reason === 'Registro incorreto' && r.reversal.createdByName === 'Administradora'));
  assert.equal(reversed.agreement.receivedCents, 0);
  const cancelled = dto.honorarioDetailDto.parse(await runCapability(f.context, 'k5_honorarios_cancel', { agreementId: initial.agreement.id, reason: 'Contrato encerrado', idempotencyKey: randomUUID() }));
  assert.equal(cancelled.agreement.status, 'cancelled');
  assert.ok(cancelled.agreement.cancelledAt);
  assert.ok(cancelled.installments.every(i => i.status === 'cancelled' && !i.overdue));
  assert.equal(cancelled.agreement.totalCents, 10001);
  const cancelledList = await service.listHonorarios(f.context, { view: 'cancelled' });
  assert.equal(cancelledList.total, 2);
  assert.deepEqual(cancelledList.summary, { totalCents: 0, receivedCents: 0, pendingCents: 0, overdueCents: 0 });
  await assert.rejects(receive(f, initial, 1), { code: 'CONFLICT' });
});

test('honorários: concurrent create and receive retries commit one record; changed payload and operation conflict', async () => {
  const f = await fixture(); const input = creation(f);
  const results = await Promise.all(Array.from({ length: 8 }, () => runCapability(f.context, 'k5_honorarios_create', input)));
  for (const result of results) assert.deepEqual(result, results[0]);
  const created = dto.honorarioDetailDto.parse(results[0]);
  assert.equal((await service.listHonorarios(f.context)).total, 1);
  await assert.rejects(runCapability(f.context, 'k5_honorarios_create', { ...input, title: 'Outro título' }), { code: 'CONFLICT' });
  const receiveInput = receipt(created, 3333);
  const received = await Promise.all(Array.from({ length: 8 }, () => runCapability(f.context, 'k5_honorarios_receive', receiveInput)));
  for (const result of received) assert.deepEqual(result, received[0]);
  assert.equal(dto.honorarioDetailDto.parse(received[0]).receipts.length, 1);
  await assert.rejects(runCapability(f.context, 'k5_honorarios_receive', { ...receiveInput, amountCents: 1 }), { code: 'CONFLICT' });
  await assert.rejects(runCapability(f.context, 'k5_honorarios_cancel', { agreementId: created.agreement.id, reason: 'Correção contratual', idempotencyKey: input.idempotencyKey }), { code: 'CONFLICT' });
  assert.deepEqual(await runCapability(f.context, 'k5_honorarios_create', input), created, 'replay preserves the original response');
});

test('honorários: different keys serialize overpayment, double reversal and receive versus cancel', async () => {
  const f = await fixture(); const created = await create(f);
  const payments = await Promise.allSettled([receive(f, created, 7000), receive(f, created, 7000)]);
  assert.equal(payments.filter(p => p.status === 'fulfilled').length, 1);
  assert.equal(payments.filter(p => p.status === 'rejected').length, 1);
  const paid = await service.getHonorario(f.context, { agreementId: created.agreement.id });
  assert.equal(paid.agreement.receivedCents, 7000);
  const reversal = await Promise.allSettled(Array.from({ length: 2 }, () => runCapability(f.context, 'k5_honorarios_reverse', { receiptId: paid.receipts[0].id, reason: 'Pagamento duplicado', idempotencyKey: randomUUID() })));
  assert.equal(reversal.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(reversal.filter(r => r.status === 'rejected').length, 1);
  for (let round = 0; round < 4; round++) {
    const target = await create(f);
    const race = await Promise.allSettled([receive(f, target, 10001), runCapability(f.context, 'k5_honorarios_cancel', { agreementId: target.agreement.id, reason: 'Contrato encerrado', idempotencyKey: randomUUID() })]);
    assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(race.filter(r => r.status === 'rejected').length, 1);
    const final = await service.getHonorario(f.context, { agreementId: target.agreement.id });
    assert.ok(final.agreement.status === 'active' ? final.agreement.receivedCents === 10001 : final.agreement.receivedCents === 0);
  }
});

test('honorários: invalid dates, fractional cents, totals, required retry keys and future receipt are rejected atomically', async () => {
  const f = await fixture();
  for (const installments of [
    [{ amountCents: 1.1, dueOn: '2024-02-29' }], [{ amountCents: 0, dueOn: '2024-02-29' }],
    [{ amountCents: 1, dueOn: '2025-02-29' }], [{ amountCents: 1, dueOn: '2024-02-30' }],
    [{ amountCents: 99_999_999_999, dueOn: '2024-02-29' }, { amountCents: 1, dueOn: '2024-02-29' }],
  ]) await assert.rejects(runCapability(f.context, 'k5_honorarios_create', { ...creation(f), installments }));
  await assert.rejects(runCapability(f.context, 'k5_honorarios_create', { ...creation(f), idempotencyKey: undefined }));
  assert.equal((await service.listHonorarios(f.context)).total, 0);
  const created = await create(f);
  await assert.rejects(runCapability(f.context, 'k5_honorarios_receive', { ...receipt(created), receivedOn: '2099-01-01' }), { code: 'INVALID' });
  await assert.rejects(service.listHonorarios(f.context, { dueFrom: '2024-02-29', dueTo: '2024-01-01' }));
  assert.equal((await service.getHonorario(f.context, { agreementId: created.agreement.id })).receipts.length, 0);
  const invalid = { ...creation(f), clientId: randomUUID() };
  await assert.rejects(runCapability(f.context, 'k5_honorarios_create', invalid), { code: 'NOT_FOUND' });
  const claim = await testDb.prepare('SELECT 1 FROM honorario_mutation WHERE office_id=? AND idempotency_key=?').get(f.context.officeId, invalid.idempotencyKey);
  assert.equal(claim, undefined, 'failed write rolls back command reservation');
});

test('honorários: office references, owned options, cross-office reads/mutations and composite constraints', async () => {
  const a = await fixture(); const b = await fixture(); const outside = await create(b); const paid = await receive(b, outside, 1);
  await assert.rejects(service.getHonorario(a.context, { agreementId: outside.agreement.id }), { code: 'NOT_FOUND' });
  for (const refs of [{ clientId: b.clientId }, { caseId: b.caseId }]) await assert.rejects(runCapability(a.context, 'k5_honorarios_create', { ...creation(a), ...refs }), { code: 'NOT_FOUND' });
  await assert.rejects(receive(a, outside, 1), { code: 'NOT_FOUND' });
  await assert.rejects(runCapability(a.context, 'k5_honorarios_reverse', { receiptId: paid.receipts[0].id, reason: 'Registro incorreto', idempotencyKey: randomUUID() }), { code: 'NOT_FOUND' });
  await assert.rejects(runCapability(a.context, 'k5_honorarios_cancel', { agreementId: outside.agreement.id, reason: 'Contrato encerrado', idempotencyKey: randomUUID() }), { code: 'NOT_FOUND' });
  assert.equal((await service.listHonorarios(a.context, { caseId: b.caseId })).total, 0);
  const options = await service.honorariosOptions(a.context, { clientId: b.clientId, caseId: b.caseId });
  assert.deepEqual(options.clients.map(c => c.id), [a.clientId]); assert.deepEqual(options.cases.map(c => c.id), [a.caseId]);
  const selected = await service.honorariosOptions(a.context, { query: 'missing', clientId: a.clientId, caseId: a.caseId, limit: 1 });
  assert.equal(selected.clients[0].id, a.clientId); assert.equal(selected.cases[0].id, a.caseId);
  await testDb.prepare('UPDATE vault_case SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(a.caseId);
  assert.equal((await service.honorariosOptions(a.context)).cases.length, 0);
  await assert.rejects(runCapability(a.context, 'k5_honorarios_create', creation(a)), { code: 'NOT_FOUND' });
  await assert.rejects(testDb.prepare('INSERT INTO honorario_installment(id,office_id,agreement_id,number,due_on,amount_cents) VALUES(?,?,?,1,?,1)').run(randomUUID(), a.context.officeId, outside.agreement.id, '2024-02-29'), { code: '23503' });
});

test('honorários: fresh sessions, agent access and no implicit shared-case context', async () => {
  const a = await fixture(); const detail = await create(a);
  const names = ['k5_honorarios_list', 'k5_honorarios_get', 'k5_honorarios_options', 'k5_honorarios_create', 'k5_honorarios_receive', 'k5_honorarios_reverse', 'k5_honorarios_cancel'] as const;
  const stranger = await fixture();
  assert.equal((await service.listHonorarios(stranger.context)).total, 0);
  await assert.rejects(service.getHonorario(stranger.context, { agreementId: detail.agreement.id }), { code: 'NOT_FOUND' });
  for (const invocation of ['agent', 'webmcp'] as const) {
    assert.equal(dto.honorariosListDto.parse(await runCapability({ ...a.context, invocation }, 'k5_honorarios_list', {})).total, 1);
    assert.equal((await service.listHonorarios({ ...a.context, invocation })).total, 1);
  }
  assert.ok(agentTools(a.context).k5_honorarios_list);
  assert.ok(publishedCapabilities('webmcp').includes('k5_honorarios_receive'));
  const scoped = { ...a.context, caseScope: { caseId: a.caseId, homeOfficeId: a.context.officeId } };
  for (const name of names) await assert.rejects(runCapability(scoped, name, {}), { code: 'FORBIDDEN' });
  await assert.rejects(service.listHonorarios(scoped), { code: 'FORBIDDEN' });
  const sessionId = randomUUID();
  await testDb.prepare("INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES(?,?,gen_random_uuid()::text,CURRENT_TIMESTAMP+INTERVAL '1 day',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run(sessionId, a.context.userId);
  await service.listHonorarios({ ...a.context, sessionId });
  await testDb.prepare('DELETE FROM session WHERE id=?').run(sessionId);
  await assert.rejects(service.listHonorarios({ ...a.context, sessionId }), { code: 'UNAUTHENTICATED' });
  await testDb.prepare('DELETE FROM office_member WHERE user_id=?').run(a.context.userId);
  await assert.rejects(service.honorariosOptions(a.context), { code: 'FORBIDDEN' });
});

test('honorários: owner privacy, case participants across offices, case creator, revocation and owner-only mutation', async () => {
  const owner = await fixture(); const external = await fixture();
  const linked = await create(owner);
  const privateFee = dto.honorarioDetailDto.parse(await runCapability(owner.context, 'k5_honorarios_create', { ...creation(owner), caseId: null }));
  assert.equal((await service.listHonorarios(external.context)).total, 0, 'another lawyer has no finance access before taking part in the case');
  await assert.rejects(service.getHonorario(external.context, { agreementId: linked.agreement.id }), { code: 'NOT_FOUND' });
  await testDb.prepare('INSERT INTO case_participant(office_id,case_id,user_id,invited_by) VALUES(?,?,?,?)').run(owner.context.officeId, owner.caseId, external.context.userId, owner.context.userId);
  for (const context of [external.context]) {
    const visible = await service.listHonorarios(context);
    assert.equal(visible.total, 1); assert.equal(visible.summary.totalCents, 10001); assert.equal(visible.installments[0].canManage, false);
    const shared = await service.getHonorario(context, { agreementId: linked.agreement.id });
    assert.equal(shared.agreement.canManage, false);
    await assert.rejects(service.getHonorario(context, { agreementId: privateFee.agreement.id }), { code: 'NOT_FOUND' });
    await assert.rejects(runCapability(context, 'k5_honorarios_receive', receipt(linked, 1)), { code: 'NOT_FOUND' });
    await assert.rejects(runCapability(context, 'k5_honorarios_cancel', { agreementId: linked.agreement.id, reason: 'Contrato encerrado', idempotencyKey: randomUUID() }), { code: 'NOT_FOUND' });
  }
  const paid = await receive(owner, linked, 1);
  await assert.rejects(runCapability(external.context, 'k5_honorarios_reverse', { receiptId: paid.receipts[0].id, reason: 'Registro incorreto', idempotencyKey: randomUUID() }), { code: 'NOT_FOUND' });
  assert.equal((await service.getHonorario(external.context, { agreementId: linked.agreement.id })).receipts.length, 1);
  const options = await service.honorariosOptions(external.context, { caseId: owner.caseId });
  assert.ok(options.cases.some(c => c.id === owner.caseId));
  const filters = await service.honorariosOptions(external.context, { purpose: 'filter', clientId: owner.clientId, query: 'missing' });
  assert.deepEqual(filters.clients, [{ id: owner.clientId, name: 'Maria Silva' }]);
  assert.equal((await service.listHonorarios(external.context, { clientId: filters.clients[0].id })).total, 1);
  const externalFee = dto.honorarioDetailDto.parse(await runCapability(external.context, 'k5_honorarios_create', { ...creation(external), caseId: owner.caseId }));
  assert.equal(externalFee.agreement.canManage, true);
  const stored = await testDb.prepare('SELECT office_id,case_office_id FROM honorario_agreement WHERE id=?').get(externalFee.agreement.id);
  assert.deepEqual(stored, { office_id: external.context.officeId, case_office_id: owner.context.officeId });
  assert.equal((await service.getHonorario(owner.context, { agreementId: externalFee.agreement.id })).agreement.canManage, false, 'case creator can view fees tied to their case');
  await testDb.prepare('UPDATE case_participant SET revoked_at=CURRENT_TIMESTAMP WHERE case_id=?').run(owner.caseId);
  await assert.rejects(service.getHonorario(external.context, { agreementId: linked.agreement.id }), { code: 'NOT_FOUND' });
  assert.equal((await service.listHonorarios(external.context)).total, 1, 'revoked participant retains their own finance record');
  assert.equal((await service.honorariosOptions(external.context)).cases.some(c => c.id === owner.caseId), false);
  assert.equal((await service.honorariosOptions(external.context, { purpose: 'filter' })).clients.some(c => c.id === owner.clientId), false);
});

test('honorários: summaries support multiple maximum-value agreements and schemas are publishable', async () => {
  const f = await fixture();
  await create(f, 99_999_999_999); await create(f, 99_999_999_999);
  const list = await service.listHonorarios(f.context, { limit: 1 });
  assert.equal(list.total, 2); assert.equal(list.installments.length, 1);
  assert.equal(list.summary.totalCents, 199_999_999_998);
  for (const capability of Object.values(honorariosCapabilities)) {
    assert.doesNotThrow(() => z.toJSONSchema(capability.input, { io: 'input' }));
    assert.doesNotThrow(() => z.toJSONSchema(capability.output));
  }
});
