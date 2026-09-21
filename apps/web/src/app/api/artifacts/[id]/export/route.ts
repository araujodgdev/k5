import { database } from '@/lib/database';
import { apiWorkspace, apiError, ApiError } from '@/lib/workspace-api';
import { ownedArtifact } from '@/lib/ai-store';
import { exportDocument } from '@/lib/document-export';
import { readVaultDocumentFile } from '@/lib/vault';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { office, user } = await apiWorkspace(request);
    const artifact = await ownedArtifact(database, { officeId: office.officeId, userId: user.id }, (await context.params).id);
    if (!artifact) throw new ApiError(404, 'Documento não encontrado.');
    const file = artifact.template_id ? await readVaultDocumentFile(office.officeId, artifact.template_id) : undefined;
    const template = file?.name.toLowerCase().endsWith('.docx') ? file.buffer : undefined;
    const buffer = await exportDocument(artifact.content, template);
    return new Response(new Uint8Array(buffer), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': `attachment; filename="minuta-k5.docx"; filename*=UTF-8''${encodeURIComponent(artifact.title)}.docx`, 'Cache-Control': 'private, no-store' } });
  } catch (e) { return apiError(e); }
}
