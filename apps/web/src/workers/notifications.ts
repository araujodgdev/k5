import { d1Database, type D1Binding } from '@/lib/db/d1';
import { cleanNotificationRetention, deliverNextNotification, emitNextReminder, projectNextNotification, reconcileNotificationReminders } from '@/lib/notifications/worker';
import { WebCryptoPushSender } from '@/lib/notifications/push-webcrypto';

type QueueMessage = { body: { kind?: string }; ack(): void; retry(): void };
type QueueBatch = { messages: QueueMessage[] };
type QueueBinding = { send(message: { kind: string }): Promise<void> };
type Env = {
  DB: D1Binding;
  NOTIFICATION_QUEUE: QueueBinding;
  K5_VAPID_SUBJECT: string;
  K5_VAPID_PUBLIC_KEY: string;
  K5_VAPID_PRIVATE_KEY: string;
};

const notificationWorker = {
  async scheduled(_controller: unknown, env: Env) {
    const db = d1Database(env.DB);
    const now = new Date().toISOString();
    if (now.slice(14, 16) === '00') await cleanNotificationRetention(db, now);
    await reconcileNotificationReminders(db, now, 20);
    for (let index = 0; index < 10 && await emitNextReminder(db, now); index++);
    for (let index = 0; index < 20 && await projectNextNotification(db, now); index++);
    // Queue messages are acceleration hints. A later Cron always sweeps D1 again if this send fails.
    await env.NOTIFICATION_QUEUE.send({ kind: 'delivery-sweep' });
  },

  async queue(batch: QueueBatch, env: Env) {
    const db = d1Database(env.DB);
    const sender = new WebCryptoPushSender({
      subject: env.K5_VAPID_SUBJECT,
      publicKey: env.K5_VAPID_PUBLIC_KEY,
      privateKey: env.K5_VAPID_PRIVATE_KEY,
    });
    for (const message of batch.messages) {
      try {
        for (let index = 0; index < 20 && await deliverNextNotification(db, sender); index++);
        message.ack();
      } catch { message.retry(); }
    }
  },

  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};

export default notificationWorker;
