import { after } from 'next/server';
import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { ingestUpload } from '@/lib/application/vault-service';
import { drainQueuedDocument } from '@/lib/vault';
import { z } from 'zod';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const workspace = await apiWorkspace(request, true);
    const body = z.object({
      uploadRef: z.string().min(1),
      scope: z.enum(['library', 'case']),
      caseId: z.string().optional(),
    }).parse(await limitedJson(request));
    const context = workspaceContext(workspace);
    const result = await ingestUpload(context, body);
    // The same kick the browser upload does. This is the path an agent takes, and without it a
    // document the agent files stays queued while the chat reports it as filed.
    after(() => drainQueuedDocument(context.officeId, result.document.id));
    return Response.json(result, { status: 201 });
  } catch (error) { return apiError(error); }
}
