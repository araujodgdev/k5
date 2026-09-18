import { assertSameOrigin, createVaultCase, listVaultCases, requireVaultWorkspace, requireVaultWriteRole } from "@/lib/vault";
import { vaultErrorResponse } from "@/lib/vault-api";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { office } = await requireVaultWorkspace();
    return Response.json({ cases: listVaultCases(office.officeId) });
  } catch (error) { return vaultErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { office, user } = await requireVaultWorkspace();
    requireVaultWriteRole(office.role);
    const body = await request.json() as { name?: unknown };
    if (typeof body.name !== "string") return Response.json({ error: "Informe o nome do caso." }, { status: 400 });
    return Response.json({ case: createVaultCase(office.officeId, user.id, body.name) }, { status: 201 });
  } catch (error) { return vaultErrorResponse(error); }
}
