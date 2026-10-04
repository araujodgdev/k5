import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import { personalChatEnvironment, type SendEmailBinding } from './environment';

export type EmailTransportResult =
  | { state: 'accepted'; providerRef: string | null }
  | { state: 'retry' | 'failed' | 'unknown'; code: string };

type EmailFetch = (url: URL, init: RequestInit) => Promise<Response>;
const transport = new AsyncLocalStorage<EmailFetch>();
export function withPersonalEmailTransport<T>(fetcher: EmailFetch, action: () => T): T {
  return transport.run(fetcher, action);
}

const settingsSchema = z.object({
  accountId: z.string().regex(/^[a-f0-9]{32}$/i),
  token: z.string().min(1).regex(/^[\x21-\x7e]+$/),
  from: z.email().max(254),
});
export function personalEmailSettings() {
  const env = personalChatEnvironment();
  const result = settingsSchema.safeParse({ accountId: env.CLOUDFLARE_ACCOUNT_ID?.trim(),
    token: env.CLOUDFLARE_EMAIL_API_TOKEN?.trim(), from: env.TISES_MESSAGES_FROM?.trim() });
  if (result.success) return result.data;
  // The web Worker sends through its `send_email` binding, which needs only the sender.
  const from = z.email().max(254).safeParse(env.TISES_MESSAGES_FROM?.trim());
  return env.EMAIL && from.success ? { binding: env.EMAIL, from: from.data } : null;
}

async function sendThroughBinding(binding: SendEmailBinding, from: string, input: { to: string; subject: string; text: string; html: string }): Promise<EmailTransportResult> {
  // Like the HTTP path, a send that does not answer in 10 s is unknown rather than a hung request.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), 10_000); });
  try {
    const sent = await Promise.race([binding.send({ from, ...input }), timeout]);
    if (sent === 'timeout') return { state: 'unknown', code: 'timeout' };
    return { state: 'accepted', providerRef: sent.messageId ?? null };
  } catch (error) {
    // Codes from https://developers.cloudflare.com/email-service/api/send-emails/workers-api/#error-handling
    const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : '';
    if (code === 'E_RATE_LIMIT_EXCEEDED') return { state: 'retry', code: 'throttled' };
    if (/^E_[A-Z_]+$/.test(code)) return { state: 'failed', code: code.toLowerCase() };
    return { state: 'unknown', code: 'binding_error' };
  } finally { clearTimeout(timer); }
}

const responseSchema = z.object({
  success: z.boolean(),
  result: z.object({
    message_id: z.string().max(500).optional(),
    delivered: z.array(z.string()).default([]),
    queued: z.array(z.string()).default([]),
    permanent_bounces: z.array(z.string()).default([]),
    suppressed_recipients: z.array(z.string()).default([]),
  }).nullish(),
  errors: z.array(z.object({ code: z.number() })).optional(),
});

async function readResponse(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.length;
      if (length > 65_536) { await reader.cancel(); return null; }
      chunks.push(item.value);
    }
    return JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
  } finally { reader.releaseLock(); }
}

export async function sendPersonalEmail(input: { to: string; subject: string; text: string; html: string }): Promise<EmailTransportResult> {
  const settings = personalEmailSettings();
  if (!settings) return { state: 'failed', code: 'not_configured' };
  if (!z.email().max(254).safeParse(input.to).success || /[\r\n]/.test(input.subject)
    || input.subject.length > 200 || input.text.length > 40_000 || input.html.length > 200_000) {
    return { state: 'failed', code: 'invalid_content' };
  }
  if ('binding' in settings) return sendThroughBinding(settings.binding, settings.from, input);
  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${settings.accountId}/email/sending/send`);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<EmailTransportResult>(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve({ state: 'unknown', code: 'timeout' }); }, 10_000);
  });
  const send = async (): Promise<EmailTransportResult> => {
    try {
      const response = await (transport.getStore() ?? fetch)(url, {
        method: 'POST', redirect: 'manual', cache: 'no-store',
        headers: { authorization: `Bearer ${settings.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: settings.from, to: input.to, subject: input.subject, text: input.text, html: input.html }),
        signal: controller.signal,
      });
      const parsed = responseSchema.safeParse(await readResponse(response));
      if (response.status >= 500 || response.status === 408 || !parsed.success) return { state: 'unknown', code: 'ambiguous_response' };
      const payload = parsed.data;
      if (response.ok && payload.success && payload.result) {
        const result = payload.result;
        const contains = (addresses: string[]) => addresses.some(address => address.toLowerCase() === input.to.toLowerCase());
        if (contains(result.permanent_bounces) || contains(result.suppressed_recipients)) return { state: 'failed', code: 'recipient_rejected' };
        if (contains(result.delivered) || contains(result.queued)) return { state: 'accepted', providerRef: result.message_id ?? null };
        return { state: 'unknown', code: 'missing_recipient_status' };
      }
      if (response.status === 429 && !payload.success && payload.errors?.some(error => error.code === 10004)) return { state: 'retry', code: 'throttled' };
      if (response.status >= 400 && response.status < 500 && !payload.success) return { state: 'failed', code: `http_${response.status}` };
      return { state: 'unknown', code: 'ambiguous_response' };
    } catch { return { state: 'unknown', code: controller.signal.aborted ? 'timeout' : 'network_error' }; }
  };
  try { return await Promise.race([send(), timeout]); }
  finally { clearTimeout(timer); controller.abort(); }
}
