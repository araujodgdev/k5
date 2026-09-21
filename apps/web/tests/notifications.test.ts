import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { testDatabase, testDb } from './test-setup';
import type { WorkspaceContext } from '../src/lib/application/context';
import { createActivity } from '../src/lib/application/agenda-service';
import {
  getCaseFollowState, getNotificationPreferences, listNotifications, markAllNotificationsRead,
  registerPushSubscription, setCaseFollowState, unreadCount,
} from '../src/lib/notifications/repository';
import { revokePushSubscriptionsForUser } from '../src/lib/notifications/revocation';
import { eventInsertStatement } from '../src/lib/notifications/events';
import {
  cleanNotificationRetention, deliverNextNotification, emitNextReminder, projectNextNotification,
  reconcileNotificationReminders,
} from '../src/lib/notifications/worker';
import type { PushSender } from '../src/lib/notifications/push-contract';

function notificationFixture(role: WorkspaceContext['role'] = 'lawyer') {
  const officeId = randomUUID();
  const actorId = randomUUID();
  const recipientId = randomUUID();
  testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(actorId, `${actorId}@test.local`, 'Autora');
  testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(recipientId, `${recipientId}@test.local`, 'Responsável');
  testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório de notificações');
  testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), officeId, actorId, role);
  testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), officeId, recipientId, role);
  return {
    officeId, actorId, recipientId,
    actor: { officeId, userId: actorId, role } satisfies WorkspaceContext,
    recipient: { officeId, userId: recipientId, role } satisfies WorkspaceContext,
  };
}

test('notifications: an accepted agenda mutation emits once and projects only to the intended person', async () => {
  const value = notificationFixture();
  const key = randomUUID();
  const first = await createActivity(value.actor, { kind: 'task', title: 'Revisar contrato', assigneeId: value.recipientId, idempotencyKey: key });
  const replay = await createActivity(value.actor, { kind: 'task', title: 'Revisar contrato', assigneeId: value.recipientId, idempotencyKey: key });
  assert.equal(replay.activity.id, first.activity.id);
  assert.equal(testDb.prepare('SELECT count(*) AS total FROM notification_event WHERE office_id=?').get(value.officeId)!.total, 1);

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
  const value = notificationFixture();
  const { activity } = await createActivity(value.actor, { kind: 'task', title: 'Protocolar resposta', dueOn: '2026-09-22' });
  await getNotificationPreferences(value.actor, testDatabase);
  assert.equal(await reconcileNotificationReminders(testDatabase, '2026-09-21T12:00:00.000Z'), 1);
  const reminder = testDb.prepare('SELECT due_at,state FROM notification_reminder WHERE activity_id=?').get(activity.id) as { due_at: string; state: string };
  assert.equal(reminder.due_at, '2026-09-22T12:00:00.000Z');
  assert.equal(reminder.state, 'scheduled');
  assert.equal(await emitNextReminder(testDatabase, '2026-09-22T12:00:00.000Z'), true);
  assert.equal(await emitNextReminder(testDatabase, '2026-09-22T12:00:00.000Z'), false);
  await projectNextNotification(testDatabase, '2026-09-22T12:00:00.000Z');
  const inbox = await listNotifications(value.actor, { unreadOnly: false, limit: 25 }, testDatabase);
  assert.equal(inbox.notifications[0].eventType, 'agenda.task.due');

  await reconcileNotificationReminders(testDatabase, '2026-09-22T12:01:00.000Z');
  assert.equal((testDb.prepare('SELECT state FROM notification_reminder WHERE activity_id=?').get(activity.id) as { state: string }).state, 'emitted');
});

test('notifications: subscriptions are encrypted, delivery is generic, and logout generation blocks stale reactivation', async () => {
  const value = notificationFixture('reviewer');
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
  const stored = testDb.prepare('SELECT encrypted_subscription FROM push_subscription WHERE id=?').get(subscriptionId) as { encrypted_subscription: string };
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
  assert.equal(testDb.prepare('SELECT state FROM notification_delivery WHERE subscription_id=?').get(subscriptionId)!.state, 'accepted');

  await revokePushSubscriptionsForUser(testDatabase, value.recipientId);
  assert.equal(testDb.prepare('SELECT state FROM push_subscription WHERE id=?').get(subscriptionId)!.state, 'revoked');
  await assert.rejects(registerPushSubscription(value.recipient, input, testDatabase), /autorização.*expirou/i);
});

test('notifications: case following is personal and the inbox rollout switch hides projected rows', async () => {
  const value = notificationFixture('reviewer');
  const caseId = randomUUID();
  testDb.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)')
    .run(caseId, value.officeId, 'Caso acompanhado', value.actorId);
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
  testDb.prepare('UPDATE notification_rollout SET inbox_enabled=0 WHERE office_id=?').run(value.officeId);
  assert.equal((await listNotifications(value.recipient, { unreadOnly: false, limit: 25 }, testDatabase)).notifications.length, 0);
  assert.equal(await unreadCount(value.recipient, testDatabase), 0);
  testDb.prepare('UPDATE notification_rollout SET capture_enabled=0 WHERE office_id=?').run(value.officeId);
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
  const value = notificationFixture();
  const createdAt = '2026-05-01T12:00:00.000Z';
  const eventId = randomUUID();
  await testDatabase.batch([eventInsertStatement(testDatabase, {
    id: eventId, officeId: value.officeId, eventType: 'system.push.test', sourceKind: 'system', sourceId: null,
    sourceVersion: 1, actorUserId: null, intendedRecipientIds: [value.recipientId], data: { transient: 'copy' },
    dedupeKey: `retention:${eventId}`, createdAt, expiresAt: null,
  })]);
  await projectNextNotification(testDatabase, createdAt);
  assert.ok(await cleanNotificationRetention(testDatabase, '2026-09-21T12:00:00.000Z'));
  assert.equal(testDb.prepare('SELECT count(*) AS total FROM notification_recipient WHERE event_id=?').get(eventId)!.total, 0);
  assert.equal(testDb.prepare('SELECT data_json FROM notification_event WHERE id=?').get(eventId)!.data_json, '{}');
});
