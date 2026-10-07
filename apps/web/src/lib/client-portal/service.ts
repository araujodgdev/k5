import 'server-only';
import { aclReadTransaction, aclTransaction } from '@/lib/acl-transaction';
import { pinnedArtifactTemplate } from '@/lib/artifact-file';
import { artifactPolicy, assertPolicyAccess, vaultPolicy, assertExternalDelivery, combinePolicy, parsePolicy, personPolicy, type ContentPolicy } from '@/lib/content-policy';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, type Transaction } from '@/lib/database';
import { assertCapabilityAllowed, assertWorkspaceSession, type WorkspaceContext } from '@/lib/application/context';
import { CapabilityError } from '@/lib/capabilities/errors';
import { objectStorage, storageKey } from '@/lib/storage';
import { validatedFileName } from '@/lib/application/uploads-service';
import { ownedArtifact } from '@/lib/ai-store';
import { readVaultDocumentFile } from '@/lib/vault';
import { exportDocument } from '@/lib/document-export';
import { exportPdf } from '@/lib/document-pdf';
import { getCharge } from '@/lib/honorarios/charges';
import { invitationHash } from './invitations';
import * as contract from './contracts';

export type ClientContext = { userId: string; sessionId: string; signal?: AbortSignal };
type Access = { id: string; office_id: string; client_id: string; office_name: string; client_name: string; email: string };
const missing = () => new CapabilityError('NOT_FOUND', 'Acesso ou arquivo não encontrado.');
const conflict = () => new CapabilityError('CONFLICT', 'O acesso mudou. Atualize a página antes de continuar.');
const fileFields = `f.id,f.name,f.kind,f.mime_type AS mimeType,f.byte_size AS byteSize,f.created_at AS createdAt,f.installment_id AS installmentId,u.name AS createdByName`;

async function clientAccess(context: ClientContext, accessId: string, tx: Transaction = database, lock = false) {
  context.signal?.throwIfAborted();
  if (!await tx.prepare(`SELECT 1 FROM session WHERE id=? AND userId=? AND expiresAt>clock_timestamp()${lock ? ' FOR SHARE' : ''}`).get(context.sessionId, context.userId))
    throw new CapabilityError('UNAUTHENTICATED', 'Sua sessão foi encerrada. Entre novamente para continuar.');
  const row = await tx.prepare(`SELECT p.id,p.office_id,p.client_id,p.email,o.name AS office_name,c.name AS client_name
    FROM client_portal_access p JOIN office o ON o.id=p.office_id JOIN crm_client c ON c.office_id=p.office_id AND c.id=p.client_id
    WHERE p.id=? AND p.user_id=? AND p.revoked_at IS NULL AND p.accepted_at IS NOT NULL ${lock ? 'FOR SHARE OF p' : ''}`)
    .get<Access>(accessId, context.userId);
  if (!row) throw missing();
  return row;
}
async function staff(context: WorkspaceContext, clientId: string, write = false, tx: Transaction = database) {
  context = await assertCapabilityAllowed(context, write ? 'k5_crm_update_client' : 'k5_crm_get_client', tx);
  if (context.caseScope || !await tx.prepare('SELECT 1 FROM crm_client WHERE office_id=? AND id=?').get(context.officeId, clientId)) throw missing();
  return context;
}
export { clientAccess as requireClientPortalAccess, staff as requirePortalStaff };
function files(rows: unknown[], base: string) {
  return contract.portalFileDto.array().parse(rows.map(row => {
    const file = z.object({ id: z.string() }).passthrough().parse(row);
    return { ...file, url: `${base}/${encodeURIComponent(file.id)}` };
  }));
}

