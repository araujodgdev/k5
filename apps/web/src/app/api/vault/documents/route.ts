import { assertSameOrigin, createVaultDocument, listVaultDocuments, requireVaultWorkspace, requireVaultWriteRole, VaultHttpError } from "@/lib/vault";
import { vaultErrorResponse } from "@/lib/vault-api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { office } = await requireVaultWorkspace();
    const url = new URL(request.url);
    return Response.json({ documents: listVaultDocuments(office.officeId, { scope: url.searchParams.get("scope"), caseId: url.searchParams.get("caseId") }) });
  } catch (error) { return vaultErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { office, user } = await requireVaultWorkspace();
    requireVaultWriteRole(office.role);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new VaultHttpError(400, "Escolha um arquivo para enviar.");
    const document = await createVaultDocument(office.officeId, user.id, { file, scope: String(form.get("scope") ?? ""), caseId: typeof form.get("caseId") === "string" ? String(form.get("caseId")) : null });
    return Response.json({ document }, { status: 201 });
  } catch (error) { return vaultErrorResponse(error); }
}
