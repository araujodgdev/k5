import { after } from 'next/server';
import { apiPersonalWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext, assertCapabilityAllowed } from '@/lib/application/context';
import { scopeCapability } from '@/lib/collaboration/capability-access';
import { ingestUpload } from '@/lib/application/vault-service';
import { drainQueuedDocument } from '@/lib/vault';
import { capabilities } from '@/lib/capabilities/contracts';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const workspace = await apiPersonalWorkspace(request, true);
    const body = capabilities.k5_vault_ingest_upload.input.parse(await limitedJson(request));
    const context = await assertCapabilityAllowed(await scopeCapability(workspaceContext(workspace), 'k5_vault_ingest_upload', body), 'k5_vault_ingest_upload');
    const result = await ingestUpload(context, body);
    // The same kick the browser upload does. This is the path an agent takes, and without it a
    // document the agent files stays queued while the chat reports it as filed.
    after(() => drainQueuedDocument(context.officeId, result.document.id));
    return Response.json(result, { status: 201 });
  } catch (error) { return apiError(error); }
}
