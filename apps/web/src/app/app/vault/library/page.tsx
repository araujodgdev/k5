import { Reveal } from "@/components/reveal";
import { VaultLibrary } from "@/components/vault-library";
import { listVaultDocuments, requireVaultWorkspace } from "@/lib/vault";

export const metadata = { title: "Biblioteca" };

export default async function VaultLibraryPage({ searchParams }: { searchParams: Promise<{ import?: string }> }) {
  const { office } = await requireVaultWorkspace();
  const query = await searchParams;
  return (
    <Reveal className="flex min-h-0 flex-1 flex-col">
      <VaultLibrary initialDocuments={await listVaultDocuments(office.officeId, { scope: "library" })} role={office.role}
        initialDriveOpen={query.import === 'drive'} />
    </Reveal>
  );
}
