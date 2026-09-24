import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { testDatabase, testDb } from './test-setup';
import type { WorkspaceContext } from '../src/lib/application/context';
import { createActivity } from '../src/lib/application/agenda-service';
import {
  archiveNotification, getCaseFollowState, getNotificationPreferences, listNotifications, markAllNotificationsRead,
  markNotificationRead, registerPushSubscription, setCaseFollowState, unreadCount,
} from '../src/lib/notifications/repository';
import { revokePushSubscriptionsForUser } from '../src/lib/notifications/revocation';
import { eventInsertStatement } from '../src/lib/notifications/events';
import {
  cleanNotificationRetention, deliverNextNotification, emitNextReminder, projectNextNotification,
  reconcileNotificationReminders,
} from '../src/lib/notifications/worker';
import type { PushSender } from '../src/lib/notifications/push-contract';
import type { Database } from '../src/lib/database';

async function notificationFixture(role: WorkspaceContext['role'] = 'lawyer') {
  const officeId = randomUUID();
  const actorId = randomUUID();
  const recipientId = randomUUID();
  (await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(actorId, `${actorId}@test.local`, 'Autora'));
  (await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(recipientId, `${recipientId}@test.local`, 'Responsável'));
  (await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório de notificações'));
  (await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), officeId, actorId, role));
  (await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), officeId, recipientId, role));
  return {
    officeId, actorId, recipientId,
    actor: { officeId, userId: actorId, role } satisfies WorkspaceContext,
    recipient: { officeId, userId: recipientId, role } satisfies WorkspaceContext,
  };
}

test('notifications: unread polls seed missing defaults but never write when both exist', async () => {
  const value = (await notificationFixture());
  let batches = 0;
  const db: Database = { ...testDatabase, batch: async (statements) => {
    batches++;
    return testDatabase.batch(statements);
  } };
  assert.equal(await unreadCount(value.actor, db), 0);
  assert.equal(batches, 1);
  await unreadCount(value.actor, db);
  assert.equal(batches, 1);
  (await testDb.prepare('DELETE FROM notification_preference WHERE office_id=? AND user_id=?').run(value.officeId, value.actorId));
  await unreadCount(value.actor, db);
  assert.equal(batches, 2);
  (await testDb.prepare('DELETE FROM notification_rollout WHERE office_id=?').run(value.officeId));
  await unreadCount(value.actor, db);
  assert.equal(batches, 3);
});

test('notifications: reconciliation advances beyond its limit and revisits timezone changes', async () => {
  const value = (await notificationFixture());
  // Isolate this global worker scan from fixtures belonging to other tests.
  (await testDb.exec('UPDATE notification_rollout SET reminders_enabled=0'));
  await getNotificationPreferences(value.actor, testDatabase);
  const ids: string[] = [];
  for (let index = 0; index < 5; index++) {
    const { activity } = await createActivity(value.actor, { kind: 'task', title: `Tarefa ${index}`, dueOn: '2026-09-22' });
    ids.push(activity.id);
  }
  const now = '2026-09-21T12:00:00.000Z';
  assert.equal(await reconcileNotificationReminders(testDatabase, now, 2), 2);
  assert.equal(await reconcileNotificationReminders(testDatabase, now, 2), 2);
  assert.equal(await reconcileNotificationReminders(testDatabase, now, 2), 1);
  assert.equal(await reconcileNotificationReminders(testDatabase, now, 2), 0);
  assert.equal((await testDb.prepare('SELECT count(*) AS total FROM notification_reminder WHERE office_id=?').get(value.officeId))!.total, ids.length);
  (await testDb.prepare("UPDATE notification_preference SET timezone='UTC' WHERE office_id=?").run(value.officeId));
  for (let page = 0; page < 3; page++) await reconcileNotificationReminders(testDatabase, now, 2);
  assert.equal((await testDb.prepare("SELECT count(*) AS total FROM notification_reminder WHERE office_id=? AND timezone='UTC' AND state='scheduled'").get(value.officeId))!.total, ids.length);
  assert.equal((await testDb.prepare("SELECT count(*) AS total FROM notification_reminder WHERE office_id=? AND timezone<>'UTC' AND state='cancelled'").get(value.officeId))!.total, ids.length);
  (await testDb.prepare('UPDATE notification_rollout SET reminders_enabled=0 WHERE office_id=?').run(value.officeId));
  (await testDb.prepare("UPDATE notification_reminder SET state='cancelled' WHERE office_id=?").run(value.officeId));
});

