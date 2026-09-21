import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { getDocument, updateDocument, deleteDocument } from '@/lib/application/vault-service';
import { z } from 'zod';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const workspace = await apiWorkspace(request);
    const documentId = (await context.params).id;
    const result = await getDocument(workspaceContext(workspace), { documentId });
    return Response.json(result);
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const workspace = await apiWorkspace(request, true);
    const documentId = (await context.params).id;
    const body = z.object({
      name: z.string().trim().min(1).max(255).optional(),
      caseId: z.string().nullable().optional(),
    }).parse(await limitedJson(request));
    const result = await updateDocument(workspaceContext(workspace), { documentId, name: body.name, caseId: body.caseId });
    return Response.json(result);
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const workspace = await apiWorkspace(request, true);
    const documentId = (await context.params).id;
    let body: { approvalId?: string } = {};
    try {
      body = z.object({ approvalId: z.string().optional() }).parse(await limitedJson(request));
    } catch {
      // Empty body allowed
    }
    const result = await deleteDocument(workspaceContext(workspace), { documentId, approvalId: body.approvalId });
    return Response.json(result);
  } catch (error) { return apiError(error); }
}
