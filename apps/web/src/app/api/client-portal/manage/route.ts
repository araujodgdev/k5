import { z } from 'zod';
import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import * as portal from '@/lib/client-portal/service';
import * as contract from '@/lib/client-portal/contracts';
import { DocumentPdfError } from '@/lib/document-pdf-contract';
import { ApiError } from '@/lib/workspace-api';

export async function GET(request: Request) {
  try { return Response.json(await portal.managePortal(workspaceContext(await apiWorkspace(request)), contract.clientId.parse(new URL(request.url).searchParams.get('clientId'))), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const context = workspaceContext(await apiWorkspace(request, true));
    const input = z.object({ operation: z.enum(['invite','revoke','publish-charge','publish-artifact','remove-file','withdraw-charge']), data: z.record(z.string(), z.unknown()) }).parse(await limitedJson(request));
    switch (input.operation) {
      case 'invite': return Response.json(await portal.invitePortal(context, input.data));
      case 'revoke': return Response.json(await portal.revokePortal(context, input.data));
      case 'publish-charge': return Response.json(await portal.publishPortalCharge(context, input.data));
      case 'publish-artifact': return Response.json(await portal.publishPortalArtifact(context, input.data));
      case 'remove-file': { const data = z.object({ clientId: contract.clientId, fileId: z.string().uuid() }).parse(input.data); return Response.json(await portal.removePortalFile(context, data.clientId, data.fileId)); }
      case 'withdraw-charge': return Response.json(await portal.withdrawPortalCharge(context, input.data));
    }
  } catch (error) { return apiError(error instanceof DocumentPdfError ? new ApiError(error.status, error.message) : error); }
}
