import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as honorarios from '../src/lib/honorarios/service';
import * as charges from '../src/lib/honorarios/charges';
import { emitChargeReminders } from '../src/lib/honorarios/reminders';
import { projectNextNotification } from '../src/lib/notifications/worker';
import { resolveNotificationDestination, updateNotificationPreferences } from '../src/lib/notifications/repository';
import { runCapability } from '../src/lib/agent-tools';
import type { WorkspaceContext } from '../src/lib/application/context';
import { createVaultFolder, updateVaultFolderAccess } from '../src/lib/vault';

async function fixture(dueOn = '2035-10-20') {
  const context: WorkspaceContext = { officeId: randomUUID(), userId: randomUUID() };
  const clientId = randomUUID();
  await testDb.prepare('INSERT INTO "user"(id,email,name) VALUES(?,?,?)').run(context.userId, `${context.userId}@test.local`, 'Ana Advogada');
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(context.officeId, 'Escritório Ana');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id) VALUES(?,?,?)').run(randomUUID(), context.officeId, context.userId);
  await testDb.prepare("INSERT INTO crm_client(id,office_id,name,stage,created_at,updated_at) VALUES(?,?,?,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run(clientId, context.officeId, 'Maria Cliente');
  const detail = await honorarios.createHonorario(context, { clientId, title: 'Contrato', installments: [{ amountCents: 10000, dueOn }], idempotencyKey: randomUUID() });
  return { context, installmentId: detail.installments[0].id, agreementId: detail.agreement.id };
}
const prepare = (installmentId: string, version = 0) => ({ installmentId, version, pixKey: 'financeiro@example.com', instructions: 'Titular: Ana Advogada. Envie o comprovante.', remindersEnabled: true, idempotencyKey: randomUUID() });

test('Lume prepares a charge, records a manual send, preserves replay and updates the current balance', async () => {
  const f = await fixture();
  assert.equal((await charges.getCharge(f.context, { installmentId: f.installmentId })).version, 0);
  const input = prepare(f.installmentId);
  const results = await Promise.all([runCapability(f.context, 'k5_honorarios_charge_prepare', input), runCapability(f.context, 'k5_honorarios_charge_prepare', input)]);
  assert.deepEqual(results[0], results[1]);
  const saved = await charges.getCharge(f.context, { installmentId: f.installmentId });
  assert.equal(saved.version, 1); assert.equal(saved.history.length, 1);
  assert.match(saved.message, /Maria Cliente/); assert.match(saved.message, /100,00/); assert.match(saved.message, /financeiro@example.com/);
  assert.match(saved.pdfUrl ?? '', /version=1/);
  const sentInput = { installmentId: f.installmentId, version: 1, channel: 'whatsapp' as const, idempotencyKey: randomUUID() };
  const sent = await charges.recordChargeSent(f.context, sentInput);
  assert.equal(sent.history.length, 2); assert.equal(sent.history[0].channel, 'whatsapp');
  assert.deepEqual(await charges.recordChargeSent(f.context, sentInput), sent);
  await assert.rejects(charges.prepareCharge(f.context, { ...input, instructions: 'Alterado' }), { code: 'CONFLICT' });
  await assert.rejects(charges.prepareCharge(f.context, prepare(f.installmentId)), { code: 'CONFLICT' });
  await honorarios.receiveHonorario(f.context, { installmentId: f.installmentId, amountCents: 3000, receivedOn: '2026-01-01', method: 'pix', idempotencyKey: randomUUID() });
  const partial = await charges.getCharge(f.context, { installmentId: f.installmentId });
  assert.equal(partial.installment.pendingCents, 7000); assert.match(partial.message, /70,00/);
  await honorarios.receiveHonorario(f.context, { installmentId: f.installmentId, amountCents: 7000, receivedOn: '2026-01-01', method: 'pix', idempotencyKey: randomUUID() });
  assert.equal((await charges.getCharge(f.context, { installmentId: f.installmentId })).pdfUrl, null);
  await assert.rejects(charges.recordChargeSent(f.context, { ...sentInput, idempotencyKey: randomUUID() }), { code: 'CONFLICT' });
});

test('charges enforce office, personal ownership, live membership and boleto boundaries', async () => {
  const f = await fixture(); const other = await fixture();
  await assert.rejects(charges.getCharge(other.context, { installmentId: f.installmentId }), { code: 'NOT_FOUND' });
  await assert.rejects(charges.getCharge({ ...other.context, officeId: f.context.officeId }, { installmentId: f.installmentId }), { code: 'FORBIDDEN' });
  await assert.rejects(charges.prepareCharge(f.context, { ...prepare(f.installmentId), boletoDocumentId: randomUUID() }), { code: 'INVALID' });
  assert.equal((await charges.getCharge(f.context, { installmentId: f.installmentId })).installment.canManage, true);
  await testDb.prepare('DELETE FROM office_member WHERE office_id=? AND user_id=?').run(f.context.officeId, f.context.userId);
  await assert.rejects(charges.getCharge(f.context, { installmentId: f.installmentId }), { code: 'FORBIDDEN' });
  await assert.rejects(charges.prepareCharge(f.context, prepare(f.installmentId)), { code: 'FORBIDDEN' });
});