test('notifications: an accepted agenda mutation emits once and projects only to the intended person', async () => {
  const value = (await notificationFixture());
  const key = randomUUID();
  const first = await createActivity(value.actor, { kind: 'task', title: 'Revisar contrato', assigneeId: value.recipientId, idempotencyKey: key });
  const replay = await createActivity(value.actor, { kind: 'task', title: 'Revisar contrato', assigneeId: value.recipientId, idempotencyKey: key });
  assert.equal(replay.activity.id, first.activity.id);
  assert.equal((await testDb.prepare('SELECT count(*) AS total FROM notification_event WHERE office_id=?').get(value.officeId))!.total, 1);

  assert.equal(await projectNextNotification(testDatabase, '2026-09-21T15:00:00.000Z'), true);
  const recipient = await listNotifications(value.recipient, { unreadOnly: false, limit: 25 }, testDatabase);
  const actor = await listNotifications(value.actor, { unreadOnly: false, limit: 25 }, testDatabase);
  assert.equal(recipient.notifications.length, 1);
  assert.equal(recipient.notifications[0].eventType, 'agenda.activity.assigned');
  assert.equal(actor.notifications.length, 0);

  const cutoff = recipient.notifications[0];
  assert.equal(await markAllNotificationsRead(value.recipient, { createdAt: cutoff.createdAt, id: cutoff.id }, testDatabase), 1);
  assert.equal(await unreadCount(value.recipient, testDatabase), 0);
});

test('notifications: civil-date reminders use the saved timezone and recover without duplicating', async () => {
  const value = (await notificationFixture());
  const { activity } = await createActivity(value.actor, { kind: 'task', title: 'Protocolar resposta', dueOn: '2026-09-22' });
  await getNotificationPreferences(value.actor, testDatabase);
  assert.equal(await reconcileNotificationReminders(testDatabase, '2026-09-21T12:00:00.000Z'), 1);
  const reminder = (await testDb.prepare('SELECT due_at,state FROM notification_reminder WHERE activity_id=?').get(activity.id)) as { due_at: string; state: string };
  assert.equal(reminder.due_at, '2026-09-22T12:00:00.000Z');
  assert.equal(reminder.state, 'scheduled');
  assert.equal(await emitNextReminder(testDatabase, '2026-09-22T12:00:00.000Z'), true);
  assert.equal(await emitNextReminder(testDatabase, '2026-09-22T12:00:00.000Z'), false);
  await projectNextNotification(testDatabase, '2026-09-22T12:00:00.000Z');
  const inbox = await listNotifications(value.actor, { unreadOnly: false, limit: 25 }, testDatabase);
  assert.equal(inbox.notifications[0].eventType, 'agenda.task.due');

  await reconcileNotificationReminders(testDatabase, '2026-09-22T12:01:00.000Z');
  assert.equal(((await testDb.prepare('SELECT state FROM notification_reminder WHERE activity_id=?').get(activity.id)) as { state: string }).state, 'emitted');
});

test('notifications: subscriptions are encrypted, delivery is generic, and logout generation blocks stale reactivation', async () => {
  const value = (await notificationFixture('reviewer'));
  process.env.K5_VAPID_KEY_ID = 'test-key';
  process.env.K5_VAPID_PUBLIC_KEY = 'test-public';
  const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
  const input = {
    deviceId: randomUUID(), deviceLabel: 'Navegador de teste', endpoint, expirationTime: null,
    keys: { p256dh: Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString('base64url'), auth: randomBytes(16).toString('base64url') },
    vapidKeyId: 'test-key', authorizationGeneration: 1,
  };
  const registered = await registerPushSubscription(value.recipient, input, testDatabase);
  const subscriptionId = String((registered.subscriptions[0] as { id: string }).id);
  const stored = (await testDb.prepare('SELECT encrypted_subscription FROM push_subscription WHERE id=?').get(subscriptionId)) as { encrypted_subscription: string };
  assert.equal(stored.encrypted_subscription.includes(endpoint), false);

  const now = '2026-09-21T16:00:00.000Z';
  await testDatabase.batch([eventInsertStatement(testDatabase, {
    id: randomUUID(), officeId: value.officeId, eventType: 'system.push.test', sourceKind: 'system', sourceId: null,
    sourceVersion: 1, actorUserId: value.actorId, intendedRecipientIds: [value.recipientId], data: {},
    dedupeKey: randomUUID(), createdAt: now, expiresAt: '2026-09-21T17:00:00.000Z',
  })]);
  await projectNextNotification(testDatabase, now);
  let deliveredPayload = '';
  const sender: PushSender = { send: async (message) => { deliveredPayload = message.payload; return { accepted: true, statusCode: 201 }; } };
  assert.equal(await deliverNextNotification(testDatabase, sender, now), true);
  assert.deepEqual(Object.keys(JSON.parse(deliveredPayload)).sort(), ['expiresAt', 'id', 'tag', 'version']);
  assert.equal((await testDb.prepare('SELECT state FROM notification_delivery WHERE subscription_id=?').get(subscriptionId))!.state, 'accepted');

  await revokePushSubscriptionsForUser(testDatabase, value.recipientId);
  assert.equal((await testDb.prepare('SELECT state FROM push_subscription WHERE id=?').get(subscriptionId))!.state, 'revoked');
  await assert.rejects(registerPushSubscription(value.recipient, input, testDatabase), /autorização.*expirou/i);
});

