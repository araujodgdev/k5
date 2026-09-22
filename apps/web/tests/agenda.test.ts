import { testDb } from './test-setup';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { z } from 'zod';
import { agentTools, runCapability } from '../src/lib/agent-tools';
import { capabilities, type CapabilityName } from '../src/lib/capabilities/contracts';
import { agendaCapabilities } from '../src/lib/capabilities/agenda';
import type { WorkspaceContext } from '../src/lib/application/context';

function fixture(role: WorkspaceContext['role'] = 'lawyer') {
  const officeId = randomUUID(); const userId = randomUUID(); const caseId = randomUUID();
  testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@test.local`, 'Advogado');
  testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório');
  testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), officeId, userId, role);
  testDb.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, officeId, 'Caso de teste', userId);
  return { context: { officeId, userId, role }, caseId };
}
async function call<N extends CapabilityName>(context: WorkspaceContext, name: N, input: unknown) {
  return capabilities[name].output.parse(await runCapability(context, name, input));
}

test('agenda: clients, links, partial updates and stale versions preserve data', async () => {
  const { context, caseId } = fixture();
  const { client } = await call(context, 'k5_crm_create_client', { name: 'Maria Silva', email: 'maria@test.local', notes: 'Primeiro atendimento', stage: 'active', caseIds: [caseId] }) as z.output<typeof agendaCapabilities.k5_crm_create_client.output>;
  const updated = await call(context, 'k5_crm_update_client', { clientId: client.id, version: 1, phone: '11999999999' }) as { client: typeof client };
  assert.equal(updated.client.email, client.email);
  assert.equal(updated.client.notes, client.notes);
  assert.equal(updated.client.stage, 'active');
  assert.deepEqual(updated.client.caseIds, [caseId]);
  await assert.rejects(call(context, 'k5_crm_update_client', { clientId: client.id, version: 1, name: 'Nome antigo', caseIds: [] }), { code: 'CONFLICT' });
  const current = await call(context, 'k5_crm_get_client', { clientId: client.id }) as { client: typeof client };
  const destination = await call(context, 'k5_ui_open_resource', { resourceType: 'client', resourceId: client.id });
  assert.deepEqual(destination, { path: `/app/agenda/clients/${client.id}` });
  assert.deepEqual(current.client.caseIds, [caseId]);
  const page = await call(context, 'k5_crm_list_clients', { caseId, query: 'Maria', limit: 1, offset: 0 }) as { total: number };
  assert.equal(page.total, 1);
});

test('agenda: office isolation covers reads, updates and every foreign reference', async () => {
  const a = fixture(); const b = fixture();
  const { client } = await call(b.context, 'k5_crm_create_client', { name: 'Cliente externo' }) as z.output<typeof agendaCapabilities.k5_crm_create_client.output>;
  const { activity } = await call(b.context, 'k5_agenda_create_activity', { kind: 'task', title: 'Externa' }) as z.output<typeof agendaCapabilities.k5_agenda_create_activity.output>;
  for (const [name, input] of [
    ['k5_crm_get_client', { clientId: client.id }],
    ['k5_crm_update_client', { clientId: client.id, version: 1, name: 'Intrusão' }],
    ['k5_crm_create_client', { name: 'Local', caseIds: [b.caseId] }],
    ['k5_agenda_get_activity', { activityId: activity.id }],
    ['k5_agenda_update_activity', { activityId: activity.id, version: 1, status: 'completed' }],
    ...[{ clientId: client.id }, { caseId: b.caseId }, { assigneeId: b.context.userId }].map(ref => ['k5_agenda_create_activity', { kind: 'task', title: 'Inválida', ...ref }]),
  ] as [CapabilityName, unknown][]) await assert.rejects(call(a.context, name, input), { code: 'NOT_FOUND' });
  const listed = await call(a.context, 'k5_agenda_list_activities', {}) as { activities: unknown[] };
  assert.deepEqual(listed.activities, []);
  const clients = await call(a.context, 'k5_crm_list_clients', {}) as { clients: unknown[] };
  assert.deepEqual(clients.clients, []);
});

test('agenda: reviewer tools are read only and revoked roles are checked at execution', async () => {
  const { context } = fixture('reviewer');
  const tools = agentTools(context);
  assert.ok(tools.k5_agenda_list_activities);
  assert.ok(!tools.k5_agenda_create_activity);
  for (const [name, capability] of Object.entries(agendaCapabilities)) {
    if (capability.effect === 'write') await assert.rejects(call(context, name as CapabilityName, {}), { code: 'FORBIDDEN' });
    assert.doesNotThrow(() => z.toJSONSchema(capability.input, { io: 'input' }));
    assert.doesNotThrow(() => z.toJSONSchema(capability.output));
  }
  const writer = fixture();
  testDb.prepare("UPDATE office_member SET role='reviewer' WHERE user_id=?").run(writer.context.userId);
  await assert.rejects(call(writer.context, 'k5_agenda_create_activity', { kind: 'task', title: 'Revogada' }), { code: 'FORBIDDEN' });
});

test('agenda: UTC normalization, overlapping meetings, civil dates and undated tasks', async () => {
  const { context } = fixture();
  const { activity } = await call(context, 'k5_agenda_create_activity', { kind: 'meeting', title: 'Reunião noturna', startsAt: '2026-09-20T23:30:00-03:00', endsAt: '2026-09-21T01:00:00-03:00' }) as z.output<typeof agendaCapabilities.k5_agenda_create_activity.output>;
  assert.equal(activity.startsAt, '2026-09-21T02:30:00.000Z');
  await call(context, 'k5_agenda_create_activity', { kind: 'task', title: 'Sem data' });
  await call(context, 'k5_agenda_create_activity', { kind: 'task', title: 'Tarefa do dia', dueOn: '2026-09-21' });
  const day = await call(context, 'k5_agenda_list_activities', { dueFrom: '2026-09-21', dueTo: '2026-09-21', from: '2026-09-21T00:00:00-03:00', to: '2026-09-22T00:00:00-03:00' }) as { total: number };
  assert.equal(day.total, 2);
  const tasks = await call(context, 'k5_agenda_list_activities', { kind: 'task', limit: 1, offset: 1 }) as { total: number; activities: { title: string }[] };
  assert.equal(tasks.total, 2); assert.equal(tasks.activities[0].title, 'Sem data');
  for (const data of [
    { kind: 'meeting', startsAt: null, endsAt: null },
    { kind: 'meeting', startsAt: '2026-09-21T10:00:00Z', endsAt: '2026-09-21T09:00:00Z' },
    { kind: 'task', dueOn: '2026-02-30' },
    { kind: 'task', startsAt: '2026-09-21T10:00:00Z' },
    { kind: 'meeting', startsAt: '2026-09-21T10:00:00', endsAt: '2026-09-21T11:00:00' },
  ]) await assert.rejects(call(context, 'k5_agenda_create_activity', { title: 'Inválida', ...data }));
});

test('agenda: completion preserves scheduling and links; retries and concurrent edits', async () => {
  const { context, caseId } = fixture();
  const input = { kind: 'task', title: 'Revisar contrato', caseId, assigneeId: context.userId, dueOn: '2026-09-21', notes: 'Contato por telefone', idempotencyKey: randomUUID() };
  const { activity } = await call(context, 'k5_agenda_create_activity', input) as z.output<typeof agendaCapabilities.k5_agenda_create_activity.output>;
  const retry = await call(context, 'k5_agenda_create_activity', input) as { activity: typeof activity };
  assert.equal(retry.activity.id, activity.id);
  const { activity: completed } = await call(context, 'k5_agenda_update_activity', { activityId: activity.id, version: 1, status: 'completed' }) as { activity: typeof activity };
  assert.equal(completed.dueOn, activity.dueOn); assert.equal(completed.caseId, caseId); assert.equal(completed.notes, activity.notes); assert.equal(completed.assigneeId, context.userId);
  const results = await Promise.allSettled(['pending', 'cancelled'].map(status => call(context, 'k5_agenda_update_activity', { activityId: activity.id, version: 2, status })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const listed = await call(context, 'k5_agenda_list_activities', {}) as { total: number };
  assert.equal(listed.total, 1);
});

test('agenda: simultaneous create retries commit exactly one client and one activity', async () => {
  const { context, caseId } = fixture();
  const clientInput = { name: 'Cliente único', caseIds: [caseId], idempotencyKey: randomUUID() };
  const clients = await Promise.all([call(context, 'k5_crm_create_client', clientInput), call(context, 'k5_crm_create_client', clientInput)]) as z.output<typeof agendaCapabilities.k5_crm_create_client.output>[];
  assert.equal(clients[0].client.id, clients[1].client.id);
  assert.equal(testDb.prepare('SELECT count(*) AS n FROM crm_client WHERE office_id=?').get(context.officeId)!.n, 1);
  const activityInput = { kind: 'task', title: 'Atividade única', idempotencyKey: randomUUID() };
  const activities = await Promise.all([call(context, 'k5_agenda_create_activity', activityInput), call(context, 'k5_agenda_create_activity', activityInput)]) as z.output<typeof agendaCapabilities.k5_agenda_create_activity.output>[];
  assert.equal(activities[0].activity.id, activities[1].activity.id);
  assert.equal(testDb.prepare('SELECT count(*) AS n FROM agenda_activity WHERE office_id=?').get(context.officeId)!.n, 1);
});
