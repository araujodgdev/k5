import { Reveal } from "@/components/reveal";
import { VaultLibrary } from "@/components/vault-library";
import { listVaultDocuments, requireVaultWorkspace } from "@/lib/vault";

export const metadata = { title: "Biblioteca" };

export default async function VaultLibraryPage() {
  const { office } = await requireVaultWorkspace();
  return (
    <Reveal className="flex min-h-0 flex-1 flex-col">
      <VaultLibrary initialDocuments={listVaultDocuments(office.officeId, { scope: "library" })} role={office.role} />
    </Reveal>
  );
}
