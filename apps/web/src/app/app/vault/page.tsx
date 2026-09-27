import { Reveal } from "@/components/reveal";
import { VaultBrowser } from "@/components/vault-browser";
import { requireWorkspace } from "@/lib/session";
import { countVaultDocuments, listVaultCases } from "@/lib/vault";
import { listCases } from '@/lib/application/vault-service';
import { workspaceContext } from '@/lib/application/context';

export const metadata = { title: "Cofre" };

export default async function VaultPage() {
  const workspace = await requireWorkspace();
  const { office } = workspace;
  const [result, libraryCount, ownCases] = await Promise.all([
    listCases(workspaceContext(workspace)),
    countVaultDocuments(office.officeId, { scope: "library" }),
    listVaultCases(office.officeId),
  ]);
  return (
    <Reveal className="flex min-h-0 flex-1 flex-col">
      <VaultBrowser
        initialCases={result.cases}
        ownCaseIds={ownCases.map(item => item.id)}
        libraryCount={libraryCount}
        role={office.role}
      />
    </Reveal>
  );
}
