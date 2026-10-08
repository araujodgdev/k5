import { officePage } from '@/components/lume/canvas-leaf';
import { notFound, redirect } from "next/navigation";
import { CanvasResource } from '@/components/lume/workspace-context';
import { canonicalCanvasHref } from '@/lib/lume-workspace';
import { Reveal } from "@/components/reveal";
import { VaultCaseView, type CaseSection } from "@/components/vault-case-view";
import { requireWorkspace } from "@/lib/session";
import { countVaultDocuments, findVaultCase, findVaultFolder, listVaultDocuments, listVaultFolders, vaultFolderPath } from "@/lib/vault";
import { caseAccess } from '@/lib/collaboration/access';
import { CapabilityError } from '@/lib/capabilities/errors';

async function accessForPage(userId: string, caseId: string) {
  try { return await caseAccess(userId, caseId); }
  catch (error) { if (error instanceof CapabilityError && error.code === 'NOT_FOUND') notFound(); throw error; }
}

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ folder?: string; section?: string; task?: string }> };

// Pages redirect an expired session to sign-in; the 401 of requireVaultWorkspace is for the APIs.
export async function generateMetadata({ params }: Props) {
  const { user } = await requireWorkspace();
  const { id } = await params;
  const access = await accessForPage(user.id, id);
  return { title: (await findVaultCase(access.officeId, id, user.id))?.name ?? "Caso" };
}

async function VaultCasePage({ params, searchParams }: Props) {
  const { user } = await requireWorkspace();
  const [{ id }, { folder: requested, section, task }] = await Promise.all([params, searchParams]);
  const office = await accessForPage(user.id, id);
  const vaultCase = await findVaultCase(office.officeId, id, user.id);
  if (!vaultCase) notFound();

  // A folder from another case (or another office), or one hidden from this person, is not a 404
  // for this page's data: it is simply not part of the tree they see, so the view falls back to the case root.
  const folder = requested ? await findVaultFolder(office.officeId, requested, user.id) : undefined;
  const folderId = folder?.caseId === vaultCase.id ? folder.id : null;
  const query = new URLSearchParams();
  if (folderId) query.set('folder', folderId);
  if (section) query.set('section', section);
  if (task) query.set('task', task);
  const href = canonicalCanvasHref(`/app/vault/cases/${encodeURIComponent(id)}${query.size ? `?${query}` : ''}`)!;
  if (requested && !folderId) redirect(href);
  const [folders, path, initialDocuments, initialTotal] = await Promise.all([
    listVaultFolders(office.officeId, user.id, vaultCase.id, folderId),
    folderId ? vaultFolderPath(office.officeId, folderId, user.id) : Promise.resolve([]),
    listVaultDocuments(office.officeId, user.id, { caseId: vaultCase.id, folderId, limit: 50 }),
    countVaultDocuments(office.officeId, user.id, { caseId: vaultCase.id, folderId }),
  ]);

  return (
    <Reveal className="flex min-h-0 flex-1 flex-col">
      <CanvasResource resource={{ kind: 'case', caseId: id, folderId, href, title: folder ? `${vaultCase.name} · ${folder.name}` : vaultCase.name }} />
      <VaultCaseView
        key={`${vaultCase.id}:${folderId ?? 'root'}`}
        vaultCase={vaultCase}
        folders={folders}
        path={path}
        initialDocuments={initialDocuments}
        initialTotal={initialTotal}
        folderId={folderId}
        external={!office.owner}
        initialTask={task}
        initialSection={(folderId ? ['all','pages','files'] : ['all','pages','files','artifacts','tasks','honorarios','activity','participants','references','annexes',...(office.owner ? ['processes'] : [])]).includes(section ?? '') ? section as CaseSection : 'all'}
      />
    </Reveal>
  );
}

export default officePage('/app/vault/cases/[id]', VaultCasePage);
