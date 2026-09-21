import { after } from "next/server";
import { assertSameOrigin, createVaultDocument, listVaultDocuments, processDocumentIfQueued, publicDocument, requireVaultWorkspace, requireVaultWriteRole, VaultHttpError } from "@/lib/vault";
import { vaultErrorResponse } from "@/lib/vault-api";
import { workspaceContext } from "@/lib/application/context";
import { consumeUploadRef, createUploadRef } from "@/lib/application/uploads-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { office } = await requireVaultWorkspace();
    const url = new URL(request.url);
    const folder = url.searchParams.get("folderId");
    return Response.json({
      documents: await listVaultDocuments(office.officeId, {
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
    requireVaultWriteRole(workspace.office.role);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new VaultHttpError(400, "Escolha um arquivo para enviar.");
    const context = workspaceContext(workspace);
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
    // Awaited, not fire-and-forget: `after` only keeps the runtime alive for the promise it is
    // handed, and a dropped chain here leaves the document queued forever.
    after(async () => {
      try {
        const started = await processDocumentIfQueued(officeId, documentId);
        if (!started) return;
        try {
          const { processNextIndexJob } = await import("@/lib/knowledge/indexing");
          await processNextIndexJob();
        } catch {
          // Lexical search is already available once extraction finishes.
        }
      } catch (error) {
        console.error("Ingestão após envio:", error instanceof Error ? error.message : error);
      }
    });
    // Public projection only: the stored key, the office id and the lease never leave the server.
    return Response.json({ document: publicDocument(document) }, { status: 201 });
  } catch (error) { return vaultErrorResponse(error); }
}
