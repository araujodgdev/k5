import { officePage } from '@/components/lume/canvas-leaf';
import { Reveal } from "@/components/reveal";
import { VaultLibrary } from "@/components/vault-library";
import { requireWorkspace } from "@/lib/session";
import { countVaultDocuments, listVaultDocuments } from "@/lib/vault";

export const metadata = { title: "Biblioteca" };

async function VaultLibraryPage({ searchParams }: { searchParams: Promise<{ import?: string }> }) {
  const { office, user } = await requireWorkspace();
  const query = await searchParams;
  const [initialDocuments, initialTotal] = await Promise.all([
    listVaultDocuments(office.officeId, user.id, { scope: 'library', limit: 50 }),
    countVaultDocuments(office.officeId, user.id, { scope: 'library' }),
  ]);
  return (
    <Reveal className="flex min-h-0 flex-1 flex-col">
      <VaultLibrary initialDocuments={initialDocuments} initialTotal={initialTotal}
        initialDriveOpen={query.import === 'drive'} />
    </Reveal>
  );
}

export default officePage('/app/vault/library', VaultLibraryPage);
