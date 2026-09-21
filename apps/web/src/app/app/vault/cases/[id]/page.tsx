import { notFound } from "next/navigation";
import { Reveal } from "@/components/reveal";
import { VaultCaseView } from "@/components/vault-case-view";
import { findVaultCase, findVaultFolder, listVaultDocuments, listVaultFolders, requireVaultWorkspace, vaultFolderPath } from "@/lib/vault";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ folder?: string }> };

export async function generateMetadata({ params }: Props) {
  const { office } = await requireVaultWorkspace();
  const { id } = await params;
  return { title: (await findVaultCase(office.officeId, id))?.name ?? "Caso" };
}

export default async function VaultCasePage({ params, searchParams }: Props) {
  const { office } = await requireVaultWorkspace();
  const [{ id }, { folder: requested }] = await Promise.all([params, searchParams]);
  const vaultCase = await findVaultCase(office.officeId, id);
  if (!vaultCase) notFound();

  // A folder from another case (or another office) is not a 404 for this page's data: it is simply
  // not part of this tree, so the view falls back to the case root.
  const folder = requested ? await findVaultFolder(office.officeId, requested) : undefined;
  const folderId = folder?.caseId === vaultCase.id ? folder.id : null;
  const [folders, path, initialDocuments] = await Promise.all([
    listVaultFolders(office.officeId, vaultCase.id, folderId),
    folderId ? vaultFolderPath(office.officeId, folderId) : Promise.resolve([]),
    listVaultDocuments(office.officeId, { caseId: vaultCase.id, folderId }),
  ]);

  return (
    <Reveal className="flex min-h-0 flex-1 flex-col">
      <VaultCaseView
        vaultCase={vaultCase}
        folders={folders}
        path={path}
        initialDocuments={initialDocuments}
        folderId={folderId}
        role={office.role}
      />
    </Reveal>
  );
}
