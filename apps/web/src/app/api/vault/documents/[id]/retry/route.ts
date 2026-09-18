import { assertSameOrigin, requireVaultWorkspace, requireVaultWriteRole, retryVaultDocument } from "@/lib/vault";
import { vaultErrorResponse } from "@/lib/vault-api";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { office } = await requireVaultWorkspace();
    requireVaultWriteRole(office.role);
    retryVaultDocument(office.officeId, (await params).id);
    return Response.json({ ok: true });
  } catch (error) { return vaultErrorResponse(error); }
}
