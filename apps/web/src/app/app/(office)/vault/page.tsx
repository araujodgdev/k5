import { VaultBrowser } from "@/components/vault-browser";
import { CanvasMeta } from "@/components/shell/shell-context";
import { requireWorkspace } from "@/lib/session";
import { countVaultDocuments, listVaultCases, vaultCasePeopleByCase } from "@/lib/vault";
import { listCases } from '@/lib/application/vault-service';
import { workspaceContext } from '@/lib/application/context';

export const metadata = { title: "Casos" };

export default async function VaultPage() {
  const workspace = await requireWorkspace();
  const { office } = workspace;
  const [result, libraryCount, ownCases] = await Promise.all([
    listCases(workspaceContext(workspace)),
    countVaultDocuments(office.officeId, workspace.user.id, { scope: "library" }),
    listVaultCases(office.officeId, workspace.user.id),
  ]);
  const ownCaseIds = ownCases.map((item) => item.id);
  // Cases shared from another office keep their people to that office; their cards say they are shared instead.
  const people = await vaultCasePeopleByCase(office.officeId, ownCaseIds);
  return (
    <>
      <CanvasMeta title="Casos" subject={{ kind: "module", slug: "vault", title: "Casos" }} />
      <VaultBrowser initialCases={result.cases} ownCaseIds={ownCaseIds} libraryCount={libraryCount} people={people} />
    </>
  );
}
