import type { Metadata } from "next";
import { LumeDocument } from "@/components/lume-panel/document-bridge";
import { DocumentCase } from "@/components/document/document-case";
import { requireWorkspace } from "@/lib/session";
import { findVaultCase } from "@/lib/vault";
import { caseAccess } from "@/lib/collaboration/access";
import { CapabilityError } from "@/lib/capabilities/errors";
import { captureOperationalError } from "@/lib/observability/report";

export const metadata: Metadata = { title: "Documento" };

/** The case named in the address, when the person can open it; anything else just drops the trail. */
async function caseLink(userId: string, caseId: string) {
  try {
    const access = await caseAccess(userId, caseId);
    const record = await findVaultCase(access.officeId, caseId, userId);
    return record ? { id: record.id, name: record.name } : null;
  } catch (error) {
    if (!(error instanceof CapabilityError)) captureOperationalError(error, "document_page.case_link");
    return null;
  }
}

export default async function DocumentPage({ params, searchParams }: PageProps<"/app/documents/[id]">) {
  const [{ id }, query, { user }] = await Promise.all([params, searchParams, requireWorkspace()]);
  const caseId = typeof query.case === "string" ? query.case : null;
  return (
    <DocumentCase value={caseId ? await caseLink(user.id, caseId) : null}>
      <LumeDocument artifactId={id} />
    </DocumentCase>
  );
}
