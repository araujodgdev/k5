import { notFound } from "next/navigation";
import { VaultCaseView } from "@/components/vault-case-view";
import { CanvasMeta } from "@/components/shell/shell-context";
import { requireWorkspace } from "@/lib/session";
import { database } from "@/lib/database";
import { caseArtifacts } from "@/lib/ai-store";
import { countVaultDocuments, findVaultCase, findVaultFolder, listVaultDocuments, listVaultFolders, vaultCasePeopleByCase, vaultFolderPath } from "@/lib/vault";
import { caseAccess } from '@/lib/collaboration/access';
import { CapabilityError } from '@/lib/capabilities/errors';
import { legalAreaLabels } from '@/lib/capabilities/agenda';
import { workspaceContext, type WorkspaceContext } from '@/lib/application/context';
import { listClients } from '@/lib/application/agenda-service';
import { listJudicialLinks } from '@/lib/application/judicial-service';
import { formatCnjNumber } from '@/lib/judicial/normalization/cnj';
import { captureOperationalError } from '@/lib/observability/report';

async function accessForPage(userId: string, caseId: string) {
  try { return await caseAccess(userId, caseId); }
  catch (error) { if (error instanceof CapabilityError && error.code === 'NOT_FOUND') notFound(); throw error; }
}

/** The office client tied to the case, whose name and area head it and whose portal "Compartilhar" reports on. */
async function caseClient(context: WorkspaceContext, caseId: string) {
  try {
    const { clients } = await listClients(context, { caseId, limit: 1, offset: 0 });
    const client = clients[0];
    return client ? { id: client.id, name: client.name, area: client.legalAreas[0] ? legalAreaLabels[client.legalAreas[0]] : null } : null;
  } catch (error) {
    if (!(error instanceof CapabilityError)) captureOperationalError(error, 'case_page.client');
    return null;
  }
}

/** The first active process linked to the case, for the line under the client. */
async function caseProcess(context: WorkspaceContext, caseId: string) {
  try {
    const { links } = await listJudicialLinks(context, { caseId, activeOnly: true, limit: 1 });
    const link = links[0];
    const number = link?.cnjNumber ? formatCnjNumber(link.cnjNumber) : link?.nativeNumber;
    return link && number ? { number, court: link.courtName } : null;
  } catch (error) {
    if (!(error instanceof CapabilityError)) captureOperationalError(error, 'case_page.process');
    return null;
  }
}

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ folder?: string; section?: string }> };

// Pages redirect an expired session to sign-in; the 401 of requireVaultWorkspace is for the APIs.
export async function generateMetadata({ params }: Props) {
  const { user } = await requireWorkspace();
  const { id } = await params;
  const access = await accessForPage(user.id, id);
  return { title: (await findVaultCase(access.officeId, id, user.id))?.name ?? "Caso" };
}

export default async function VaultCasePage({ params, searchParams }: Props) {
  const workspace = await requireWorkspace();
  const { user } = workspace;
  const [{ id }, { folder: requested, section }] = await Promise.all([params, searchParams]);
  const office = await accessForPage(user.id, id);
  const vaultCase = await findVaultCase(office.officeId, id, user.id);
  if (!vaultCase) notFound();

  // A folder from another case (or another office), or one hidden from this person, is not a 404
  // for this page's data: it is simply not part of the tree they see, so the view falls back to the case root.
  const folder = requested ? await findVaultFolder(office.officeId, requested, user.id) : undefined;
  const folderId = folder?.caseId === vaultCase.id ? folder.id : null;
  const context = workspaceContext(workspace);
  const [folders, path, initialDocuments, initialTotal, people, pages, client, process] = await Promise.all([
    listVaultFolders(office.officeId, user.id, vaultCase.id, folderId),
    folderId ? vaultFolderPath(office.officeId, folderId, user.id) : Promise.resolve([]),
    listVaultDocuments(office.officeId, user.id, { caseId: vaultCase.id, folderId, limit: 50 }),
    countVaultDocuments(office.officeId, user.id, { caseId: vaultCase.id, folderId }),
    vaultCasePeopleByCase(office.officeId, [vaultCase.id]),
    // The viewer's own pages: they come from the viewer's conversations, in the viewer's office.
    caseArtifacts(database, { officeId: workspace.office.officeId, userId: user.id }, vaultCase.id),
    office.owner ? caseClient(context, vaultCase.id) : Promise.resolve(null),
    office.owner ? caseProcess(context, vaultCase.id) : Promise.resolve(null),
  ]);

  return (
    <>
      <CanvasMeta title={vaultCase.name} subject={{ kind: "case", caseId: vaultCase.id, title: vaultCase.name }} />
      <VaultCaseView
        key={`${vaultCase.id}:${folderId ?? 'root'}`}
        vaultCase={vaultCase}
        folders={folders}
        path={path}
        initialDocuments={initialDocuments}
        initialTotal={initialTotal}
        folderId={folderId}
        external={!office.owner}
        people={people[vaultCase.id] ?? []}
        pages={pages}
        client={client}
        process={process}
        initialSection={!folderId && (section === 'references' || section === 'annexes') ? section : 'all'}
      />
    </>
  );
}
