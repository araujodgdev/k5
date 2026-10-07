import { managedFile, stageManagedFile } from './documents/managed-file';
import 'server-only';
import type { ArtifactRow, Owner } from './ai-store';
import { resolveDocumentTemplateId } from './agent-profile';
import { exportDocument } from './document-export';
import { exportPdfcn } from './document-pdfcn';
import { database } from './database';
import { artifactPolicy, assertPolicyAccess, bytesDigest, combinePolicy, policyUnavailable, type ContentPolicy } from './content-policy';

export const PDF_MIME = 'application/pdf';
export const DOCX_FILE_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * The Word template a document is exported with. A template picked for this document wins;
 * otherwise the current letterhead applies, so a new letterhead reaches documents written before it.
 */
export async function artifactTemplate(owner: Owner, artifact: ArtifactRow) {
  return (await pinnedArtifactTemplate(owner, artifact))?.bytes;
}

export async function pinnedArtifactTemplate(owner: Owner, artifact: ArtifactRow, discloseOriginal = false) {
  const templateId = artifact.template_id ?? await resolveDocumentTemplateId(owner);
  if (!templateId) return null;
  const file = await managedFile(owner, templateId);
  const bytes = await stageManagedFile(owner,file);
  if (!file.name.toLowerCase().endsWith('.docx')) throw policyUnavailable();
  return { bytes, policy: discloseOriginal ? file.disclosurePolicy : file.accessPolicy, authorization: file.accessPolicy,
    identity: { kind: 'document' as const, id: file.documentId, version: String(file.version), digest: file.sha256 } };
}

/**
 * The file a Lume document is saved to the Vault as. PDF uses the PDFcn layout and DOCX the
 * template, so neither depends on the LibreOffice converter.
 */
export async function artifactVaultFile(owner: Owner, artifact: ArtifactRow, format: 'pdf' | 'docx') {
  const policy = await artifactPolicy(owner, artifact.id, database, artifact.version);
  await assertPolicyAccess(owner.userId, policy);
  const template = format === 'docx' ? await pinnedArtifactTemplate(owner, artifact) : null;
  const bytes = format === 'pdf'
    ? await exportPdfcn({ title: artifact.title, content: artifact.content })
    : new Uint8Array(await exportDocument(artifact.content, template?.bytes));
  const retained: ContentPolicy = { ...combinePolicy('', '', [policy, ...(template ? [template.policy] : [])], policy.origin), digest: bytesDigest(bytes) };
  await assertPolicyAccess(owner.userId, retained);
  return { bytes, policy: retained, template: template?.identity ?? null, mimeType: format === 'pdf' ? PDF_MIME : DOCX_FILE_MIME, extension: `.${format}` };
}
