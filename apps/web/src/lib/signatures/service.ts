import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, withTransaction, type Transaction } from '@/lib/database';
import { assertCapabilityAllowed, type WorkspaceContext } from '@/lib/application/context';
import { CapabilityError } from '@/lib/capabilities/errors';
import { decryptCredential, encryptCredential, parseCredentialKeyring } from '@/lib/platform-crypto';
import { objectStorage, storageKey } from '@/lib/storage';
import { downloadManagedFile, requireClientPortalAccess, requirePortalStaff, type ClientContext } from '@/lib/client-portal/service';
import { requestSignatureInput, signatureConnectionDto, signatureConnectionInput, signatureDto, type Signature } from './contracts';
import { safeSignUrl, ZapSign, type ProviderDocument, type SignatureTransport } from './zapsign';

type Connection = { encrypted_api_key: string; environment: Signature['environment']; enabled: boolean; version: number; encrypted_webhook_secret: string | null };
type RequestRow = { id: string; office_id: string; client_id: string; file_id: string; access_id: string; recipient_name: string; recipient_email: string;
  method: Signature['method']; environment: Signature['environment']; state: Signature['state']; provider_token: string | null; encrypted_sign_url: string | null;
  original_sha256: string; signed_storage_key: string | null; signed_sha256: string | null; signed_at: string | null; checked_at: string | null;
  created_at: string; requested_by: string; idempotency_key: string; name: string };
