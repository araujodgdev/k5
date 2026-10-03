import { database } from '@/lib/database';
import { apiWorkspace, apiError, ApiError } from '@/lib/workspace-api';
import { ownedArtifact } from '@/lib/ai-store';
import { exportDocument } from '@/lib/document-export';
import { readVaultDocumentFile } from '@/lib/vault';
import { resolveDocumentTemplateId } from '@/lib/agent-profile';
import { exportPdf } from '@/lib/document-pdf';
import { exportPdfcn } from '@/lib/document-pdfcn';
import { DocumentPdfError } from '@/lib/document-pdf-contract';
import { auth } from '@/lib/auth';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const url = new URL(request.url);
    const format = url.searchParams.get('format') ?? 'docx';
    const engine = url.searchParams.get('engine');
    if (engine !== null && engine !== 'pdfcn') throw new ApiError(400, 'Motor de exportação inválido.');
    if (format !== 'docx' && format !== 'pdf') throw new ApiError(400, 'Escolha PDF ou DOCX.');
    const { office, user } = await apiWorkspace(request);
    const artifact = await ownedArtifact(database, { officeId: office.officeId, userId: user.id }, (await context.params).id);
    if (!artifact) throw new ApiError(404, 'Documento não encontrado.');
    const version = url.searchParams.get('version');
    if (version !== null && version !== String(artifact.version)) throw new ApiError(409, 'O documento foi alterado. Reabra a versão atual para exportar.');
    // A template picked for this document wins; otherwise the current letterhead applies, so a new
    // letterhead reaches documents written before it was set.
    const owner = { officeId: office.officeId, userId: user.id };
    const templateId = artifact.template_id ?? await resolveDocumentTemplateId(owner);
    const file = templateId ? await readVaultDocumentFile(office.officeId, templateId, user.id).catch(() => undefined) : undefined;
    const template = file?.name.toLowerCase().endsWith('.docx') ? file.buffer : undefined;
    const usePdfcn = format === 'pdf' && (engine === 'pdfcn' || !template);
    const bytes = usePdfcn ? await exportPdfcn({ title: artifact.title, content: artifact.content })
      : format === 'pdf' ? await exportPdf(await exportDocument(artifact.content, template)) : new Uint8Array(await exportDocument(artifact.content, template));
    const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true, disableRefresh: true } });
    if (!session || session.user.id !== user.id || !await database.prepare('SELECT id FROM office_member WHERE office_id=? AND user_id=?').get(office.officeId, user.id)) throw new ApiError(401, 'Entre novamente para continuar.');
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': `attachment; filename="documento.${format}"; filename*=UTF-8''${encodeURIComponent(artifact.title)}.${format}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Document-Version': String(artifact.version) } });
  } catch (e) { return apiError(e instanceof DocumentPdfError ? new ApiError(e.status, e.message) : e); }
}
