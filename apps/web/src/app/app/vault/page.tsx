import { Reveal } from "@/components/reveal";
import { VaultBrowser } from "@/components/vault-browser";
import { requireWorkspace } from "@/lib/session";
import { countVaultDocuments, listVaultCases } from "@/lib/vault";

export const metadata = { title: "Cofre" };

export default async function VaultPage() {
  const { office } = await requireWorkspace();
  const [initialCases, libraryCount] = await Promise.all([
    listVaultCases(office.officeId),
    countVaultDocuments(office.officeId, { scope: "library" }),
  ]);
  return (
    <Reveal className="flex min-h-0 flex-1 flex-col">
      <VaultBrowser
        initialCases={initialCases}
        libraryCount={libraryCount}
        role={office.role}
      />
    </Reveal>
  );
}