test('charges cannot select or keep exposing an associate private boleto', async () => {
  const f = await fixture('2060-01-01'), guest = await fixture();
  const caseId = randomUUID(), documentId = randomUUID();
  await testDb.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, f.context.officeId, 'Caso da cliente', f.context.userId);
  await testDb.prepare('INSERT INTO case_participant(office_id,case_id,user_id,invited_by) VALUES(?,?,?,?)').run(f.context.officeId, caseId, guest.context.userId, f.context.userId);
  const folder = await createVaultFolder(f.context.officeId, guest.context.userId, caseId, 'Documentos', null, { visibility: 'public' });
  await testDb.prepare(`INSERT INTO vault_document(id,office_id,case_id,folder_id,scope,original_name,stored_name,mime_type,byte_size,sha256,status,created_by)
    VALUES(?,?,?,?,'case','boleto.pdf',?,'application/pdf',100,?,'ready',?)`).run(documentId, f.context.officeId, caseId, folder.id, `${documentId}.pdf`, 'a'.repeat(64), guest.context.userId);
  const input = { ...prepare(f.installmentId), boletoDocumentId: documentId };
  const prepared = await charges.prepareCharge(f.context, input);
  assert.equal(prepared.boleto?.id, documentId);
  await updateVaultFolderAccess(f.context.officeId, folder.id, guest.context.userId, { visibility: 'private' });
  assert.equal((await charges.getCharge(f.context, { installmentId: f.installmentId })).boleto, null);
  assert.equal((await charges.prepareCharge(f.context, input)).boleto, null, 'idempotent replay also checks current folder access');
  await assert.rejects(charges.prepareCharge(f.context, { ...prepare(f.installmentId, 1), boletoDocumentId: documentId }), { code: 'INVALID' });
});

test('reminders run at 9h, deduplicate, honor preferences and stop before projection after settlement', async () => {
  const f = await fixture('2040-11-20');
  await charges.prepareCharge(f.context, prepare(f.installmentId));
  assert.equal(await emitChargeReminders(testDb, '2040-11-17T11:59:00Z'), 0);
  assert.equal(await emitChargeReminders(testDb, '2040-11-17T12:00:00Z'), 1);
  assert.equal(await emitChargeReminders(testDb, '2040-11-17T15:00:00Z'), 0);
  await projectNextNotification(testDb, '2040-11-17T15:00:00Z');
  const event = await testDb.prepare('SELECT id FROM notification_event WHERE office_id=? AND source_id=?').get<{ id: string }>(f.context.officeId, f.installmentId);
  assert.ok(event);
  assert.equal(await resolveNotificationDestination(f.context, event.id, testDb), `/app/honorarios?agreementId=${f.agreementId}`);
  await updateNotificationPreferences(f.context, { categories: { honorarios: false } }, testDb);
  assert.equal(await emitChargeReminders(testDb, '2040-11-20T12:00:00Z'), 0);
  await updateNotificationPreferences(f.context, { categories: { honorarios: true } }, testDb);
  assert.equal(await emitChargeReminders(testDb, '2040-11-20T12:00:00Z'), 1);
  await honorarios.receiveHonorario(f.context, { installmentId: f.installmentId, amountCents: 10000, receivedOn: '2026-01-01', method: 'pix', idempotencyKey: randomUUID() });
  await projectNextNotification(testDb, '2040-11-20T12:00:00Z');
  const count = await testDb.prepare('SELECT COUNT(*) AS n FROM notification_recipient WHERE office_id=?').get<{ n: number }>(f.context.officeId);
  assert.equal(count?.n, 1, 'a settled charge cannot project its queued reminder');
  assert.equal(await emitChargeReminders(testDb, '2040-11-27T12:00:00Z'), 0);
});

test('weekly overdue reminders stop after opt-out, cancellation or removal of membership', async () => {
  const f = await fixture('2042-01-01');
  await charges.prepareCharge(f.context, prepare(f.installmentId));
  assert.equal(await emitChargeReminders(testDb, '2042-01-08T12:00:00Z'), 1);
  assert.equal(await emitChargeReminders(testDb, '2042-01-09T12:00:00Z'), 0);
  await charges.prepareCharge(f.context, { ...prepare(f.installmentId, 1), remindersEnabled: false });
  assert.equal(await emitChargeReminders(testDb, '2042-01-15T12:00:00Z'), 0);
  await charges.prepareCharge(f.context, prepare(f.installmentId, 2));
  await honorarios.cancelHonorario(f.context, { agreementId: f.agreementId, reason: 'Contrato encerrado', idempotencyKey: randomUUID() });
  assert.equal(await emitChargeReminders(testDb, '2042-01-15T12:00:00Z'), 0);
  const removed = await fixture('2043-01-01');
  await charges.prepareCharge(removed.context, prepare(removed.installmentId));
  await testDb.prepare('DELETE FROM office_member WHERE office_id=? AND user_id=?').run(removed.context.officeId, removed.context.userId);
  assert.equal(await emitChargeReminders(testDb, '2043-01-08T12:00:00Z'), 0);
});
