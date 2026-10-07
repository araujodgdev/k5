import { Reveal } from "@/components/reveal";
import { VaultBrowser } from "@/components/vault-browser";
import { requireWorkspace } from "@/lib/session";
import { countVaultDocuments, listVaultCases } from "@/lib/vault";
import { listCases } from '@/lib/application/vault-service';
import { workspaceContext } from '@/lib/application/context';
import { redirect } from 'next/navigation';

export const metadata = { title: "Cofre" };

export default async function VaultPage({ searchParams }: { searchParams: Promise<{ documentId?: string }> }) {
  const workspace = await requireWorkspace();
  const { documentId } = await searchParams;
  if (documentId) redirect(`/app/vault/files/${encodeURIComponent(documentId)}`);
  const { office } = workspace;
  const [result, libraryCount, ownCases] = await Promise.all([
    listCases(workspaceContext(workspace)),
    countVaultDocuments(office.officeId, workspace.user.id, { scope: "library" }),
    listVaultCases(office.officeId, workspace.user.id),
  ]);
  return (
    <Reveal className="flex min-h-0 flex-1 flex-col">
      <VaultBrowser
        initialCases={result.cases}
        ownCaseIds={ownCases.map(item => item.id)}
        libraryCount={libraryCount}
      />
    </Reveal>
  );
}
