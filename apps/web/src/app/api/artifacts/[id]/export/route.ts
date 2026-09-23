import { database } from '@/lib/database';
import { apiWorkspace, apiError, ApiError } from '@/lib/workspace-api';
import { ownedArtifact } from '@/lib/ai-store';
import { exportDocument } from '@/lib/document-export';
import { readVaultDocumentFile } from '@/lib/vault';
import { resolveDocumentTemplateId } from '@/lib/agent-profile';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { office, user } = await apiWorkspace(request);
    const artifact = await ownedArtifact(database, { officeId: office.officeId, userId: user.id }, (await context.params).id);
    if (!artifact) throw new ApiError(404, 'Documento não encontrado.');
    // A template picked for this document wins; otherwise the current letterhead applies, so a new
    // letterhead reaches documents written before it was set.
    const owner = { officeId: office.officeId, userId: user.id };
    const templateId = artifact.template_id ?? await resolveDocumentTemplateId(owner);
    const file = templateId ? await readVaultDocumentFile(office.officeId, templateId).catch(() => undefined) : undefined;
    const template = file?.name.toLowerCase().endsWith('.docx') ? file.buffer : undefined;
    const buffer = await exportDocument(artifact.content, template);
    return new Response(new Uint8Array(buffer), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': `attachment; filename="minuta-k5.docx"; filename*=UTF-8''${encodeURIComponent(artifact.title)}.docx`, 'Cache-Control': 'private, no-store' } });
  } catch (e) { return apiError(e); }
}
