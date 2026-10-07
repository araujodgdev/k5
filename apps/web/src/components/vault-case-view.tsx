"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ChevronRight, CircleAlert, FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { CanvasPage } from "@/components/canvas/canvas-page";
import { DocumentItems, DocumentPagination, UploadControl, usePolledDocuments } from "@/components/vault-files";
import { CaseDelete } from "@/components/vault-case-delete";
import { JudicialCaseLinks } from "@/components/judicial-case-links";
import { ResearchCaseReferences } from "@/components/research-case-references";
import { VaultAnnexes } from "@/components/vault-annexes";
import { DrivePanel } from "@/components/google/drive-panel";
import { FolderAccessDialog, type FolderAccessValue } from "@/components/vault-folder-access";
import { CaseHeader, type CaseProcess } from "@/components/casos/case-header";
import { CaseSections, type CaseSection } from "@/components/casos/case-sections";
import { CaseStrip } from "@/components/casos/case-strip";
import { CaseFormDialog } from "@/components/casos/case-form-dialog";
import { FolderDialog } from "@/components/casos/folder-dialog";
import { ShareDialog } from "@/components/casos/share-dialog";
import { CaseFees, CaseTasks } from "@/components/casos/case-rows";
import { FolderItem, PageItem, type CasePage } from "@/components/casos/case-items";
import { ItemGrid } from "@/components/casos/item-card";
import type { CasePerson } from "@/components/casos/people-stack";
import type { VaultCase, VaultDocument, VaultFolder } from "@/lib/vault";

type Dialog = "share" | "edit" | "folder" | "delete" | null;

/**
 * A case as a space (`v.caso`): its header, the Lume's strip while it works here, the sections
 * and, in Tudo, Páginas and Arquivos, the case's items as cards. A folder opens in place with a
 * trail back to the case.
 */