test('notifications: read or archived items leave the inbox for the archived list', async () => {
  const value = (await notificationFixture());
  const caseId = randomUUID();
  (await testDb.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)')
    .run(caseId, value.officeId, 'Caso acompanhado', value.actorId));
  await setCaseFollowState(value.recipient, caseId, true, testDatabase);
  const now = '2026-09-22T12:00:00.000Z';
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  await testDatabase.batch(ids.map((id, index) => eventInsertStatement(testDatabase, {
    id, officeId: value.officeId, eventType: 'judicial.publication.new', sourceKind: 'case', sourceId: caseId,
    sourceVersion: index + 1, actorUserId: null, intendedRecipientIds: [value.recipientId], data: { caseName: 'Caso acompanhado' },
    dedupeKey: randomUUID(), createdAt: new Date(Date.parse(now) - index * 1000).toISOString(), expiresAt: null,
  })));
  for (let index = 0; index < ids.length; index++) await projectNextNotification(testDatabase, now);
  await markNotificationRead(value.recipient, ids[0], testDatabase);
  await archiveNotification(value.recipient, ids[1], testDatabase);
  const inbox = await listNotifications(value.recipient, { unreadOnly: true, limit: 25 }, testDatabase);
  const archived = await listNotifications(value.recipient, { unreadOnly: false, archived: true, limit: 25 }, testDatabase);
  assert.deepEqual(inbox.notifications.map(({ id }) => id), [ids[2]]);
  assert.deepEqual(archived.notifications.map(({ id }) => id).sort(), [ids[0], ids[1]].sort());
  assert.deepEqual((await listNotifications(value.actor, { unreadOnly: false, archived: true, limit: 25 }, testDatabase)).notifications, []);
});

test('notifications: case following is personal and the inbox rollout switch hides projected rows', async () => {
  const value = (await notificationFixture('reviewer'));
  const caseId = randomUUID();
  (await testDb.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)')
    .run(caseId, value.officeId, 'Caso acompanhado', value.actorId));
  assert.equal(await getCaseFollowState(value.recipient, caseId, testDatabase), false);
  assert.deepEqual(await setCaseFollowState(value.recipient, caseId, true, testDatabase), { following: true });
  assert.equal(await getCaseFollowState(value.actor, caseId, testDatabase), false);

  const now = '2026-09-21T16:00:00.000Z';
  await testDatabase.batch([eventInsertStatement(testDatabase, {
    id: randomUUID(), officeId: value.officeId, eventType: 'judicial.publication.new', sourceKind: 'case', sourceId: caseId,
    sourceVersion: 1, actorUserId: null, intendedRecipientIds: [value.recipientId], data: { caseName: 'Caso acompanhado' },
    dedupeKey: randomUUID(), createdAt: now, expiresAt: null,
  })]);
  await projectNextNotification(testDatabase, now);
  assert.equal((await listNotifications(value.recipient, { unreadOnly: false, limit: 25 }, testDatabase)).notifications.length, 1);
  (await testDb.prepare('UPDATE notification_rollout SET inbox_enabled=0 WHERE office_id=?').run(value.officeId));
  assert.equal((await listNotifications(value.recipient, { unreadOnly: false, limit: 25 }, testDatabase)).notifications.length, 0);
  assert.equal(await unreadCount(value.recipient, testDatabase), 0);
  (await testDb.prepare('UPDATE notification_rollout SET capture_enabled=0 WHERE office_id=?').run(value.officeId));
  const blockedEvent = randomUUID();
  const [capture] = await testDatabase.batch([eventInsertStatement(testDatabase, {
    id: blockedEvent, officeId: value.officeId, eventType: 'judicial.publication.new', sourceKind: 'case', sourceId: caseId,
    sourceVersion: 2, actorUserId: null, intendedRecipientIds: [value.recipientId], data: {},
    dedupeKey: `capture-off:${blockedEvent}`, createdAt: now, expiresAt: null,
  })]);
  assert.equal(capture.changes, 0);
  assert.deepEqual(await setCaseFollowState(value.recipient, caseId, false, testDatabase), { following: false });
});

