import webPush from 'web-push';
import { PushTransportError, type PushMessage, type PushResult, type PushSender } from './push-contract';

export class NodeWebPushSender implements PushSender {
  private readonly details: { subject: string; publicKey: string; privateKey: string };

  constructor(config = {
    subject: process.env.K5_VAPID_SUBJECT ?? '',
    publicKey: process.env.K5_VAPID_PUBLIC_KEY ?? '',
    privateKey: process.env.K5_VAPID_PRIVATE_KEY ?? '',
  }) {
    if (!/^mailto:[^\s@]+@[^\s@]+$|^https:\/\//.test(config.subject)
      || !config.publicKey.trim() || !config.privateKey.trim()) {
      throw new Error('Configure K5_VAPID_SUBJECT, K5_VAPID_PUBLIC_KEY e K5_VAPID_PRIVATE_KEY.');
    }
    this.details = config;
  }

  async send(message: PushMessage): Promise<PushResult> {
    try {
      const response = await webPush.sendNotification(message.subscription, message.payload, {
        TTL: message.ttl,
        topic: message.topic,
        urgency: 'normal',
        vapidDetails: this.details,
      });
      return { accepted: true, statusCode: response.statusCode };
    } catch (error) {
      const value = error as { statusCode?: number; headers?: Record<string, string>; code?: string };
      throw new PushTransportError(
        typeof value.statusCode === 'number' ? value.statusCode : null,
        value.headers?.['retry-after'] ?? null,
        typeof value.code === 'string' ? value.code.slice(0, 80) : 'transport_error',
      );
    }
  }
}

export { PushTransportError, type PushMessage, type PushResult, type PushSender } from './push-contract';