export function VaultCaseView({ vaultCase, folders, path, initialDocuments, initialTotal, folderId, external = false, people, pages, client, process, initialSection = "all" }: {
  vaultCase: VaultCase;
  folders: VaultFolder[];
  path: VaultFolder[];
  initialDocuments: VaultDocument[];
  initialTotal: number;
  folderId: string | null;
  external?: boolean;
  people: CasePerson[];
  /** The viewer's own pages about the case; nobody else sees them. */
  pages: CasePage[];
  client: { id: string; name: string; area: string | null } | null;
  process: CaseProcess | null;
  initialSection?: CaseSection;
}) {
  const router = useRouter();
  const query = `caseId=${encodeURIComponent(vaultCase.id)}&folderId=${folderId ? encodeURIComponent(folderId) : "root"}`;
  const { documents, setDocuments, refresh, firstPage, pagination } = usePolledDocuments(query, initialDocuments, initialTotal);
  const [section, setSection] = useState<CaseSection>(initialSection);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [failure, setFailure] = useState("");
  const [driveOpen, setDriveOpen] = useState(false);
  const [accessFolder, setAccessFolder] = useState<VaultFolder | null>(null);
  const [accessChanges, setAccessChanges] = useState<Record<string, FolderAccessValue>>({});
  const [addedFolders, setAddedFolders] = useState<VaultFolder[]>([]);
  const moreActions = useRef<HTMLElement | null>(null);
  // Only this level's new folders, and only until the refreshed list from the server brings them.
  const shownFolders = [...folders, ...addedFolders.filter((added) => added.parentId === folderId && !folders.some((folder) => folder.id === added.id))]
    .map((folder) => ({ ...folder, ...accessChanges[folder.id] }));

  const base = `/app/vault/cases/${vaultCase.id}`;
  const folderHref = (target: string | null) => (target ? `${base}?folder=${encodeURIComponent(target)}` : base);
  const pageHref = (page: CasePage) => `/app/documents/${encodeURIComponent(page.id)}?case=${encodeURIComponent(vaultCase.id)}`;
  const atRoot = !folderId;
  const shownPages = atRoot ? pages : [];
  const filesTotal = shownFolders.length + pagination.total;

  const sections: { id: CaseSection; count?: number }[] = atRoot ? [
    { id: "all", count: shownPages.length + filesTotal },
    { id: "pages", count: shownPages.length },
    { id: "files", count: filesTotal },
    ...(external ? [] : [{ id: "tasks" as const }, { id: "fees" as const }, { id: "processes" as const }]),
    { id: "references" }, { id: "annexes" },
  ] : [];
  const current: CaseSection = atRoot ? section : "files";
  const showsFiles = current === "all" || current === "files";

  async function removeFolder(id: string) {
    setFailure("");
    try {
      const response = await fetch(`/api/vault/folders/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        setFailure(result?.error ?? "Não foi possível remover a pasta.");
        return;
      }
      setAddedFolders((list) => list.filter((folder) => folder.id !== id));
      router.refresh();
    } catch { setFailure("Não foi possível conectar. Confira sua conexão."); }
  }

  const menu = (
    <>
      <DropdownMenuItem onSelect={() => setDialog("edit")}>Editar caso</DropdownMenuItem>
      <DropdownMenuItem asChild><Link href={`/app/agents?caseId=${encodeURIComponent(vaultCase.id)}`}>Conversar sobre o caso</Link></DropdownMenuItem>
      {!external && <DropdownMenuItem asChild><Link href={`/app/agenda?caseId=${encodeURIComponent(vaultCase.id)}`}>Tarefas e Agenda</Link></DropdownMenuItem>}
      {!external && <DropdownMenuItem onSelect={() => { setSection(atRoot && !showsFiles ? "files" : section); setDriveOpen((open) => !open); }}>
        {driveOpen ? "Fechar Google Drive" : "Importar do Google Drive"}
      </DropdownMenuItem>}
      {!external && <DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>Excluir caso</DropdownMenuItem>}
    </>
  );

  const fileTools = showsFiles && (
    <>
      <Button type="button" variant="ghost" className="text-muted-foreground max-md:h-11" onClick={() => { setFailure(""); setDialog("folder"); }}>
        <FolderPlus aria-hidden="true" className="size-3.5" />Nova pasta
      </Button>
      <UploadControl scope="case" caseId={vaultCase.id} folderId={folderId} onError={setFailure} onUploaded={() => void firstPage()} />
    </>
  );

  return (
    <CanvasPage width="wide" className="md:gap-5">
      <CaseHeader title={vaultCase.name} client={client?.name ?? vaultCase.client.name} note={external ? "compartilhado com você" : client?.area ?? undefined}
        process={process} people={people} onShare={() => setDialog("share")} menu={menu} menuOpenerRef={moreActions}
        onMenuClose={(event) => { if (dialog) event.preventDefault(); }} />
      <CaseStrip caseId={vaultCase.id} />

      {atRoot ? (
        <CaseSections sections={sections} current={current} onChange={(next) => { setSection(next); if (next !== "all" && next !== "files") setDriveOpen(false); }} actions={fileTools || undefined} />
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-3 border-b border-border pb-2 md:flex-nowrap">
          <nav aria-label="Trilha" className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-[13.5px] text-muted-foreground">
            <Link href={base} className="max-w-56 truncate rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">{vaultCase.name}</Link>
            {path.map((folder, index) => (
              <span key={folder.id} className="flex min-w-0 items-center gap-1">
                <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" />
                <Link href={folderHref(folder.id)} aria-current={index === path.length - 1 ? "page" : undefined}
                  className="max-w-48 truncate rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:font-medium aria-[current=page]:text-foreground">{folder.name}</Link>
              </span>
            ))}
          </nav>
          <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:gap-1">{fileTools}</div>
        </div>
      )}

      {failure && <p role="alert" className="flex items-start gap-2 text-[13px] text-destructive"><CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{failure}</p>}
      {showsFiles && driveOpen && !external && <DrivePanel initialCaseId={vaultCase.id} initialFolderId={folderId} onImported={firstPage} />}

      {current === "pages" && (
        <p className="-mt-1 text-[13px] text-muted-foreground">
          {shownPages.length ? "Páginas que você escreveu com o Lume nas conversas sobre este caso. Só você as vê." : "Nenhuma página ainda. O que você escrever com o Lume sobre este caso aparece aqui, só para você."}
        </p>
      )}

      {(showsFiles || current === "pages") && (
        <ItemGrid label={current === "pages" ? "Páginas do caso" : "Itens do caso"}>
          {(current === "all" || current === "pages") && shownPages.map((page) => <PageItem key={page.id} page={page} href={pageHref(page)} />)}
          {showsFiles && shownFolders.map((folder) => (
            <FolderItem key={folder.id} folder={folder} href={folderHref(folder.id)} canRemove={folder.owned || !external}
              onAccess={() => setAccessFolder(folder)} onRemove={() => void removeFolder(folder.id)} />
          ))}
          {showsFiles && (
            <DocumentItems documents={documents} onError={setFailure} onDeleted={() => void refresh()}
              onRetried={(documentId) => setDocuments((list) => list.map((item) => item.id === documentId ? { ...item, status: "queued", progress: 0, errorMessage: null } : item))} />
          )}
        </ItemGrid>
      )}
      {showsFiles && !pagination.loading && !pagination.error && pagination.total === 0 && shownFolders.length === 0 && (current === "files" || shownPages.length === 0) && (
        <p className="text-[13.5px] text-muted-foreground">{folderId ? "Esta pasta está vazia." : current === "all"
          ? "Nada neste caso ainda. Envie os primeiros arquivos ou peça ao Lume para começar uma página." : "Nenhum arquivo neste caso ainda."}</p>
      )}
      {showsFiles && <DocumentPagination {...pagination} />}

      {current === "tasks" && <CaseTasks caseId={vaultCase.id} />}
      {current === "fees" && <CaseFees caseId={vaultCase.id} />}
      {current === "processes" && <JudicialCaseLinks caseId={vaultCase.id} />}
      {current === "references" && <ResearchCaseReferences caseId={vaultCase.id} external={external} />}
      {current === "annexes" && <VaultAnnexes caseId={vaultCase.id} />}

      <ShareDialog caseId={vaultCase.id} caseName={vaultCase.name} client={client} open={dialog === "share"} onOpenChange={(open) => setDialog(open ? "share" : null)} />
      <CaseFormDialog record={vaultCase} open={dialog === "edit"} onOpenChange={(open) => setDialog(open ? "edit" : null)} onSaved={() => router.refresh()} />
      <FolderDialog caseId={vaultCase.id} parentId={folderId} open={dialog === "folder"} onOpenChange={(open) => setDialog(open ? "folder" : null)}
        onCreated={(folder) => { setAddedFolders((list) => [...list, folder]); router.refresh(); }} />
      {!external && (
        <CaseDelete caseId={vaultCase.id} name={vaultCase.name} documentCount={vaultCase.documentCount} open={dialog === "delete"} returnFocusTo={moreActions}
          onOpenChange={(open) => setDialog(open ? "delete" : null)} onError={setFailure} onDeleted={() => { router.push("/app/vault"); router.refresh(); }} />
      )}
      {accessFolder && (
        <FolderAccessDialog key={accessFolder.id} caseId={vaultCase.id} folder={accessFolder} open onOpenChange={(open) => { if (!open) setAccessFolder(null); }}
          onSaved={(folder) => { setAccessChanges((changes) => ({ ...changes, [folder.id]: { visibility: folder.visibility, memberIds: folder.memberIds } })); router.refresh(); }} />
      )}
    </CanvasPage>
  );
}
