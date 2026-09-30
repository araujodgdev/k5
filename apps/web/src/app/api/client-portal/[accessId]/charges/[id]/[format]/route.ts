import { z } from 'zod';
import { ApiError, apiError } from '@/lib/workspace-api';
import { apiClientPortal, portalFileResponse } from '@/lib/client-portal/http';
import { downloadClientCharge } from '@/lib/client-portal/service';
import { DocumentPdfError } from '@/lib/document-pdf-contract';
export async function GET(request: Request, { params }: { params: Promise<{ accessId: string; id: string; format: string }> }) {
  try { const context = await apiClientPortal(request); const { accessId, id, format } = await params;
    return portalFileResponse(await downloadClientCharge(context, accessId, id, z.enum(['pdf','boleto']).parse(format), new URL(request.url).searchParams.get('version'))); }
  catch (error) { return apiError(error instanceof DocumentPdfError ? new ApiError(error.status, error.message) : error); }
}
