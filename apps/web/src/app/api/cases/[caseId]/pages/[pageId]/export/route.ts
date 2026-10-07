import { apiWorkspace, apiError, ApiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { getPage } from '@/lib/case-pages/service';
import { exportDocument } from '@/lib/document-export';
import { exportPdfcn } from '@/lib/document-pdfcn';
import { DocumentPdfError } from '@/lib/document-pdf-contract';

export async function GET(request: Request, context: { params: Promise<{ caseId: string; pageId: string }> }) {
  try {
    const actor = workspaceContext(await apiWorkspace(request));
    const params = await context.params;
    const { page } = await getPage(actor, params);
    const url = new URL(request.url);
    const format = url.searchParams.get('format') ?? 'docx';
    if (format !== 'docx' && format !== 'pdf') throw new ApiError(400, 'Escolha PDF ou DOCX.');
    const version = url.searchParams.get('version');
    if (version !== null && version !== String(page.version)) throw new ApiError(409, 'A página mudou. Reabra a versão atual para exportar.');
    const bytes = format === 'pdf' ? await exportPdfcn(page) : await exportDocument(page.content);
    const current = await getPage(actor, params);
    if (current.page.version !== page.version) throw new ApiError(409, 'A página mudou durante a exportação. Tente novamente.');
    return new Response(new Uint8Array(bytes), { headers: {
      'Content-Type': format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="pagina.${format}"; filename*=UTF-8''${encodeURIComponent(page.title)}.${format}`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Document-Version': String(page.version),
    } });
  } catch (error) { return apiError(error instanceof DocumentPdfError ? new ApiError(error.status, error.message) : error); }
}
