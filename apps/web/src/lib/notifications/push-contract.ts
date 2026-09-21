export type PushSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
};

export type PushMessage = {
  subscription: PushSubscription;
  payload: string;
  ttl: number;
  topic: string;
};

export type PushResult = { accepted: true; statusCode: number };

export class PushTransportError extends Error {
  constructor(
    public readonly statusCode: number | null,
    public readonly retryAfter: string | null,
    public readonly code: string,
  ) { super(code); }
}

export interface PushSender {
  send(message: PushMessage): Promise<PushResult>;
}
