import { Reveal } from "@/components/reveal";
import { VaultLibrary } from "@/components/vault-library";
import { requireWorkspace } from "@/lib/session";
import { listVaultDocuments } from "@/lib/vault";

export const metadata = { title: "Biblioteca" };

export default async function VaultLibraryPage({ searchParams }: { searchParams: Promise<{ import?: string }> }) {
  const { office } = await requireWorkspace();
  const query = await searchParams;
  return (
    <Reveal className="flex min-h-0 flex-1 flex-col">
      <VaultLibrary initialDocuments={await listVaultDocuments(office.officeId, { scope: "library" })} role={office.role}
        initialDriveOpen={query.import === 'drive'} />
    </Reveal>
  );
}
