import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/*
 * A small AbacatePay v2 client (https://docs.abacatepay.com). One base URL serves both
 * environments: a Dev mode key simulates payments, a production key charges for real. Amounts are
 * in centavos and every response is wrapped as { data, success, error }.
 */

const BASE_URL = 'https://api.abacatepay.com/v2';

/**
 * AbacatePay signs every webhook body with HMAC-SHA256 under this published key (not a secret of
 * ours), and sends the base64 digest in `X-Webhook-Signature`.
 */
const WEBHOOK_SIGNING_KEY = 't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';

export type CheckoutStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED' | 'REFUNDED';

export type AbacateCheckout = {
  id: string;
  url: string;
  amount: number;
  status: CheckoutStatus;
  devMode: boolean;
  receiptUrl?: string | null;
  externalId?: string | null;
};

export type AbacateProduct = { id: string; externalId: string; price: number };
export type AbacateCustomer = { id: string };
export type AbacateSubscription = { id: string; checkoutId: string; status: 'ACTIVE' | 'CANCELLED'; amount: number; devMode: boolean; updatedAt: string };
type CheckoutInput = { items: { id: string; quantity: number }[]; customerId?: string; externalId?: string; returnUrl?: string; completionUrl?: string; metadata?: Record<string, string> };

/** A refusal or failure from AbacatePay. `status` is the HTTP status, 0 when the network failed. */
export class AbacatePayError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'AbacatePayError'; }
}

export type AbacatePayTransport = (url: string, init: RequestInit) => Promise<Response>;

export function abacatePayClient(apiKey: string, transport: AbacatePayTransport = fetch) {
  async function call<T>(method: 'GET' | 'POST', path: string, body?: object, query?: Record<string, string>): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await transport(url.toString(), {
        method,
        headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new AbacatePayError(0, error instanceof Error ? error.message : 'network');
    }
    const envelope = await response.json().catch(() => null) as { data?: T; success?: boolean; error?: unknown } | null;
    if (!response.ok || !envelope || envelope.success === false || envelope.error || envelope.data == null) {
      const reason = typeof envelope?.error === 'string' ? envelope.error : `HTTP ${response.status}`;
      throw new AbacatePayError(response.status, reason);
    }
    return envelope.data;
  }

  return {
    getProduct: (externalId: string) => call<AbacateProduct>('GET', '/products/get', undefined, { externalId }),
    createProduct: (product: { externalId: string; name: string; price: number; description?: string; cycle?: 'MONTHLY' }) =>
      call<AbacateProduct>('POST', '/products/create', { ...product, currency: 'BRL' }),
    createCustomer: (customer: { email: string; name?: string; metadata?: Record<string, string> }) =>
      call<AbacateCustomer>('POST', '/customers/create', customer),
    createCheckout: (checkout: {
      items: { id: string; quantity: number }[]; customerId?: string; externalId?: string;
      returnUrl?: string; completionUrl?: string; metadata?: Record<string, string>;
    }) => call<AbacateCheckout>('POST', '/checkouts/create', checkout),
    getCheckout: (id: string) => call<AbacateCheckout>('GET', '/checkouts/get', undefined, { id }),
    getCheckoutByExternalId: (externalId: string) => call<AbacateCheckout>('GET', '/checkouts/get', undefined, { externalId }),
    createSubscription: (checkout: CheckoutInput) => call<AbacateCheckout>('POST', '/subscriptions/create', { ...checkout, methods: ['CARD'] }),
    getSubscriptionCheckout: (id: string) => call<AbacateCheckout>('GET', '/subscriptions/checkouts/get', undefined, { id }),
    getSubscriptionCheckoutByExternalId: (externalId: string) => call<AbacateCheckout>('GET', '/subscriptions/checkouts/get', undefined, { externalId }),
    getSubscription: (id: string) => call<AbacateSubscription>('GET', '/subscriptions/get', undefined, { id }),
    listCheckoutSubscriptions: (checkoutId: string) => call<AbacateSubscription[]>('GET', '/subscriptions/list', undefined, { checkoutId }),
    cancelSubscription: (id: string) => call<AbacateSubscription>('POST', '/subscriptions/cancel', { id }),
    refundCheckout: (id: string) => call<{ id: string; status: string }>('POST', '/checkouts/refund', { id }),
  };
}

export type AbacatePayClient = ReturnType<typeof abacatePayClient>;

function sameText(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Both checks AbacatePay recommends: the secret we registered comes back in the URL's
 * `webhookSecret`, and the raw body carries AbacatePay's HMAC signature.
 */
export function verifyWebhook(rawBody: string, signature: string | null, secretFromUrl: string | null, secret: string) {
  if (!secret || !secretFromUrl || !signature || !sameText(secretFromUrl, secret)) return false;
  const expected = createHmac('sha256', WEBHOOK_SIGNING_KEY).update(Buffer.from(rawBody, 'utf8')).digest('base64');
  return sameText(expected, signature);
}

/** Test helper and documentation of the scheme: the signature AbacatePay would send for `rawBody`. */
export function signWebhookBody(rawBody: string) {
  return createHmac('sha256', WEBHOOK_SIGNING_KEY).update(Buffer.from(rawBody, 'utf8')).digest('base64');
}
