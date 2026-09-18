import { assertSameOrigin, createVaultDocument, listVaultDocuments, publicDocument, requireVaultWorkspace, requireVaultWriteRole, VaultHttpError } from "@/lib/vault";
import { vaultErrorResponse } from "@/lib/vault-api";
import { workspaceContext } from "@/lib/application/context";
import { consumeUploadRef, createUploadRef } from "@/lib/application/uploads-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { office } = await requireVaultWorkspace();
    const url = new URL(request.url);
    return Response.json({ documents: listVaultDocuments(office.officeId, { scope: url.searchParams.get("scope"), caseId: url.searchParams.get("caseId") }) });
  } catch (error) { return vaultErrorResponse(error); }
}

/**
 * The interface's one-shot upload: store the bytes, then ingest the reference the server just
 * minted. Both halves go through the same path an agent uses, so there is one storage key format
 * and one validation, not a second one that happens to skip it.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const workspace = await requireVaultWorkspace();
    requireVaultWriteRole(workspace.office.role);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new VaultHttpError(400, "Escolha um arquivo para enviar.");
    const context = workspaceContext(workspace);
    const upload = await createUploadRef(context, file);
    // Consumed here, in the same request that created it: an unclaimed reference is garbage the
    // sweeper is entitled to delete, and it would take this document's bytes with it.
    consumeUploadRef(context, upload.id);
    const document = createVaultDocument(context.officeId, context.userId, upload, {
      scope: String(form.get("scope") ?? ""),
      caseId: typeof form.get("caseId") === "string" ? String(form.get("caseId")) : null,
    });
    // Public projection only: the stored key, the office id and the lease never leave the server.
    return Response.json({ document: publicDocument(document) }, { status: 201 });
  } catch (error) { return vaultErrorResponse(error); }
}
