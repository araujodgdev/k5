import { after } from "next/server";
import { assertSameOrigin, createVaultDocument, drainQueuedDocument, listVaultDocuments, publicDocument, requireVaultWorkspace, requireVaultWriteRole, VaultHttpError } from "@/lib/vault";
import { vaultErrorResponse } from "@/lib/vault-api";
import { workspaceContext } from "@/lib/application/context";
import { consumeUploadRef, createUploadRef } from "@/lib/application/uploads-service";
import { contextForCase } from '@/lib/collaboration/access';
import { assertCapabilityAllowed } from '@/lib/application/context';
import { limitedFormData } from '@/lib/workspace-api';
import { MAX_UPLOAD_BYTES } from '@/lib/application/uploads-service';

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const workspace = await requireVaultWorkspace();
    const url = new URL(request.url);
    const caseId = url.searchParams.get('caseId');
    const context = await assertCapabilityAllowed(caseId ? await contextForCase(workspaceContext(workspace), caseId) : workspaceContext(workspace), 'k5_vault_list_documents');
    const folder = url.searchParams.get("folderId");
    return Response.json({
      documents: await listVaultDocuments(context.officeId, {
        scope: url.searchParams.get("scope"),
        caseId: url.searchParams.get("caseId"),
        // `folderId=root` is how the browser asks for a case's own level, as distinct from "any folder".
        ...(folder === null ? {} : { folderId: folder === "root" ? null : folder }),
      }),
    });
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
    const form = await limitedFormData(request, MAX_UPLOAD_BYTES + 64_000);
    const file = form.get("file");
    if (!(file instanceof File)) throw new VaultHttpError(400, "Escolha um arquivo para enviar.");
    const caseId = form.get('scope') === 'case' && typeof form.get('caseId') === 'string' ? String(form.get('caseId')) : null;
    const context = await assertCapabilityAllowed(caseId ? await contextForCase(workspaceContext(workspace), caseId) : workspaceContext(workspace), 'k5_vault_ingest_upload');
    requireVaultWriteRole(context.role);
    const upload = await createUploadRef(context, file);
    // Consumed here, in the same request that created it: an unclaimed reference is garbage the
    // sweeper is entitled to delete, and it would take this document's bytes with it.
    await consumeUploadRef(context, upload.id);
    const document = await createVaultDocument(context.officeId, context.userId, upload, {
      scope: String(form.get("scope") ?? ""),
      caseId: typeof form.get("caseId") === "string" ? String(form.get("caseId")) : null,
      folderId: typeof form.get("folderId") === "string" ? String(form.get("folderId")) : null,
    });
    const officeId = context.officeId;
    const documentId = document.id;
    // The arrow returns the promise rather than dropping it: `after` only keeps the runtime alive
    // for the promise it is handed, and a dropped chain here leaves the document queued forever.
    after(() => drainQueuedDocument(officeId, documentId));
    // Public projection only: the stored key, the office id and the lease never leave the server.
    return Response.json({ document: publicDocument(document) }, { status: 201 });
  } catch (error) { return vaultErrorResponse(error); }
}
