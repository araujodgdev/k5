import { apiWorkspace, apiError, ApiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { getCharge } from '@/lib/honorarios/charges';
import { exportDocument } from '@/lib/document-export';
import { exportPdf } from '@/lib/document-pdf';
import { DocumentPdfError } from '@/lib/document-pdf-contract';
import { auth } from '@/lib/auth';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = workspaceContext(await apiWorkspace(request));
    const { id } = await params;
    const charge = await getCharge(context, { installmentId: id });
    if (!charge.pdfUrl || new URL(request.url).searchParams.get('version') !== String(charge.version))
      throw new ApiError(409, 'Reabra a cobrança atual antes de baixar o PDF.');
    const bytes = await exportPdf(await exportDocument(`# Cobrança de honorários\n\n${charge.message.split('\n').join('\n\n')}`));
    const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true, disableRefresh: true } });
    if (!session || session.user.id !== context.userId) throw new ApiError(401, 'Entre novamente para continuar.');
    const current = await getCharge(context, { installmentId: id });
    if (!current.pdfUrl || current.version !== charge.version || current.installment.pendingCents !== charge.installment.pendingCents)
      throw new ApiError(409, 'O saldo ou a cobrança mudou. Reabra a versão atual.');
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="cobranca.pdf"',
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return apiError(error instanceof DocumentPdfError ? new ApiError(error.status, error.message) : error); }
}
