import { apiError, apiWorkspace, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { getSignatureConnection, saveSignatureConnection } from '@/lib/signatures/service';
export async function GET(request: Request) {
  try { return Response.json(await getSignatureConnection(workspaceContext(await apiWorkspace(request))), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try { return Response.json(await saveSignatureConnection(workspaceContext(await apiWorkspace(request, true)), await limitedJson(request, 4096)), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return apiError(error); }
}
