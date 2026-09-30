import 'server-only';
import { z } from 'zod';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { Signature } from './contracts';

const token = z.string().uuid();
const documentSchema = z.object({ token, external_id: z.string(), sandbox: z.boolean(), status: z.string().max(40), deleted: z.boolean().optional().default(false),
  original_file: z.url(), signed_file: z.url().nullable(), signers: z.array(z.object({ token, name: z.string(), email: z.email(), auth_mode: z.string(),
    status: z.string(), signed_at: z.iso.datetime({ offset: true }).nullable(), sign_url: z.url().optional() })).min(1).max(10) });
export type ProviderDocument = z.output<typeof documentSchema>;
export type SignatureTransport = { fetch: typeof globalThis.fetch };
export type ProviderConnection = { apiKey: string; environment: Signature['environment'] };
const unavailable = () => new CapabilityError('NOT_READY', 'Não foi possível confirmar o resultado no provedor. Atualize a assinatura ou confira a conta ZapSign.');

export function safeSignUrl(raw: string, environment: ProviderConnection['environment']) {
  const url = new URL(raw);
  const hosts = environment === 'sandbox' ? ['sandbox.app.zapsign.com.br', 'app.zapsign.com.br'] : ['app.zapsign.com.br'];
  if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.port || url.username || url.password || !/^\/verificar\/[a-f0-9-]{36}\/?$/i.test(url.pathname) || url.search || url.hash) throw unavailable();
  return url.href;
}
function fileUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !['zapsign.s3.amazonaws.com', 'zapsign.s3.sa-east-1.amazonaws.com', 'zapsign.s3.us-east-1.amazonaws.com'].includes(url.hostname)
    || url.port || url.username || url.password || url.hash) throw unavailable();
  return url.href;
}
async function bounded(response: Response, maximum: number) {
  if (!response.ok || Number(response.headers.get('content-length')) > maximum) { await response.body?.cancel(); throw unavailable(); }
  const reader = response.body?.getReader(); if (!reader) throw unavailable();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maximum) throw unavailable(); chunks.push(value); }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export class ZapSign {
  constructor(private connection: ProviderConnection, private transport: SignatureTransport = { fetch: globalThis.fetch }) {}
  private async call(path: string, init: RequestInit) {
    try {
      const base = this.connection.environment === 'sandbox' ? 'https://sandbox.zapsign.com.br/api/v1/' : 'https://api.zapsign.com.br/api/v1/';
      const response = await this.transport.fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${this.connection.apiKey}`, 'Content-Type': 'application/json' },
        redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(30_000) });
      return documentSchema.parse(JSON.parse((await bounded(response, 512_000)).toString('utf8')));
    } catch { throw unavailable(); }
  }
  create(input: { id: string; name: string; bytes: Uint8Array; recipient: { name: string; email: string }; method: Signature['method'] }) {
    return this.call('docs/', { method: 'POST', body: JSON.stringify({ name: input.name, base64_pdf: Buffer.from(input.bytes).toString('base64'), external_id: input.id,
      lang: 'pt-br', signed_file_only_finished: true, disable_signer_emails: false,
      signers: [{ name: input.recipient.name, email: input.recipient.email, external_id: input.id, lock_name: true, lock_email: true,
        auth_mode: input.method === 'certificate' ? 'certificadoDigital' : 'assinaturaTela-tokenEmail', send_automatic_email: true }] }) });
  }
  detail(id: string) { return this.call(`docs/${token.parse(id)}/`, { method: 'GET' }); }
  cancel(id: string) { return this.call(`docs/${token.parse(id)}/`, { method: 'DELETE' }); }
  async pdf(raw: string) {
    try {
      const response = await this.transport.fetch(fileUrl(raw), { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(30_000) });
      const bytes = await bounded(response, 40_000_000);
      if (bytes.subarray(0, 5).toString() !== '%PDF-') throw unavailable();
      return bytes;
    } catch { throw unavailable(); }
  }
}
