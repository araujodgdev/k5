import { database } from '@/lib/database';
import { apiWorkspace, apiError, ApiError } from '@/lib/workspace-api';
import { ownedArtifact } from '@/lib/ai-store';
import { docxTypography } from '@/lib/document-export';
import { readVaultDocumentFile } from '@/lib/vault';
import { resolveDocumentTemplateId } from '@/lib/agent-profile';

export const runtime = 'nodejs';

/** The typography of the Word template this document exports with, for the editor to match. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { office, user } = await apiWorkspace(request);
    const owner = { officeId: office.officeId, userId: user.id };
    const artifact = await ownedArtifact(database, owner, (await context.params).id);
    if (!artifact) throw new ApiError(404, 'Documento não encontrado.');
    const templateId = artifact.template_id ?? await resolveDocumentTemplateId(owner);
    const file = templateId ? await readVaultDocumentFile(office.officeId, templateId).catch(() => undefined) : undefined;
    const docx = file?.name.toLowerCase().endsWith('.docx') ? file : undefined;
    let typography = null;
    try { typography = docx ? docxTypography(docx.buffer) : null; } catch { typography = null; }
    return Response.json({ typography, templateName: docx?.name ?? null }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}
