import { findVaultDocument, readVaultOriginal, requireVaultWorkspace, VaultHttpError } from "@/lib/vault";
import { vaultErrorResponse } from "@/lib/vault-api";
import { documentAccess } from '@/lib/collaboration/access';
import { workspaceContext, assertCapabilityAllowed } from '@/lib/application/context';

export const runtime = "nodejs";

function contentDisposition(name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspace = await requireVaultWorkspace();
    const id = (await params).id;
    const context = await assertCapabilityAllowed(await documentAccess(workspaceContext(workspace), id), 'k5_vault_download_document');
    const document = await findVaultDocument(context.officeId, id);
    if (!document || (context.caseScope && document.caseId !== context.caseScope.caseId)) throw new VaultHttpError(404, "Documento não encontrado.");
    const file = await readVaultOriginal(document);
    await assertCapabilityAllowed(await documentAccess(context, id), 'k5_vault_download_document');
    return new Response(new Uint8Array(file), { headers: { "content-type": document.mimeType, "content-length": String(file.length), "content-disposition": contentDisposition(document.name), "x-content-type-options": "nosniff", "cache-control": "private, no-store" } });
  } catch (error) { return vaultErrorResponse(error); }
}