export async function managePortal(context: WorkspaceContext, clientId: string) {
  context = await staff(context, clientId);
  const access = await database.prepare(`SELECT id,email,version,expires_at AS expiresAt,accepted_at AS acceptedAt,
    CASE WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN accepted_at IS NOT NULL THEN 'active' WHEN expires_at<=CURRENT_TIMESTAMP THEN 'expired' ELSE 'invited' END AS state
    FROM client_portal_access WHERE office_id=? AND client_id=?`).get(context.officeId, clientId);
  const rows = await database.prepare(`SELECT ${fileFields},f.content_policy,f.sha256,f.source_ref,f.created_by FROM client_portal_file f JOIN "user" u ON u.id=f.created_by
    WHERE f.office_id=? AND f.client_id=? AND f.revoked_at IS NULL ORDER BY f.created_at DESC,f.id DESC LIMIT 100`).all(context.officeId, clientId);
  const candidates = await database.prepare('SELECT id,title,version FROM ai_artifact WHERE office_id=? AND user_id=? ORDER BY updated_at DESC LIMIT 50').all(context.officeId, context.userId);
  const artifacts = [];
  for (const candidate of candidates) {
    try { await assertExternalDelivery(context.userId, await artifactPolicy(context, String(candidate.id))); artifacts.push(candidate); }
    catch (error) { if (!(error instanceof CapabilityError)) throw error; }
  }
  return contract.portalManageDto.parse({ access: access ?? null, files: files(await visiblePortalFiles(rows), `/api/client-portal/manage/${encodeURIComponent(clientId)}/files`), artifacts });
}
export async function invitePortal(context: WorkspaceContext, raw: unknown) {
  const input = contract.invitePortalInput.parse(raw); context = await staff(context, input.clientId, true);
  const token = randomBytes(32).toString('base64url');
  await aclTransaction(async tx => {
    await tx.prepare('SELECT id FROM crm_client WHERE office_id=? AND id=? FOR UPDATE').get(context.officeId, input.clientId);
    await staff(context, input.clientId, true, tx);
    const current = await tx.prepare('SELECT version FROM client_portal_access WHERE office_id=? AND client_id=?').get<{ version: number }>(context.officeId, input.clientId);
    if ((current?.version ?? 0) !== input.version) throw conflict();
    await tx.prepare(`INSERT INTO client_portal_access(id,office_id,client_id,email,token_hash,expires_at,invited_by)
      VALUES(?,?,?,?,?,CURRENT_TIMESTAMP+INTERVAL '7 days',?) ON CONFLICT(office_id,client_id) DO UPDATE SET email=EXCLUDED.email,token_hash=EXCLUDED.token_hash,
      expires_at=EXCLUDED.expires_at,invited_by=EXCLUDED.invited_by,user_id=NULL,accepted_at=NULL,revoked_at=NULL,version=client_portal_access.version+1,updated_at=CURRENT_TIMESTAMP`)
      .run(randomUUID(), context.officeId, input.clientId, input.email, invitationHash(token), context.userId);
    await staff(context, input.clientId, true, tx);
  });
  return { ...(await managePortal(context, input.clientId)), invitationPath: `/client/invite/${token}` };
}
export async function revokePortal(context: WorkspaceContext, raw: unknown) {
  const input = contract.revokePortalInput.parse(raw); context = await staff(context, input.clientId, true);
  await aclTransaction(async tx => {
    await tx.prepare('SELECT id FROM crm_client WHERE office_id=? AND id=? FOR UPDATE').get(context.officeId, input.clientId);
    await staff(context, input.clientId, true, tx);
    const result = await tx.prepare(`UPDATE client_portal_access SET revoked_at=CURRENT_TIMESTAMP,token_hash=NULL,version=version+1,updated_at=CURRENT_TIMESTAMP
      WHERE office_id=? AND client_id=? AND version=?`).run(context.officeId, input.clientId, input.version);
    if (!result.changes) throw conflict();
    await staff(context, input.clientId, true, tx);
  });
  return managePortal(context, input.clientId);
}
export async function portalChoices(context: ClientContext) {
  if (!await database.prepare('SELECT 1 FROM session WHERE id=? AND userId=? AND expiresAt>clock_timestamp()').get(context.sessionId, context.userId))
    throw new CapabilityError('UNAUTHENTICATED', 'Entre novamente para continuar.');
  const accesses = await database.prepare(`SELECT p.id,o.name AS officeName,c.name AS clientName FROM client_portal_access p
    JOIN office o ON o.id=p.office_id JOIN crm_client c ON c.office_id=p.office_id AND c.id=p.client_id
    WHERE p.user_id=? AND p.revoked_at IS NULL AND p.accepted_at IS NOT NULL ORDER BY o.name,c.name`).all(context.userId);
  return contract.portalChoicesDto.parse({ accesses });
}
async function chargeForClient(access: Access, installmentId: string) {
  const row = await database.prepare(`SELECT p.published_by FROM client_portal_charge p JOIN office_member m ON m.office_id=p.office_id AND m.user_id=p.published_by
    WHERE p.office_id=? AND p.client_id=? AND p.installment_id=?`).get<{ published_by: string }>(access.office_id, access.client_id, installmentId);
  if (!row) throw missing();
  const charge = await getCharge({ userId: row.published_by, officeId: access.office_id }, { installmentId });
  if (charge.boleto) await assertExternalDelivery(row.published_by, await vaultPolicy(charge.boleto.id));
  return charge;
}
export async function clientPortal(context: ClientContext, accessId: string) {
  const access = await clientAccess(context, accessId);
  const rows = await database.prepare(`SELECT ${fileFields},f.content_policy,f.sha256,f.source_ref,f.created_by FROM client_portal_file f JOIN "user" u ON u.id=f.created_by
    WHERE f.office_id=? AND f.client_id=? AND f.revoked_at IS NULL ORDER BY f.created_at DESC,f.id DESC LIMIT 100`).all(access.office_id, access.client_id);
  const ids = await database.prepare('SELECT installment_id FROM client_portal_charge WHERE office_id=? AND client_id=? ORDER BY published_at DESC LIMIT 100')
    .all<{ installment_id: string }>(access.office_id, access.client_id);
  const charges: z.output<typeof contract.portalChargeDto>[] = [];
  for (const { installment_id: id } of ids) {
    try {
      const charge = await chargeForClient(access, id);
      charges.push({ id, title: charge.installment.title, number: charge.installment.number, dueOn: charge.installment.dueOn, pendingCents: charge.installment.pendingCents,
        status: charge.installment.status, message: charge.message,
        pdfUrl: charge.pdfUrl ? `/api/client-portal/${accessId}/charges/${encodeURIComponent(id)}/pdf?version=${charge.version}` : null,
        boletoUrl: charge.boleto ? `/api/client-portal/${accessId}/charges/${encodeURIComponent(id)}/boleto` : null });
    } catch (error) { if (!(error instanceof CapabilityError && ['NOT_FOUND','FORBIDDEN'].includes(error.code))) throw error; }
  }
  await clientAccess(context, accessId);
  return contract.portalViewDto.parse({ accessId, officeName: access.office_name, clientName: access.client_name, files: files(await visiblePortalFiles(rows), `/api/client-portal/${accessId}/files`), charges });
}
export async function publishPortalCharge(context: WorkspaceContext, raw: unknown) {
  const input = contract.publishChargeInput.parse(raw); context = await staff(context, input.clientId, true);
  const charge = await getCharge(context, { installmentId: input.installmentId });
  if (charge.installment.clientId !== input.clientId || charge.version !== input.version || !charge.pdfUrl) throw conflict();
  if (charge.boleto) await assertExternalDelivery(context.userId, await vaultPolicy(charge.boleto.id));
  await database.prepare(`INSERT INTO client_portal_charge(office_id,client_id,installment_id,published_by) VALUES(?,?,?,?)
    ON CONFLICT(office_id,installment_id) DO UPDATE SET published_by=EXCLUDED.published_by,published_at=CURRENT_TIMESTAMP`)
    .run(context.officeId, input.clientId, input.installmentId, context.userId);
  return { published: true };
}
export async function withdrawPortalCharge(context: WorkspaceContext, raw: unknown) {
  const input = contract.publishChargeInput.parse(raw); context = await staff(context, input.clientId, true);
  const charge = await getCharge(context, { installmentId: input.installmentId });
  if (charge.installment.clientId !== input.clientId || charge.version !== input.version) throw conflict();
  await database.prepare('DELETE FROM client_portal_charge WHERE office_id=? AND client_id=? AND installment_id=? AND published_by=?')
    .run(context.officeId, input.clientId, input.installmentId, context.userId);
  return { published: false };
}

