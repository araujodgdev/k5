import { Reveal } from "@/components/reveal";
import { VaultBrowser } from "@/components/vault-browser";
import { listVaultCases, listVaultDocuments, requireVaultWorkspace } from "@/lib/vault";

export default async function VaultPage() {
  const { office } = await requireVaultWorkspace();
  return <Reveal className="flex min-h-0 flex-1 flex-col"><VaultBrowser initialDocuments={listVaultDocuments(office.officeId)} initialCases={listVaultCases(office.officeId)} role={office.role} /></Reveal>;
}
