import { createHash } from 'node:crypto';
import { z } from 'zod';
import { encryptCredential, decryptCredential, parseCredentialKeyring } from '@/lib/platform-crypto';
import type { PushSubscriptionInput } from './contracts';

const allowedExactHosts = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
]);

function allowedHost(host: string) {
  return allowedExactHosts.has(host)
    || host.endsWith('.push.apple.com')
    || host.endsWith('.notify.windows.com');
}

function base64UrlBytes(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) throw new Error('Chave da inscrição inválida.');
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function validatePushSubscription(input: PushSubscriptionInput) {
  let endpoint: URL;
  try { endpoint = new URL(input.endpoint); } catch { throw new Error('Endpoint de push inválido.'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.port) {
    throw new Error('Endpoint de push não permitido.');
  }
  const host = endpoint.hostname.toLowerCase();
  if (!allowedHost(host)) throw new Error('Provedor de push não permitido.');
  if (base64UrlBytes(input.keys.p256dh).byteLength !== 65 || base64UrlBytes(input.keys.auth).byteLength !== 16) {
    throw new Error('Chaves da inscrição inválidas.');
  }
  return { ...input, endpoint: endpoint.href };
}

export function endpointHash(endpoint: string) {
  return createHash('sha256').update(endpoint).digest('hex');
}

export function encryptPushSubscription(input: Pick<PushSubscriptionInput, 'endpoint' | 'expirationTime' | 'keys'>) {
  return encryptCredential(JSON.stringify(input), parseCredentialKeyring());
}

const storedSubscription = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

export function decryptPushSubscription(value: string) {
  return storedSubscription.parse(JSON.parse(decryptCredential(value, parseCredentialKeyring())));
}

export function publicPushConfiguration() {
  const publicKey = process.env.K5_VAPID_PUBLIC_KEY?.trim() ?? '';
  const keyId = process.env.K5_VAPID_KEY_ID?.trim() ?? '';
  return { available: Boolean(publicKey && keyId), publicKey, keyId };
}
