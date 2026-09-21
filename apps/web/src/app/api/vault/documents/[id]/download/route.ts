import { findVaultDocument, readVaultOriginal, requireVaultWorkspace, VaultHttpError } from "@/lib/vault";
import { vaultErrorResponse } from "@/lib/vault-api";

export const runtime = "nodejs";

function contentDisposition(name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { office } = await requireVaultWorkspace();
    const document = await findVaultDocument(office.officeId, (await params).id);
    if (!document) throw new VaultHttpError(404, "Documento não encontrado.");
    const file = await readVaultOriginal(document);
    return new Response(new Uint8Array(file), { headers: { "content-type": document.mimeType, "content-length": String(file.length), "content-disposition": contentDisposition(document.name), "x-content-type-options": "nosniff" } });
  } catch (error) { return vaultErrorResponse(error); }
}