const missing = () => new CapabilityError('NOT_FOUND', 'Solicitação de assinatura não encontrada.');
const conflict = () => new CapabilityError('CONFLICT', 'A solicitação ou configuração mudou. Atualize a página.');
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function keyring() {
  try { return parseCredentialKeyring(); } catch { throw new CapabilityError('NOT_READY', 'A instalação precisa configurar a proteção das credenciais de assinatura.'); }
}
function decode(value: string) {
  try { return decryptCredential(value, keyring()); } catch { throw new CapabilityError('NOT_READY', 'Não foi possível ler a conexão de assinatura. Peça ao administrador para conferir a configuração.'); }
}
async function event(tx: Transaction, row: Pick<RequestRow, 'id' | 'office_id'>, actor: string | null, action: string, details: unknown = {}) {
  await tx.prepare('INSERT INTO signature_event(id,office_id,request_id,actor_user_id,event,details_json) VALUES(?,?,?,?,?,?)')
    .run(randomUUID(), row.office_id, row.id, actor, action, JSON.stringify(details));
}
async function connection(officeId: string, environment?: Signature['environment']) {
  const row = await database.prepare('SELECT encrypted_api_key,environment,enabled,version FROM signature_connection WHERE office_id=?').get<Connection>(officeId);
  if (!row || (environment && environment !== row.environment)) throw new CapabilityError('NOT_READY', 'Configure a conexão ZapSign deste ambiente em Integrações.');
  return row;
}
export async function getSignatureConnection(context: WorkspaceContext) {
  context = await assertCapabilityAllowed(context, 'k5_crm_get_client');
  if (context.caseScope) throw missing();
  const row = await database.prepare('SELECT enabled,environment,version,encrypted_webhook_secret FROM signature_connection WHERE office_id=?').get<Connection>(context.officeId);
  let webhookUrl: string | null = null;
  if (row?.encrypted_webhook_secret && context.role === 'administrator') {
    const url = new URL('/api/signatures/webhook', process.env.BETTER_AUTH_URL ?? 'http://localhost:3000');
    url.searchParams.set('secret', decode(row.encrypted_webhook_secret)); webhookUrl = url.href;
  }
  context = await assertCapabilityAllowed(context, 'k5_crm_get_client');
  if (context.role !== 'administrator') webhookUrl = null;
  return signatureConnectionDto.parse({ connected: !!row, enabled: row?.enabled ?? false, environment: row?.environment ?? 'sandbox', version: row?.version ?? 0, webhookUrl });
}
export async function saveSignatureConnection(context: WorkspaceContext, raw: unknown) {
  const input = signatureConnectionInput.parse(raw);
  context = await assertCapabilityAllowed(context, 'k5_crm_update_client');
  if (context.caseScope || context.role !== 'administrator') throw new CapabilityError('FORBIDDEN', 'Somente administradores configuram assinaturas.');
  const encrypted = input.apiKey ? encryptCredential(input.apiKey, keyring()) : null;
  await withTransaction(async tx => {
    await tx.prepare('SELECT id FROM office WHERE id=? FOR UPDATE').get(context.officeId);
    const row = await tx.prepare('SELECT encrypted_api_key,environment,version,encrypted_webhook_secret FROM signature_connection WHERE office_id=?').get<Connection>(context.officeId);
    if ((row?.version ?? 0) !== input.version) throw conflict();
    if (!encrypted && !row) throw new CapabilityError('INVALID', 'Informe a chave de API da conta ZapSign.');
    if (row?.environment !== input.environment && row && (!encrypted || await tx.prepare("SELECT 1 FROM signature_request WHERE office_id=? AND state IN ('creating','uncertain','pending') LIMIT 1").get(context.officeId)))
      throw new CapabilityError('CONFLICT', 'Informe a chave do novo ambiente e conclua as solicitações em aberto antes de trocar.');
    await assertCapabilityAllowed(context, 'k5_crm_update_client');
    const role = await tx.prepare('SELECT role FROM office_member WHERE office_id=? AND user_id=?').get<{ role: string }>(context.officeId, context.userId);
    if (role?.role !== 'administrator') throw new CapabilityError('FORBIDDEN', 'Somente administradores configuram assinaturas.');
    const webhookSecret = row?.encrypted_webhook_secret ? decode(row.encrypted_webhook_secret) : randomBytes(32).toString('base64url');
    await tx.prepare(`INSERT INTO signature_connection(office_id,encrypted_api_key,environment,enabled,updated_by) VALUES(?,?,?,?,?)
      ON CONFLICT(office_id) DO UPDATE SET encrypted_api_key=EXCLUDED.encrypted_api_key,environment=EXCLUDED.environment,enabled=EXCLUDED.enabled,
      updated_by=EXCLUDED.updated_by,version=signature_connection.version+1,updated_at=CURRENT_TIMESTAMP`)
      .run(context.officeId, encrypted ?? row?.encrypted_api_key, input.environment, input.enabled, context.userId);
    await tx.prepare('UPDATE signature_connection SET encrypted_webhook_secret=?,webhook_secret_hash=? WHERE office_id=?')
      .run(encryptCredential(webhookSecret, keyring()), hash(Buffer.from(webhookSecret)), context.officeId);
  });
  return getSignatureConnection(context);
}
async function requestRow(officeId: string, id: string) {
  z.string().uuid().parse(id);
  const row = await database.prepare('SELECT s.*,f.name FROM signature_request s JOIN client_portal_file f ON f.office_id=s.office_id AND f.id=s.file_id WHERE s.office_id=? AND s.id=?')
    .get<RequestRow>(officeId, id);
  if (!row) throw missing();
  return row;
}
function dto(row: RequestRow, base: string, client = false): Signature {
  const signUrl = client && row.encrypted_sign_url && row.state === 'pending' ? safeSignUrl(decode(row.encrypted_sign_url), row.environment) : null;
  return signatureDto.parse({ id: row.id, fileId: row.file_id, name: row.name, recipientEmail: row.recipient_email, method: row.method, environment: row.environment,
    state: row.state, createdAt: row.created_at, checkedAt: row.checked_at, signedAt: row.signed_at, signUrl: client ? signUrl : null,
    downloadUrl: row.signed_storage_key ? `${base}/${row.id}/pdf` : null, evidenceUrl: `${base}/${row.id}/evidence`, providerToken: client ? null : row.provider_token });
}
export async function managedSignatures(context: WorkspaceContext, clientId: string) {
  context = await requirePortalStaff(context, clientId);
  const rows = await database.prepare(`SELECT s.*,f.name FROM signature_request s JOIN client_portal_file f ON f.office_id=s.office_id AND f.id=s.file_id
    WHERE s.office_id=? AND s.client_id=? ORDER BY s.created_at DESC LIMIT 100`).all<RequestRow>(context.officeId, clientId);
  return { signatures: rows.map(row => dto(row, `/api/signatures/manage/${clientId}`)) };
}
export async function clientSignatures(context: ClientContext, accessId: string) {
  const access = await requireClientPortalAccess(context, accessId);
  const rows = await database.prepare(`SELECT s.*,f.name FROM signature_request s JOIN client_portal_file f ON f.office_id=s.office_id AND f.id=s.file_id
    WHERE s.office_id=? AND s.client_id=? AND s.access_id=? AND lower(s.recipient_email)=lower(?) AND f.revoked_at IS NULL
    ORDER BY s.created_at DESC LIMIT 100`).all<RequestRow>(access.office_id, access.client_id, access.id, access.email);
  const signatures = rows.map(row => dto(row, `/api/signatures/client/${accessId}`, true));
  await requireClientPortalAccess(context, accessId);
  return { signatures };
}
export async function requestSignature(context: WorkspaceContext, raw: unknown, transport?: SignatureTransport) {
  const input = requestSignatureInput.parse(raw); context = await requirePortalStaff(context, input.clientId, true);
  const existing = await database.prepare('SELECT id,client_id,method,file_id,idempotency_key FROM signature_request WHERE office_id=? AND (file_id=? OR (requested_by=? AND idempotency_key=?))')
    .get<Pick<RequestRow, 'id' | 'client_id' | 'method' | 'file_id' | 'idempotency_key'>>(context.officeId, input.fileId, context.userId, input.idempotencyKey);
  if (existing) {
    if (existing.client_id !== input.clientId || existing.file_id !== input.fileId || existing.method !== input.method) throw conflict();
    return managedSignatures(context, input.clientId);
  }
  const config = await connection(context.officeId); if (!config.enabled) throw new CapabilityError('NOT_READY', 'Novas assinaturas estão desativadas em Integrações.');
  const provider = new ZapSign({ apiKey: decode(config.encrypted_api_key), environment: config.environment }, transport);
  const file = await downloadManagedFile(context, input.clientId, input.fileId);
  if (file.mimeType !== 'application/pdf' || file.bytes.length > 10_000_000) throw new CapabilityError('INVALID', 'A assinatura aceita um PDF publicado de até 10 MB.');
  const id = randomUUID();
  const created = await withTransaction(async tx => {
    await requirePortalStaff(context, input.clientId, true);
    const access = await tx.prepare(`SELECT p.id,p.email,c.name FROM client_portal_access p JOIN crm_client c ON c.office_id=p.office_id AND c.id=p.client_id
      WHERE p.office_id=? AND p.client_id=? AND p.revoked_at IS NULL AND p.accepted_at IS NOT NULL FOR SHARE OF p`)
      .get<{ id: string; email: string; name: string }>(context.officeId, input.clientId);
    const activeFile = await tx.prepare("SELECT sha256 FROM client_portal_file WHERE office_id=? AND client_id=? AND id=? AND kind='published' AND revoked_at IS NULL FOR SHARE")
      .get<{ sha256: string }>(context.officeId, input.clientId, input.fileId);
    const liveConfig = await tx.prepare('SELECT version,enabled FROM signature_connection WHERE office_id=? FOR SHARE').get<Connection>(context.officeId);
    if (!access) throw new CapabilityError('INVALID', 'O cliente precisa aceitar o convite do portal antes da assinatura.');
    if (!activeFile || activeFile.sha256 !== hash(file.bytes) || !liveConfig?.enabled || liveConfig.version !== config.version) throw conflict();
    const result = await tx.prepare(`INSERT INTO signature_request(id,office_id,client_id,file_id,access_id,recipient_email,recipient_name,method,environment,state,original_sha256,requested_by,idempotency_key)
      VALUES(?,?,?,?,?,?,?,?,?,'creating',?,?,?) ON CONFLICT DO NOTHING`)
      .run(id, context.officeId, input.clientId, input.fileId, access.id, access.email, access.name, input.method, config.environment, activeFile.sha256, context.userId, input.idempotencyKey);
    if (!result.changes) return false;
    await event(tx, { id, office_id: context.officeId }, context.userId, 'requested', { method: input.method, environment: config.environment, sha256: activeFile.sha256 });
    return true;
  });
  if (!created) return requestSignature(context, input, transport);
  const row = await requestRow(context.officeId, id);
  try {
    await requirePortalStaff(context, input.clientId, true);
    const access = await database.prepare('SELECT 1 FROM client_portal_access WHERE office_id=? AND id=? AND email=? AND revoked_at IS NULL AND accepted_at IS NOT NULL')
      .get(row.office_id, row.access_id, row.recipient_email);
    if (!access) throw conflict();
    const document = await provider.create({ id, name: file.name, bytes: file.bytes, recipient: { name: row.recipient_name, email: row.recipient_email }, method: row.method });
    await connectDocument(row, document, context.userId);
  } catch {
    await withTransaction(async tx => {
      await tx.prepare("UPDATE signature_request SET state='uncertain',updated_at=CURRENT_TIMESTAMP WHERE office_id=? AND id=? AND provider_token IS NULL").run(context.officeId, id);
      await event(tx, row, context.userId, 'uncertain');
    });
  }
  return managedSignatures(context, input.clientId);
}
function boundDocument(row: RequestRow, document: ProviderDocument) {
  const signer = document.signers[0];
  if (document.external_id !== row.id || document.sandbox !== (row.environment === 'sandbox') || document.signers.length !== 1 || signer.email.toLowerCase() !== row.recipient_email.toLowerCase()
    || signer.auth_mode !== (row.method === 'certificate' ? 'certificadoDigital' : 'assinaturaTela-tokenEmail') || (row.provider_token && document.token !== row.provider_token))
    throw new CapabilityError('NOT_READY', 'O provedor retornou dados que não correspondem à solicitação. Confira a conta ZapSign.');
  return signer;
}
type ReconciliationGuard = (tx: Transaction) => Promise<boolean>;
async function connectDocument(row: RequestRow, document: ProviderDocument, actor: string | null, guard?: ReconciliationGuard) {
  const signer = boundDocument(row, document);
  const signUrl = safeSignUrl(signer.sign_url ?? `https://${row.environment === 'sandbox' ? 'sandbox.app' : 'app'}.zapsign.com.br/verificar/${signer.token}`, row.environment);
  if (new URL(signUrl).pathname.replace(/\/$/, '') !== `/verificar/${signer.token}`) throw new CapabilityError('NOT_READY', 'O link de assinatura não corresponde ao destinatário confirmado.');
  await withTransaction(async tx => {
    if (guard && !await guard(tx)) return;
    const result = await tx.prepare(`UPDATE signature_request SET provider_token=?,encrypted_sign_url=?,state='pending',updated_at=CURRENT_TIMESTAMP
      WHERE office_id=? AND id=? AND provider_token IS NULL`).run(document.token, encryptCredential(signUrl, keyring()), row.office_id, row.id);
    if (result.changes) await event(tx, row, actor, 'connected', { providerToken: document.token, source: actor ? 'portal' : 'webhook' });
  });
}
async function sync(row: RequestRow, actor: string | null, transport?: SignatureTransport, guard?: ReconciliationGuard) {
  if (row.signed_storage_key || row.state === 'cancelled') return;
  if (!row.provider_token) {
    await database.prepare("UPDATE signature_request SET state='uncertain',updated_at=CURRENT_TIMESTAMP WHERE office_id=? AND id=? AND state='creating' AND created_at<CURRENT_TIMESTAMP-INTERVAL '60 seconds'").run(row.office_id, row.id);
    return;
  }
  const config = await connection(row.office_id, row.environment), provider = new ZapSign({ apiKey: decode(config.encrypted_api_key), environment: row.environment }, transport);
  const document = await provider.detail(row.provider_token), signer = boundDocument(row, document);
  const complete = !document.deleted && document.status === 'signed' && signer.status === 'signed' && !!signer.signed_at && !!document.signed_file;
  let stored: { key: string; hash: string } | null = null, retained = false;
  const storage = await objectStorage();
  try {
    if (complete && document.signed_file) {
      const bytes = await provider.pdf(document.signed_file), key = storageKey(row.office_id, randomUUID(), '.pdf');
      await storage.put(key, bytes); stored = { key, hash: hash(bytes) };
    }
    await withTransaction(async tx => {
      if (guard && !await guard(tx)) return;
      const current = await tx.prepare('SELECT signed_storage_key,state FROM signature_request WHERE office_id=? AND id=? FOR UPDATE').get<RequestRow>(row.office_id, row.id);
      if (!current || current.signed_storage_key || current.state === 'cancelled') return;
      const state = document.deleted || ['recusado','refused','expired','cancelled'].includes(document.status) ? 'cancelled' : stored ? 'signed' : 'pending';
      await tx.prepare(`UPDATE signature_request SET state=?,signed_storage_key=?,signed_sha256=?,signed_at=?,checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE office_id=? AND id=?`)
        .run(state, stored?.key ?? null, stored?.hash ?? null, stored ? signer.signed_at : null, row.office_id, row.id);
      await event(tx, row, actor, stored ? 'archived' : 'checked', { providerStatus: document.status, signerStatus: signer.status, authMode: signer.auth_mode, signedAt: signer.signed_at, signedSha256: stored?.hash ?? null, source: actor ? 'portal' : 'webhook' });
      retained = !!stored;
    });
  } finally { if (stored && !retained) await storage.delete(stored.key).catch(() => undefined); }
}
/** Called only by the leased webhook worker, after binding the job to its persisted office. */
export async function reconcileSignatureWebhook(input: { officeId: string; requestId: string; providerToken: string; guard: ReconciliationGuard }, transport?: SignatureTransport) {
  let row = await requestRow(input.officeId, input.requestId);
  if (row.signed_storage_key || row.state === 'cancelled') return row.state;
  if (!row.provider_token) {
    const config = await connection(row.office_id, row.environment);
    const provider = new ZapSign({ apiKey: decode(config.encrypted_api_key), environment: row.environment }, transport);
    const document = await provider.detail(input.providerToken); boundDocument(row, document);
    if (hash(await provider.pdf(document.original_file)) !== row.original_sha256) throw conflict();
    await connectDocument(row, document, null, input.guard); row = await requestRow(row.office_id, row.id);
  }
  if (row.provider_token !== input.providerToken) throw conflict();
  await sync(row, null, transport, input.guard);
  return (await requestRow(row.office_id, row.id)).state;
}
export async function refreshManagedSignature(context: WorkspaceContext, clientId: string, id: string, transport?: SignatureTransport) {
  context = await requirePortalStaff(context, clientId, true); const row = await requestRow(context.officeId, id); if (row.client_id !== clientId) throw missing();
  await sync(row, context.userId, transport); return managedSignatures(context, clientId);
}
async function clientRequest(context: ClientContext, accessId: string, id: string) {
  const access = await requireClientPortalAccess(context, accessId), row = await requestRow(access.office_id, id);
  if (row.client_id !== access.client_id || row.access_id !== access.id || row.recipient_email.toLowerCase() !== access.email.toLowerCase()
    || !await database.prepare('SELECT 1 FROM client_portal_file WHERE office_id=? AND id=? AND revoked_at IS NULL').get(access.office_id, row.file_id)) throw missing();
  return row;
}
export async function refreshClientSignature(context: ClientContext, accessId: string, id: string, transport?: SignatureTransport) {
  const row = await clientRequest(context, accessId, id); await sync(row, context.userId, transport); return clientSignatures(context, accessId);
}
export async function recoverSignature(context: WorkspaceContext, clientId: string, id: string, providerToken: string, transport?: SignatureTransport) {
  context = await requirePortalStaff(context, clientId, true); const row = await requestRow(context.officeId, id);
  if (row.client_id !== clientId || row.provider_token || row.state !== 'uncertain') throw conflict();
  const config = await connection(row.office_id, row.environment), provider = new ZapSign({ apiKey: decode(config.encrypted_api_key), environment: row.environment }, transport);
  const document = await provider.detail(providerToken); boundDocument(row, document);
  if (hash(await provider.pdf(document.original_file)) !== row.original_sha256) throw new CapabilityError('CONFLICT', 'O PDF original no provedor não corresponde à publicação.');
  await requirePortalStaff(context, clientId, true); await connectDocument(row, document, context.userId);
  return refreshManagedSignature(context, clientId, id, transport);
}
export async function cancelSignature(context: WorkspaceContext, clientId: string, id: string, transport?: SignatureTransport) {
  context = await requirePortalStaff(context, clientId, true); const row = await requestRow(context.officeId, id);
  if (row.client_id !== clientId || row.signed_storage_key) throw conflict();
  if (row.state === 'cancelled') return managedSignatures(context, clientId);
  if (!row.provider_token) throw new CapabilityError('CONFLICT', 'Confira e vincule o documento na ZapSign antes de cancelar uma solicitação sem confirmação.');
  const config = await connection(row.office_id, row.environment), provider = new ZapSign({ apiKey: decode(config.encrypted_api_key), environment: row.environment }, transport);
  const current = await provider.detail(row.provider_token); boundDocument(row, current);
  if (current.status === 'signed') throw new CapabilityError('CONFLICT', 'O documento já foi assinado. Atualize para guardar o PDF.');
  await requirePortalStaff(context, clientId, true);
  const cancelled = await provider.cancel(row.provider_token); boundDocument(row, cancelled); if (!cancelled.deleted) throw conflict();
  await withTransaction(async tx => {
    await tx.prepare("UPDATE signature_request SET state='cancelled',checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE office_id=? AND id=? AND signed_storage_key IS NULL").run(row.office_id, row.id);
    await event(tx, row, context.userId, 'cancelled');
  });
  return managedSignatures(context, clientId);
}
async function signedFile(row: RequestRow) {
  if (!row.signed_storage_key || !row.signed_sha256) throw new CapabilityError('NOT_READY', 'O PDF assinado ainda não foi confirmado e guardado. Atualize a assinatura.');
  const bytes = await (await objectStorage()).get(row.signed_storage_key);
  if (hash(bytes) !== row.signed_sha256) throw new CapabilityError('NOT_READY', 'Não foi possível conferir o PDF assinado. Avise o escritório.');
  return { bytes, name: row.name.replace(/\.pdf$/i, '') + '-assinado.pdf', mimeType: 'application/pdf' };
}
async function evidence(row: RequestRow) {
  const events = await database.prepare('SELECT event,created_at AS createdAt,details_json FROM signature_event WHERE office_id=? AND request_id=? ORDER BY created_at,id').all<{ event: string; createdAt: string; details_json: string }>(row.office_id, row.id);
  return { bytes: Buffer.from(JSON.stringify({ provider: 'ZapSign', requestId: row.id, providerToken: row.provider_token, environment: row.environment, state: row.state,
    recipientEmail: row.recipient_email, method: row.method, originalSha256: row.original_sha256, signedSha256: row.signed_sha256,
    createdAt: row.created_at, signedAt: row.signed_at, events: events.map(item => ({ event: item.event, createdAt: item.createdAt, details: JSON.parse(item.details_json) })) }, null, 2)),
    name: 'evidencias-assinatura.json', mimeType: 'application/json' };
}
export async function downloadManagedSignature(context: WorkspaceContext, clientId: string, id: string, format: 'pdf' | 'evidence') {
  context = await requirePortalStaff(context, clientId); const row = await requestRow(context.officeId, id); if (row.client_id !== clientId) throw missing();
  const file = await (format === 'pdf' ? signedFile(row) : evidence(row)); await requirePortalStaff(context, clientId); return file;
}
export async function downloadClientSignature(context: ClientContext, accessId: string, id: string, format: 'pdf' | 'evidence') {
  const row = await clientRequest(context, accessId, id), file = await (format === 'pdf' ? signedFile(row) : evidence(row));
  await clientRequest(context, accessId, id); return file;
}
