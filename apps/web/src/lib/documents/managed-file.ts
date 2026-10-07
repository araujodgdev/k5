import 'server-only';
import { z } from 'zod';
import { aclReadTransaction } from '@/lib/acl-transaction';
import { database, type Transaction } from '@/lib/database';
import { assertWorkspaceSession, type WorkspaceContext } from '@/lib/application/context';
import { assertExternalDelivery, assertPolicyAccess, bytesDigest, observeVaultFile, parsePolicy, policyUnavailable, vaultPolicy, type ContentPolicy } from '@/lib/content-policy';
import { readVaultOriginal } from '@/lib/vault';

export type ManagedFile = {
  documentId: string; version: number; versionId: string; sha256: string; byteSize: number; storedName: string; name: string; mimeType: string;
  originalContribution: { kind: 'independent-upload'; userId: string; versionId: string } | null;
  accessPolicy: ContentPolicy; disclosurePolicy: ContentPolicy;
};
const bindingSchema = z.object({ documentId:z.string(),version:z.number().int().positive(),versionId:z.string(),sha256:z.string(),byteSize:z.number().int().nonnegative(),storedName:z.string(),name:z.string(),mimeType:z.string(),
  originalContribution:z.object({kind:z.literal('independent-upload'),userId:z.string(),versionId:z.string()}).nullable(),accessPolicy:z.unknown(),disclosurePolicy:z.unknown() });
export function parseManagedFile(raw: unknown): ManagedFile {
  const result=bindingSchema.safeParse(raw);
  if(!result.success || result.data.originalContribution && result.data.originalContribution.versionId !== result.data.versionId) throw policyUnavailable();
  return {...result.data,accessPolicy:parsePolicy(result.data.accessPolicy),disclosurePolicy:parsePolicy(result.data.disclosurePolicy)};
}

export async function managedFile(context: WorkspaceContext, documentId: string, version?: number, db: Transaction = database): Promise<ManagedFile> {
  if (db === database) return aclReadTransaction(tx => managedFile(context, documentId, version, tx));
  await assertWorkspaceSession(context, db);
  const source = await observeVaultFile(context.userId, documentId, db, version);
  const row = await db.prepare('SELECT id,byte_size,mime_type,independent_upload_by FROM vault_document_version WHERE document_id=? AND version=?')
    .get<{ id: string; byte_size: number; mime_type: string; independent_upload_by: string | null }>(documentId, source.version);
  if (!row) throw policyUnavailable();
  const inherited = await vaultPolicy(documentId, source.version, db);
  const independent = row.independent_upload_by === context.userId && inherited.origin === 'person' && inherited.eligible && !inherited.guards.length && !inherited.owners.length;

  const disclosurePolicy = independent ? { ...inherited, observed: source.policy.observed } : source.policy;
  return { documentId, version: source.version, versionId: row.id, originalContribution: independent ? { kind: 'independent-upload', userId: context.userId, versionId: row.id } : null,
    sha256: source.sha256, byteSize: Number(row.byte_size), storedName: source.stored_name,
    name: source.original_name, mimeType: row.mime_type, accessPolicy: source.policy, disclosurePolicy };
}

export async function assertManagedAccess(context: WorkspaceContext, file: ManagedFile, db: Transaction = database): Promise<void> {
  if (db === database) return aclReadTransaction(tx => assertManagedAccess(context, file, tx));
  await assertWorkspaceSession(context, db);
  await assertPolicyAccess(context.userId, parsePolicy(file.accessPolicy), db);
  const current = await observeVaultFile(context.userId, file.documentId, db, file.version);
  const pinned = await db.prepare('SELECT id,byte_size FROM vault_document_version WHERE document_id=? AND version=?').get<{ id: string; byte_size: number }>(file.documentId,file.version);
  if (!pinned || pinned.id !== file.versionId || Number(pinned.byte_size) !== file.byteSize) throw policyUnavailable();
  if (current.sha256 !== file.sha256 || current.stored_name !== file.storedName) throw policyUnavailable();
  await assertWorkspaceSession(context, db);
}

export async function assertManagedDisclosure(context: WorkspaceContext, file: ManagedFile, recipient?: string, db: Transaction = database): Promise<void> {
  if (db === database) return aclReadTransaction(tx => assertManagedDisclosure(context, file, recipient, tx));
  await assertManagedAccess(context, file, db);
  if (recipient) await assertPolicyAccess(recipient, parsePolicy(file.disclosurePolicy), db);
  else await assertExternalDelivery(context.userId, parsePolicy(file.disclosurePolicy), db);
}

export async function stageManagedFile(context: WorkspaceContext, file: ManagedFile) {
  await assertManagedAccess(context, file);
  const bytes = await readVaultOriginal({ storedName: file.storedName });
  if (bytes.length !== file.byteSize || bytesDigest(bytes) !== file.sha256) throw policyUnavailable();
  await assertManagedAccess(context, file);
  return bytes;
}
