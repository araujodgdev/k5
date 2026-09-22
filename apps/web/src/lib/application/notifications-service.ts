import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database } from '@/lib/database';
import type { WorkspaceContext } from './context';
import { NotificationRequestError, notificationPreferenceInput, pushSubscriptionInput } from '@/lib/notifications/contracts';
import {
  archiveNotification, getNotificationPreferences, listNotifications, listPushSubscriptions,
  markAllNotificationsRead, markNotificationRead, pushConfigurationView, registerPushSubscription,
  resolveNotificationDestination, revokePushSubscription, unreadCount, updateNotificationPreferences,
  getCaseFollowState, setCaseFollowState,
} from '@/lib/notifications/repository';

const id = z.string().min(1).max(128);
export const cutoffInput = z.strictObject({ createdAt: z.iso.datetime({ offset: true }), id });
export const testInput = z.strictObject({ subscriptionId: id });
export const caseFollowInput = z.strictObject({ caseId: id, following: z.boolean() });

export {
  notificationPreferenceInput, pushSubscriptionInput,
  archiveNotification, getNotificationPreferences, listNotifications, listPushSubscriptions,
  markAllNotificationsRead, markNotificationRead, pushConfigurationView, registerPushSubscription,
  resolveNotificationDestination, revokePushSubscription, unreadCount, updateNotificationPreferences,
  getCaseFollowState, setCaseFollowState,
};

export async function queueTestNotification(context: WorkspaceContext, subscriptionId: string) {
  const subscription = await database.prepare(`SELECT id FROM push_subscription
    WHERE id=? AND office_id=? AND user_id=? AND state='active'`)
    .get<{ id: string }>(subscriptionId, context.officeId, context.userId);
  if (!subscription) throw new NotificationRequestError(404, 'Dispositivo não encontrado.');
  const now = new Date().toISOString();
  const recent = await database.prepare(`SELECT 1 FROM notification_event
    WHERE office_id=? AND actor_user_id=? AND event_type='system.push.test' AND created_at>=? LIMIT 1`)
    .get(context.officeId, context.userId, new Date(Date.parse(now) - 60_000).toISOString());
  if (recent) throw new NotificationRequestError(429, 'Aguarde um minuto antes de enviar outro teste.');
  const expiresAt = new Date(Date.parse(now) + 10 * 60_000).toISOString();
  const eventId = randomUUID();
  await database.batch([
    database.prepare(`INSERT INTO notification_event(
      id,office_id,event_type,payload_version,source_kind,source_id,source_version,actor_user_id,
      intended_recipients_json,data_json,dedupe_key,historical,push_eligible,projection_state,created_at,expires_at,projected_at
    ) VALUES(?,?,'system.push.test',1,'system',NULL,NULL,?,?,? ,?,0,1,'projected',?,?,?)`)
      .bind(eventId, context.officeId, context.userId, JSON.stringify([context.userId]), '{}',
        `push-test:${eventId}`, now, expiresAt, now),
    database.prepare(`INSERT INTO notification_recipient(event_id,office_id,user_id,created_at) VALUES(?,?,?,?)`)
      .bind(eventId, context.officeId, context.userId, now),
    database.prepare(`INSERT INTO notification_delivery(
      id,event_id,office_id,user_id,subscription_id,group_key,state,next_attempt_at,expires_at,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,'pending',?,?,?,?)`)
      .bind(randomUUID(), eventId, context.officeId, context.userId, subscriptionId, `test:${eventId}`, now, expiresAt, now, now),
  ]);
  return { queued: true, notificationId: eventId };
}
