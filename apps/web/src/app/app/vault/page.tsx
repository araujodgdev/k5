import { Reveal } from "@/components/reveal";
import { VaultBrowser } from "@/components/vault-browser";
import { countVaultDocuments, listVaultCases, requireVaultWorkspace } from "@/lib/vault";

export const metadata = { title: "Cofre" };

export default async function VaultPage() {
  const { office } = await requireVaultWorkspace();
  return (
    <Reveal className="flex min-h-0 flex-1 flex-col">
      <VaultBrowser
        initialCases={listVaultCases(office.officeId)}
        libraryCount={countVaultDocuments(office.officeId, { scope: "library" })}
        role={office.role}
      />
    </Reveal>
  );
}