const MAX_BYTES = 20_000_000;
function validateFile(file: File, published: boolean) {
  const name = validatedFileName(file.name);
  const allowed = published ? ['.pdf'] : ['.pdf','.docx','.png','.jpg','.jpeg'];
  if (!allowed.includes(name.extension) || file.size < 1 || file.size > MAX_BYTES || name.file.length > 255)
    throw new CapabilityError('INVALID', published ? 'Publique um PDF de até 20 MB.' : 'Envie PDF, DOCX, PNG ou JPG de até 20 MB.');
  return name;
}
async function storeFile(context: WorkspaceContext | ClientContext, input: { officeId: string; clientId: string; userId: string; file: File; kind: 'published' | 'upload' | 'proof'; installmentId: string | null; idempotencyKey: string; sourceRef?: string; policy?: ContentPolicy; authorization?: ContentPolicy }, authorize: (tx: Transaction) => Promise<void>) {
  z.string().uuid().parse(input.idempotencyKey);
  const name = validateFile(input.file, input.kind === 'published');
  const bytes = Buffer.from(await input.file.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new CapabilityError('INVALID', 'O arquivo excede 20 MB.');
  if (name.extension === '.pdf' && bytes.subarray(0,5).toString() !== '%PDF-') throw new CapabilityError('INVALID', 'O arquivo não é um PDF válido.');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const id = randomUUID(), key = storageKey(input.officeId, id, name.extension), storage = await objectStorage();
  await storage.put(key, bytes);
  let retained = false;
  try {
    const result = await aclReadTransaction(async tx => {
      context.signal?.throwIfAborted();
      if (!await tx.prepare('SELECT id FROM crm_client WHERE office_id=? AND id=? FOR KEY SHARE').get(input.officeId, input.clientId)) throw missing();
      await authorize(tx);
      if (input.authorization) await assertPolicyAccess(input.userId, input.authorization, tx);
      if (input.sourceRef && !input.policy) throw missing();
      const policy = { ...input.policy ?? personPolicy('', ''), digest: hash };
      await assertExternalDelivery(input.userId, policy, tx);
      await tx.prepare(`INSERT INTO client_portal_file(id,office_id,client_id,kind,installment_id,name,mime_type,byte_size,storage_key,sha256,created_by,idempotency_key,source_ref,content_policy)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb) ON CONFLICT(office_id,client_id,created_by,idempotency_key) DO NOTHING`)
        .run(id, input.officeId, input.clientId, input.kind, input.installmentId, name.file, name.mimeType, bytes.length, key, hash, input.userId, input.idempotencyKey, input.sourceRef ?? null, JSON.stringify(policy));
      const row = await tx.prepare('SELECT id,name,kind,installment_id,sha256,source_ref FROM client_portal_file WHERE office_id=? AND client_id=? AND created_by=? AND idempotency_key=?')
        .get<{ id: string; name: string; kind: string; installment_id: string | null; sha256: string; source_ref: string | null }>(input.officeId, input.clientId, input.userId, input.idempotencyKey);
      if (!row || (row.sha256 !== hash && !input.sourceRef) || row.name !== name.file || row.kind !== input.kind || row.installment_id !== input.installmentId || row.source_ref !== (input.sourceRef ?? null)) throw conflict();
      await authorize(tx);
      if (input.authorization) await assertPolicyAccess(input.userId, input.authorization, tx);
      await assertExternalDelivery(input.userId, policy, tx);
      return row;
    });
    retained = result.id === id;
    return { id: result.id };
  } finally { if (!retained) await storage.delete(key).catch(() => undefined); }
}
export async function publishPortalFile(context: WorkspaceContext, clientId: string, file: File, idempotencyKey: string, sourceRef?: string, policy?: ContentPolicy, authorization?: ContentPolicy) {
  context = await staff(context, clientId, true);
  return storeFile(context, { officeId: context.officeId, clientId, userId: context.userId, file, kind: 'published', installmentId: null, idempotencyKey, sourceRef, policy, authorization }, async tx => { await staff(context, clientId, true, tx); });
}
export async function publishPortalArtifact(context: WorkspaceContext, raw: unknown) {
  const input = contract.publishArtifactInput.parse(raw); context = await staff(context, input.clientId, true);
  const artifact = await ownedArtifact(database, context, input.artifactId);
  if (!artifact || artifact.version !== input.version) throw conflict();
  const source = await artifactPolicy(context, artifact.id);
  const template = await pinnedArtifactTemplate(context, artifact, true);
  const policy = combinePolicy('', '', [source, ...(template ? [template.policy] : [])], source.origin);
  await assertExternalDelivery(context.userId, policy);
  const sourceRef = `artifact:${input.artifactId}:v${input.version}:template:${template ? JSON.stringify(template.identity) : 'none'}`;
  const replay = await database.prepare('SELECT id,source_ref FROM client_portal_file WHERE office_id=? AND client_id=? AND created_by=? AND idempotency_key=?')
    .get<{ id: string; source_ref: string | null }>(context.officeId, input.clientId, context.userId, input.idempotencyKey);
  if (replay) { if (replay.source_ref !== sourceRef) throw conflict(); await readFile(context.officeId, input.clientId, replay.id); await assertWorkspaceSession(context); return { id: replay.id }; }
  const bytes = await exportPdf(await exportDocument(artifact.content, template?.bytes));
  return publishPortalFile(context, input.clientId, new File([new Uint8Array(bytes)], `${artifact.title.slice(0,220)}.pdf`, { type: 'application/pdf' }), input.idempotencyKey, sourceRef, policy, template?.authorization);

}
export async function uploadClientFile(context: ClientContext, accessId: string, file: File, idempotencyKey: string, installmentId: string | null) {
  const access = await clientAccess(context, accessId);
  if (installmentId) await chargeForClient(access, installmentId);
  return storeFile(context, { officeId: access.office_id, clientId: access.client_id, userId: context.userId, file, kind: installmentId ? 'proof' : 'upload', installmentId, idempotencyKey }, async tx => {
    await clientAccess(context, accessId, tx, true);
    if (installmentId && !await tx.prepare('SELECT 1 FROM client_portal_charge WHERE office_id=? AND client_id=? AND installment_id=?').get(access.office_id, access.client_id, installmentId)) throw missing();
  });
}
async function assertPortalPolicy(row: { content_policy: unknown; sha256: string; source_ref: string | null; created_by: string }) {
  const missingRenderPolicy = Boolean(row.source_ref) && !row.content_policy;
  if (missingRenderPolicy) throw missing();
  if (row.content_policy) return assertExternalDelivery(row.created_by, parsePolicy(row.content_policy, row.sha256));
}
async function visiblePortalFiles(rows: Record<string, unknown>[]) {
  const visible = [];
  for (const row of rows) {
    try {
      await assertPortalPolicy(row as Parameters<typeof assertPortalPolicy>[0]);
      visible.push(row);
    } catch (error) { if (!(error instanceof CapabilityError)) throw error; }
  }
  return visible;
}
async function readFile(officeId: string, clientId: string, fileId: string) {
  const row = await database.prepare('SELECT name,mime_type,storage_key,sha256,created_by,source_ref,content_policy FROM client_portal_file WHERE id=? AND office_id=? AND client_id=? AND revoked_at IS NULL')
    .get<{ name: string; mime_type: string; storage_key: string; sha256: string; created_by: string; source_ref: string | null; content_policy: unknown }>(fileId, officeId, clientId);
  if (!row) throw missing();
  await assertPortalPolicy(row);
  const bytes = await (await objectStorage()).get(row.storage_key);
  if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new CapabilityError('NOT_READY', 'Não foi possível conferir a integridade do arquivo. Avise o escritório.');
  await assertPortalPolicy(row);
  return { bytes, name: row.name, mimeType: row.mime_type };
}
export async function downloadClientFile(context: ClientContext, accessId: string, fileId: string) {
  const access = await clientAccess(context, accessId);
  const file = await readFile(access.office_id, access.client_id, fileId);
  await clientAccess(context, accessId);
  if (!await database.prepare('SELECT 1 FROM client_portal_file WHERE id=? AND office_id=? AND revoked_at IS NULL').get(fileId, access.office_id)) throw missing();
  return file;
}
export async function downloadManagedFile(context: WorkspaceContext, clientId: string, fileId: string) {
  context = await staff(context, clientId);
  const file = await readFile(context.officeId, clientId, fileId); await staff(context, clientId);
  return file;
}
export async function removePortalFile(context: WorkspaceContext, clientId: string, fileId: string) {
  context = await staff(context, clientId, true);
  await database.prepare('UPDATE client_portal_file SET revoked_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND client_id=?').run(fileId, context.officeId, clientId);
  return { removed: true };
}
export async function downloadClientCharge(context: ClientContext, accessId: string, installmentId: string, format: 'pdf' | 'boleto', version: string | null) {
  const access = await clientAccess(context, accessId);
  const charge = await chargeForClient(access, installmentId);
  if (format === 'boleto') {
    if (!charge.boleto) throw missing();
    const publisher = await database.prepare('SELECT published_by AS created_by FROM client_portal_charge WHERE office_id=? AND installment_id=?').get<{ created_by: string }>(access.office_id, installmentId);
    if (!publisher) throw missing();
    await assertExternalDelivery(publisher.created_by, await vaultPolicy(charge.boleto.id));
    const file = await readVaultDocumentFile(access.office_id, charge.boleto.id, publisher.created_by);
    await assertExternalDelivery(publisher.created_by, await vaultPolicy(charge.boleto.id));
    await clientAccess(context, accessId);
    const current = await chargeForClient(access, installmentId);
    if (current.boleto?.id !== charge.boleto.id) throw conflict();
    return { bytes: file.buffer, name: file.name, mimeType: file.mimeType };
  }
  if (!charge.pdfUrl || version !== String(charge.version)) throw conflict();
  const bytes = await exportPdf(await exportDocument(`# Cobrança de honorários\n\n${charge.message.split('\n').join('\n\n')}`));
  await clientAccess(context, accessId);
  const current = await chargeForClient(access, installmentId);
  if (!current.pdfUrl || current.version !== charge.version || current.installment.pendingCents !== charge.installment.pendingCents) throw conflict();
  return { bytes, name: 'cobranca.pdf', mimeType: 'application/pdf' };
}
