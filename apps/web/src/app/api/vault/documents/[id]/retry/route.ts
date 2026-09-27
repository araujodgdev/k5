import { after } from "next/server";
import { assertSameOrigin, drainQueuedDocument, requireVaultWorkspace, requireVaultWriteRole, retryVaultDocument } from "@/lib/vault";
import { vaultErrorResponse } from "@/lib/vault-api";
import { documentAccess } from '@/lib/collaboration/access';
import { workspaceContext, assertCapabilityAllowed } from '@/lib/application/context';

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const workspace = await requireVaultWorkspace();
    const documentId = (await params).id;
    const context = await assertCapabilityAllowed(await documentAccess(workspaceContext(workspace), documentId), 'k5_vault_retry_ingestion');
    requireVaultWriteRole(context.role);
    await retryVaultDocument(context.officeId, documentId);
    // Requeueing is not reprocessing. Without this the row goes back to `queued` and waits for a
    // worker that does not exist on Workers, which is the stall the button was pressed to clear.
    after(() => drainQueuedDocument(context.officeId, documentId));
    return Response.json({ ok: true });
  } catch (error) { return vaultErrorResponse(error); }
}
