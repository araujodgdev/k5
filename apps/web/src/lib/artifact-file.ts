import 'server-only';
import type { ArtifactRow, Owner } from './ai-store';
import { resolveDocumentTemplateId } from './agent-profile';
import { exportDocument } from './document-export';
import { exportPdfcn } from './document-pdfcn';
import { readVaultDocumentFile } from './vault';

export const PDF_MIME = 'application/pdf';
export const DOCX_FILE_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * The Word template a document is exported with. A template picked for this document wins;
 * otherwise the current letterhead applies, so a new letterhead reaches documents written before it.
 */
export async function artifactTemplate(owner: Owner, artifact: ArtifactRow) {
  const templateId = artifact.template_id ?? await resolveDocumentTemplateId(owner);
  const file = templateId ? await readVaultDocumentFile(owner.officeId, templateId, owner.userId).catch(() => undefined) : undefined;
  return file?.name.toLowerCase().endsWith('.docx') ? file.buffer : undefined;
}

/**
 * The file a Lume document is saved to the Vault as. PDF uses the PDFcn layout and DOCX the
 * template, so neither depends on the LibreOffice converter.
 */
export async function artifactVaultFile(owner: Owner, artifact: ArtifactRow, format: 'pdf' | 'docx') {
  const bytes = format === 'pdf'
    ? await exportPdfcn({ title: artifact.title, content: artifact.content })
    : new Uint8Array(await exportDocument(artifact.content, await artifactTemplate(owner, artifact)));
  return { bytes, mimeType: format === 'pdf' ? PDF_MIME : DOCX_FILE_MIME, extension: `.${format}` };
}
