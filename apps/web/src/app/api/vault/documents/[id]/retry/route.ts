import { after } from "next/server";
import { assertSameOrigin, drainQueuedDocument, requireVaultWorkspace, requireVaultWriteRole, retryVaultDocument } from "@/lib/vault";
import { vaultErrorResponse } from "@/lib/vault-api";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { office } = await requireVaultWorkspace();
    requireVaultWriteRole(office.role);
    const documentId = (await params).id;
    await retryVaultDocument(office.officeId, documentId);
    // Requeueing is not reprocessing. Without this the row goes back to `queued` and waits for a
    // worker that does not exist on Workers, which is the stall the button was pressed to clear.
    after(() => drainQueuedDocument(office.officeId, documentId));
    return Response.json({ ok: true });
  } catch (error) { return vaultErrorResponse(error); }
}
