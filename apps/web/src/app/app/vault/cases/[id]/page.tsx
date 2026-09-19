import { notFound } from "next/navigation";
import { Reveal } from "@/components/reveal";
import { VaultCaseView } from "@/components/vault-case-view";
import { findVaultCase, findVaultFolder, listVaultDocuments, listVaultFolders, requireVaultWorkspace, vaultFolderPath } from "@/lib/vault";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ folder?: string }> };

export async function generateMetadata({ params }: Props) {
  const { office } = await requireVaultWorkspace();
  const { id } = await params;
  return { title: findVaultCase(office.officeId, id)?.name ?? "Caso" };
}

export default async function VaultCasePage({ params, searchParams }: Props) {
  const { office } = await requireVaultWorkspace();
  const { id } = await params;
  const vaultCase = findVaultCase(office.officeId, id);
  if (!vaultCase) notFound();

  // A folder from another case (or another office) is not a 404 for this page's data: it is simply
  // not part of this tree, so the view falls back to the case root.
  const requested = (await searchParams).folder;
  const folder = requested ? findVaultFolder(office.officeId, requested) : undefined;
  const folderId = folder && folder.caseId === vaultCase.id ? folder.id : null;

  return (
    <Reveal className="flex min-h-0 flex-1 flex-col">
      <VaultCaseView
        vaultCase={vaultCase}
        folders={listVaultFolders(office.officeId, vaultCase.id, folderId)}
        path={folderId ? vaultFolderPath(office.officeId, folderId) : []}
        initialDocuments={listVaultDocuments(office.officeId, { caseId: vaultCase.id, folderId })}
        folderId={folderId}
        role={office.role}
      />
    </Reveal>
  );
}
