import { z } from 'zod';
import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { canEditTemplate, documentTemplates, setDocumentTemplate } from '@/lib/agent-profile';

export const runtime = 'nodejs';

function permissions(role: Parameters<typeof canEditTemplate>[0]) {
  return { canEditOffice: canEditTemplate(role, 'office'), canEditPersonal: canEditTemplate(role, 'personal') };
}

export async function GET(request: Request) {
  try {
    const workspace = await apiWorkspace(request);
    const context = workspaceContext(workspace);
    return Response.json({ ...await documentTemplates(context), ...permissions(context.role) });
  } catch (error) { return apiError(error); }
}

/** `documentId: null` removes the template for that scope. */
export async function PUT(request: Request) {
  try {
    const workspace = await apiWorkspace(request, true);
    const context = workspaceContext(workspace);
    const body = z.object({ scope: z.enum(['office', 'personal']), documentId: z.string().min(1).max(64).nullable() }).parse(await limitedJson(request));
    return Response.json({ ...await setDocumentTemplate(context, body.scope, body.documentId), ...permissions(context.role) });
  } catch (error) { return apiError(error); }
}
