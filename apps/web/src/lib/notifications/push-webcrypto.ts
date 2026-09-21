import { rawPayload, sendPushNotification, WebPushError } from '@mmmike/web-push/send';
import { PushTransportError, type PushMessage, type PushResult, type PushSender } from './push-contract';

export class WebCryptoPushSender implements PushSender {
  constructor(private readonly config: { subject: string; publicKey: string; privateKey: string }) {}

  async send(message: PushMessage): Promise<PushResult> {
    try {
      const accepted = await sendPushNotification(
        message.subscription,
        rawPayload(message.payload),
        this.config,
        { ttl: message.ttl, topic: message.topic, urgency: 'normal', timeoutMs: 20_000 },
      );
      if (!accepted) throw new PushTransportError(410, null, 'http_410');
      return { accepted: true, statusCode: 201 };
    } catch (error) {
      if (error instanceof PushTransportError) throw error;
      if (error instanceof WebPushError) {
        throw new PushTransportError(error.statusCode, error.retryAfter, `http_${error.statusCode}`);
      }
      throw new PushTransportError(null, null, error instanceof Error ? error.name.slice(0, 80) : 'transport_error');
    }
  }
}