test('notifications: retention removes old personal and operational data but keeps the dedupe event', async () => {
  const value = (await notificationFixture());
  const createdAt = '2026-05-01T12:00:00.000Z';
  const eventId = randomUUID();
  await testDatabase.batch([eventInsertStatement(testDatabase, {
    id: eventId, officeId: value.officeId, eventType: 'system.push.test', sourceKind: 'system', sourceId: null,
    sourceVersion: 1, actorUserId: null, intendedRecipientIds: [value.recipientId], data: { transient: 'copy' },
    dedupeKey: `retention:${eventId}`, createdAt, expiresAt: null,
  })]);
  await projectNextNotification(testDatabase, createdAt);
  assert.ok(await cleanNotificationRetention(testDatabase, '2026-09-21T12:00:00.000Z'));
  assert.equal((await testDb.prepare('SELECT count(*) AS total FROM notification_recipient WHERE event_id=?').get(eventId))!.total, 0);
  assert.equal((await testDb.prepare('SELECT data_json FROM notification_event WHERE id=?').get(eventId))!.data_json, '{}');
});

test('notifications: mark-all cancels only eligible deliveries in a two-statement batch', async () => {
  const value = (await notificationFixture());
  process.env.K5_VAPID_KEY_ID = 'test-key';
  process.env.K5_VAPID_PUBLIC_KEY = 'test-public';
  await registerPushSubscription(value.recipient, {
    deviceId: randomUUID(), endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
    expirationTime: null,
    keys: { p256dh: Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString('base64url'), auth: randomBytes(16).toString('base64url') },
    vapidKeyId: 'test-key', authorizationGeneration: 1,
  }, testDatabase);
  const now = '2026-09-23T12:00:00.000Z';
  const ids = ['a', 'b', 'c', 'd', 'e'].map((prefix) => `${prefix}-${randomUUID()}`);
  for (const id of ids) {
    await testDatabase.batch([eventInsertStatement(testDatabase, {
      id, officeId: value.officeId, eventType: 'system.push.test', sourceKind: 'system', sourceId: null,
      sourceVersion: 1, actorUserId: null, intendedRecipientIds: [value.recipientId, value.actorId],
      data: {}, dedupeKey: id, createdAt: now, expiresAt: '2026-09-24T12:00:00.000Z',
    })]);
  }
  while (await projectNextNotification(testDatabase, now)) { /* Drain global projection. */ }
  (await testDb.prepare('UPDATE notification_recipient SET archived_at=? WHERE event_id=? AND user_id=?').run(now, ids[1], value.recipientId));
  (await testDb.prepare('UPDATE notification_recipient SET read_at=? WHERE event_id=? AND user_id=?').run(now, ids[2], value.recipientId));
  (await testDb.prepare("UPDATE notification_delivery SET state='retry' WHERE event_id=?").run(ids[3]));
  let statementCount = 0;
  const db: Database = { ...testDatabase, batch: async (statements) => {
    statementCount = statements.length;
    return testDatabase.batch(statements);
  } };
  assert.equal(await markAllNotificationsRead(value.recipient, { createdAt: now, id: ids[3] }, db), 2);
  assert.equal(statementCount, 2);
  const states = (await testDb.prepare('SELECT state FROM notification_delivery WHERE office_id=? ORDER BY event_id').all(value.officeId)).map((row) => row.state);
  assert.deepEqual(states, ['cancelled', 'pending', 'pending', 'cancelled', 'pending']);
  assert.equal((await testDb.prepare('SELECT count(*) AS total FROM notification_recipient WHERE office_id=? AND user_id=? AND read_at IS NULL').get(value.officeId, value.actorId))!.total, 5);
});
