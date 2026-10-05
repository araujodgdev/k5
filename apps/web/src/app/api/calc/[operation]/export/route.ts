import { z } from 'zod';
import { apiWorkspace, apiError, ApiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { getCalculation } from '@/lib/calc/service';
import { calculationCsv, calculationMarkdown } from '@/lib/calc/export';
import { renderLegalPdf } from '@/lib/calc/pdf';
import { DocumentPdfError } from '@/lib/document-pdf-contract';

export async function GET(request: Request, { params }: { params: Promise<{ operation: string }> }) {
  try {
    const context = workspaceContext(await apiWorkspace(request));
    const { operation: id } = await params;
    const url = new URL(request.url);
    const format = z.enum(['pdf', 'csv', 'json']).parse(url.searchParams.get('format'));
    const version = z.coerce.number().int().positive().parse(url.searchParams.get('version'));
    const value = await getCalculation(context, { id, version });
    const headers = { 'Content-Disposition': `attachment; filename="calculo-v${version}.${format}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
    if (format === 'json') return new Response(JSON.stringify(value, null, 2), { headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
    if (format === 'csv') return new Response(calculationCsv(value), { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' } });
    const bytes = await renderLegalPdf(value.title, calculationMarkdown(value));
    await getCalculation(context, { id, version });
    return new Response(new Uint8Array(bytes), { headers: { ...headers, 'Content-Type': 'application/pdf' } });
  } catch (error) { return apiError(error instanceof DocumentPdfError ? new ApiError(error.status, error.message) : error); }
}
