import { notFound } from "next/navigation";
import { Reveal } from "@/components/reveal";
import { VaultCaseView } from "@/components/vault-case-view";
import { requireWorkspace } from "@/lib/session";
import { countVaultDocuments, findVaultCase, findVaultFolder, listVaultDocuments, listVaultFolders, vaultFolderPath } from "@/lib/vault";
import { caseAccess } from '@/lib/collaboration/access';
import { CapabilityError } from '@/lib/capabilities/errors';

async function accessForPage(userId: string, caseId: string) {
  try { return await caseAccess(userId, caseId); }
  catch (error) { if (error instanceof CapabilityError && error.code === 'NOT_FOUND') notFound(); throw error; }
}

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ folder?: string; section?: string }> };

// Pages redirect an expired session to sign-in; the 401 of requireVaultWorkspace is for the APIs.
export async function generateMetadata({ params }: Props) {
  const { user } = await requireWorkspace();
  const { id } = await params;
  const access = await accessForPage(user.id, id);
  return { title: (await findVaultCase(access.officeId, id))?.name ?? "Caso" };
}

export default async function VaultCasePage({ params, searchParams }: Props) {
  const { user, office: activeOffice } = await requireWorkspace();
  const [{ id }, { folder: requested, section }] = await Promise.all([params, searchParams]);
  const office = await accessForPage(user.id, id);
  const vaultCase = await findVaultCase(office.officeId, id);
  if (!vaultCase) notFound();

  // A folder from another case (or another office) is not a 404 for this page's data: it is simply
  // not part of this tree, so the view falls back to the case root.
  const folder = requested ? await findVaultFolder(office.officeId, requested) : undefined;
  const folderId = folder?.caseId === vaultCase.id ? folder.id : null;
  const [folders, path, initialDocuments, initialTotal] = await Promise.all([
    listVaultFolders(office.officeId, vaultCase.id, folderId),
    folderId ? vaultFolderPath(office.officeId, folderId) : Promise.resolve([]),
    listVaultDocuments(office.officeId, { caseId: vaultCase.id, folderId, limit: 50 }),
    countVaultDocuments(office.officeId, { caseId: vaultCase.id, folderId }),
  ]);

  return (
    <Reveal className="flex min-h-0 flex-1 flex-col">
      <VaultCaseView
        key={`${vaultCase.id}:${folderId ?? 'root'}`}
        vaultCase={vaultCase}
        folders={folders}
        path={path}
        initialDocuments={initialDocuments}
        initialTotal={initialTotal}
        folderId={folderId}
        role={office.role}
        external={office.external || office.officeId !== activeOffice.officeId}
        initialSection={!folderId && (section === 'references' || section === 'annexes') ? section : 'files'}
      />
    </Reveal>
  );
}
