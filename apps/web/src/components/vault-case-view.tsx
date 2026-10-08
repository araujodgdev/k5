"use client";

import Link from "next/link";
import { CasePages } from "./case-pages";
import { CaseArtifacts } from './case-artifacts';
import { CaseSharing } from './case-sharing';
import { useLumeWorkspace } from './lume/workspace-context';
import { sectionTab } from './section-tabs';
import { CaseTasks, CaseHonorarios, CaseRecentActivity, CaseLumePolicy } from './case-collaboration';
import { useRouter } from "@/components/lume/canvas-navigation";
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { CalendarDays, ChevronDown, ChevronRight, CircleAlert, Ellipsis, FolderClosed, FolderLock, FolderPlus, Import, LayoutGrid, List, LoaderCircle, MessageSquare, Pencil, Trash2, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DocumentPagination, DocumentRows, UploadControl, usePolledDocuments } from "@/components/vault-files";
import { CaseDelete } from "@/components/vault-case-delete";
import { JudicialCaseLinks } from "@/components/judicial-case-links";
import { ResearchCaseReferences } from "@/components/research-case-references";
import { VaultAnnexes } from "@/components/vault-annexes";
import { DrivePanel } from "@/components/google/drive-panel";
import { CollaborationPanel } from './collaboration-panel';
import { FolderAccessDialog, FolderAccessFields, visibilityNote, type FolderAccessValue } from './vault-folder-access';
import type { VaultCase, VaultDocument, VaultFolder } from "@/lib/vault";

type View = "cards" | "list";
export type CaseSection = 'all' | 'pages' | 'files' | 'artifacts' | 'processes' | 'references' | 'annexes' | 'participants' | 'tasks' | 'honorarios' | 'activity';
type Section = CaseSection;

// View modes keep their joined borders and ink selection.
const segment = "-mt-px -ml-px focus-visible:z-10 aria-pressed:bg-foreground aria-pressed:text-background";
const sectionLabels: [Section, string][] = [['all', 'Tudo'], ['pages', 'Páginas'], ['files', 'Arquivos'], ['artifacts', 'Artefatos'], ['tasks', 'Tarefas'], ['honorarios', 'Honorários'], ['activity', 'Atividade']];

function countLabel(count: number) {
  return count === 1 ? "1 arquivo" : `${count} arquivos`;
}

function CaseSections({ section, external, inFolder, onChange }: { section: Section; external: boolean; inFolder: boolean; onChange: (section: Section) => void }) {
  return <div className="grid w-full grid-cols-3 border-b md:flex md:flex-wrap md:gap-5" role="group" aria-label="Seção do caso">
    {sectionLabels.filter(([value]) => !inFolder || ['all', 'pages', 'files'].includes(value)).map(([value, label]) => <button key={value} type="button" className={sectionTab(section === value)} aria-pressed={section === value} onClick={() => onChange(value)}>{label}</button>)}
    {!inFolder && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="min-h-11" aria-label="Mais seções do caso">Mais<ChevronDown aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent>{([['processes', 'Processos'], ['references', 'Referências'], ['annexes', 'Anexos'], ['participants', 'Participantes']] as [Section, string][]).filter(([value]) => !external || value !== 'processes').map(([value, label]) => <DropdownMenuItem key={value} onSelect={() => onChange(value)}>{label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>}
  </div>;
}

function ViewToggle({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  return <div className="flex pt-px pl-px" role="group" aria-label="Modo de exibição">
    <Button type="button" variant="outline" size="icon-sm" className={`size-11 md:size-8 ${segment}`} aria-pressed={view === "cards"} onClick={() => onChange("cards")} aria-label="Ver em cartões"><LayoutGrid aria-hidden="true" /></Button>
    <Button type="button" variant="outline" size="icon-sm" className={`size-11 md:size-8 ${segment}`} aria-pressed={view === "list"} onClick={() => onChange("list")} aria-label="Ver em lista"><List aria-hidden="true" /></Button>
  </div>;
}

export function VaultCaseView({ vaultCase, folders, path, initialDocuments, initialTotal, folderId, external = false, initialSection = 'all', initialTask }: {
  vaultCase: VaultCase;
  folders: VaultFolder[];
  path: VaultFolder[];
  initialDocuments: VaultDocument[];
  initialTotal: number;
  folderId: string | null;
  external?: boolean;
  initialSection?: CaseSection;
  initialTask?: string;
}) {
  const router = useRouter();
  const { controller } = useLumeWorkspace();
  const query = `caseId=${encodeURIComponent(vaultCase.id)}&folderId=${folderId ? encodeURIComponent(folderId) : "root"}`;
  const { documents, setDocuments, refresh, firstPage, pagination } = usePolledDocuments(query, initialDocuments, initialTotal);
  const [view, setView] = useState<View>("cards");
  const [section, setSection] = useState<Section>(initialSection);
  const [sectionSource, setSectionSource] = useState({ section: initialSection, task: initialTask });
  if (sectionSource.section !== initialSection || sectionSource.task !== initialTask) {
    setSectionSource({ section: initialSection, task: initialTask });
    setSection(initialSection);
  }
  const [failure, setFailure] = useState("");
  const [folderName, setFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [savingFolder, setSavingFolder] = useState(false);
  const [folderAccess, setFolderAccess] = useState<FolderAccessValue>({ visibility: "public", memberIds: [] });
  const [accessFolder, setAccessFolder] = useState<VaultFolder | null>(null);
  const [accessChanges, setAccessChanges] = useState<Record<string, FolderAccessValue>>({});
  const [addedFolders, setAddedFolders] = useState<VaultFolder[]>([]);
  const [folderSeed, setFolderSeed] = useState(folders);
  const folderGeneration = useRef(0);
  useLayoutEffect(() => { ++folderGeneration.current; }, [folders]);
  if (folderSeed !== folders) { setFolderSeed(folders); setAddedFolders([]); setAccessChanges({}); setAccessFolder(null); }
  // Only this level's new folders, and only until the refreshed list from the server brings them.
  const shownFolders = [...folders, ...addedFolders.filter((added) => added.parentId === folderId && !folders.some((folder) => folder.id === added.id))]
    .map((folder) => ({ ...folder, ...accessChanges[folder.id] }));
  const [editing, setEditing] = useState(false);
  const [driveOpen, setDriveOpen] = useState(false);
  const [sharing, setSharing] = useState(false);

  const [deleting, setDeleting] = useState(false);
  const moreActions = useRef<HTMLButtonElement>(null);

  const base = `/app/vault/cases/${vaultCase.id}`;
  const href = (target: string | null) => (target ? `${base}?folder=${encodeURIComponent(target)}` : base);
  const agendaHref = `/app/agenda?caseId=${encodeURIComponent(vaultCase.id)}`;
  const driveLabel = driveOpen ? "Fechar Google Drive" : "Importar do Google Drive";
  const deleteProps = { caseId: vaultCase.id, name: vaultCase.name, documentCount: vaultCase.documentCount, onError: setFailure, onDeleted: () => { router.push("/app/vault"); router.refresh(); } };

  // Leaving Arquivos closes what belongs to it, so no button stays marked open over a hidden panel.
  function changeSection(next: Section) {
    setSection(next);
    if (next !== "files") { setCreatingFolder(false); setDriveOpen(false); }
  }

  function askLume() {
    const resource = controller.getSnapshot().resource;
    if (resource?.kind !== 'case' || resource.caseId !== vaultCase.id) { setFailure('Aguarde o contexto do caso carregar.'); return; }
    controller.dispatch({ type: 'mode', mode: 'floating' });
    controller.dispatch({ type: 'mobile', mobile: 'chat' });
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Pergunte ao Lume"]')?.focus());
  }

  // On a phone these two stay in the header whatever section is open, so they bring the files back.
  function toggleFolderForm() {
    setFailure("");
    if (section !== "files") { setSection("files"); setCreatingFolder(true); } else setCreatingFolder((value) => !value);
  }
  function toggleDrive() {
    if (section !== "files") { setSection("files"); setDriveOpen(true); } else setDriveOpen((open) => !open);
  }

  // The new folder joins the list as soon as the server answers; the page refresh that follows only
  // brings the rest up to date, so the person never waits on it to see the result.
  async function submitFolder(event: FormEvent) {
    event.preventDefault();
    const name = folderName.trim();
    if (!name || savingFolder) return;
    const generation = folderGeneration.current;
    setFailure("");
    setSavingFolder(true);
    try {
      const response = await fetch("/api/vault/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caseId: vaultCase.id, name, parentId: folderId, visibility: folderAccess.visibility,
          memberIds: folderAccess.visibility === "restricted" ? folderAccess.memberIds : [] }),
      });
        const result = await response.json().catch(() => null) as { error?: string; folder?: VaultFolder } | null;
        if (generation !== folderGeneration.current) return;
      if (!response.ok || !result?.folder) {
        setFailure(result?.error ?? "Não foi possível criar a pasta.");
        return;
      }
      const created = result.folder;
      setAddedFolders((current) => [...current, created]);
      setFolderName("");
      setFolderAccess({ visibility: "public", memberIds: [] });
      setCreatingFolder(false);
      router.refresh();
      } catch {
        if (generation !== folderGeneration.current) return;
      setFailure("Não foi possível conectar. Confira sua conexão.");
    } finally {
      setSavingFolder(false);
    }
  }

  async function removeFolder(id: string) {
    setFailure("");
    const response = await fetch(`/api/vault/folders/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      setFailure(result?.error ?? "Não foi possível remover a pasta.");
      return;
    }
    setAddedFolders((current) => current.filter((folder) => folder.id !== id));
    router.refresh();
  }

  return <div className="flex min-h-0 flex-1 flex-col px-8 pt-6 pb-16 max-md:px-5 max-md:pt-5">
    <nav aria-label="Trilha" className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground" data-reveal>
      <Link href="/app/vault" className="rounded-md hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Cofre</Link>
      <ChevronRight className="size-3.5" aria-hidden="true" />
      <Link href={base} className="max-w-56 truncate rounded-md hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-current={folderId ? undefined : "page"}>{vaultCase.name}</Link>
      {path.map((folder, index) => (
        <span key={folder.id} className="flex items-center gap-1">
          <ChevronRight className="size-3.5" aria-hidden="true" />
          <Link href={href(folder.id)} aria-current={index === path.length - 1 ? "page" : undefined} className="max-w-48 truncate rounded-md hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{folder.name}</Link>
        </span>
      ))}
    </nav>

    <div className="mt-3 flex flex-wrap items-start justify-between gap-4 pb-5" data-reveal>
      <div className="min-w-0">
        {/* The record's name stays whole on a phone (DESIGN.md, "Mobile"); one line from md up. */}
        <h1 className="text-[24px] leading-[1.2] font-semibold tracking-[-0.02em] break-words md:text-[26px]">{vaultCase.name}</h1>
        {vaultCase.description && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{vaultCase.description}</p>}
        {vaultCase.client.name && <p className="mt-2 text-sm text-muted-foreground">{vaultCase.client.name}</p>}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <CaseSharing key={vaultCase.id} caseId={vaultCase.id} name={vaultCase.name} onOpenChange={setSharing} />
        <Button variant="ghost" className="min-h-11" onClick={askLume}><MessageSquare aria-hidden="true" />Pedir ao Lume</Button>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild><Button ref={moreActions} variant="ghost" className="size-11" aria-label="Mais ações do caso"><Ellipsis aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" onCloseAutoFocus={event => { if (deleting) event.preventDefault(); }}>
            {!external && <DropdownMenuItem asChild><Link href={agendaHref}><CalendarDays aria-hidden="true" />Tarefas e Agenda</Link></DropdownMenuItem>}
            <DropdownMenuItem onSelect={toggleFolderForm}><FolderPlus aria-hidden="true" />Nova pasta</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEditing(value => !value)}><Pencil aria-hidden="true" />{editing ? 'Fechar edição' : 'Editar caso'}</DropdownMenuItem>
            {!external && <DropdownMenuItem onSelect={toggleDrive}><Import aria-hidden="true" />{driveLabel}</DropdownMenuItem>}
            {!external && <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}><Trash2 aria-hidden="true" />Excluir caso</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    <CaseSections section={section} external={external} inFolder={Boolean(folderId)} onChange={changeSection} />
    {(section === 'all' || section === 'files') && <div className="flex flex-wrap items-center justify-end gap-3 py-3 [&_button]:min-h-11">
      {section === 'files' && <ViewToggle view={view} onChange={setView} />}
      <Button variant="ghost" className="min-h-11" onClick={toggleFolderForm}><FolderPlus aria-hidden="true" />Nova pasta</Button>
      <UploadControl scope="case" caseId={vaultCase.id} folderId={folderId} onError={setFailure} onUploaded={() => void firstPage()} />
    </div>}
    {/* The phone's "•••" menu opens the same confirmation. */}
    {!external && <CaseDelete open={deleting} onOpenChange={setDeleting} returnFocusTo={moreActions} {...deleteProps} />}

    {section === "files" && creatingFolder && <form onSubmit={submitFolder} className="grid gap-4 border-b py-4 sm:grid-cols-2 sm:items-start">
      <div className="grid gap-1.5"><Label htmlFor="folder-name">Nome da pasta</Label><Input id="folder-name" value={folderName} onChange={(event) => setFolderName(event.target.value)} maxLength={120} className="min-w-0" required /></div>
      <FolderAccessFields caseId={vaultCase.id} value={folderAccess} onChange={setFolderAccess} idPrefix="new-folder" />
      <Button type="submit" className="justify-self-start" disabled={!folderName.trim() || savingFolder || (folderAccess.visibility === "restricted" && !folderAccess.memberIds.length)}>{savingFolder && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}{savingFolder ? "Criando…" : "Criar pasta"}</Button>
    </form>}
    {accessFolder && <FolderAccessDialog key={accessFolder.id} caseId={vaultCase.id} folder={accessFolder} open onOpenChange={(open) => { if (!open) setAccessFolder(null); }} onSaved={(folder) => {
      setAccessChanges((current) => ({ ...current, [folder.id]: { visibility: folder.visibility, memberIds: folder.memberIds } }));
      router.refresh();
    }} />}

    {editing && <CaseDetailsForm vaultCase={vaultCase} onSaved={() => { setEditing(false); router.refresh(); }} onError={setFailure} />}

    {failure && <p className="mt-4 flex items-start gap-2 text-sm text-destructive" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{failure}</p>}

    <div className="mt-5 min-h-0 overflow-auto">
      {section === 'all' && <><CasePages key={`${vaultCase.id}:${folderId ?? 'root'}`} caseId={vaultCase.id} folderId={folderId} documents={documents} /><DocumentPagination {...pagination} /></>}
      {section === 'pages' && <CasePages caseId={vaultCase.id} folderId={folderId} />}
      {section === 'artifacts' && <CaseArtifacts key={vaultCase.id} caseId={vaultCase.id} caseName={vaultCase.name} />}
      {section === 'tasks' && <CaseTasks key={vaultCase.id} caseId={vaultCase.id} selectedTask={initialTask} />}
      {section === 'honorarios' && <CaseHonorarios key={vaultCase.id} caseId={vaultCase.id} />}
      {section === 'activity' && <CaseRecentActivity key={vaultCase.id} caseId={vaultCase.id} />}
      {section === 'participants' && !sharing && <><CaseLumePolicy key={vaultCase.id} caseId={vaultCase.id} /><CollaborationPanel caseId={vaultCase.id} /></>}
      {section === "files" && driveOpen && <DrivePanel initialCaseId={vaultCase.id} initialFolderId={folderId} onImported={firstPage} />}
      {!folderId && section === "processes" && <JudicialCaseLinks caseId={vaultCase.id} />}
      {!folderId && section === "references" && <ResearchCaseReferences caseId={vaultCase.id} external={external} />}
      {!folderId && section === "annexes" && <VaultAnnexes caseId={vaultCase.id} />}

      {(section === "files" || section === 'all') && shownFolders.length > 0 && (view === "cards" ? (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shownFolders.map((folder) => (
            <div key={folder.id} className="relative min-w-0">
              <Link href={href(folder.id)} className="grid min-h-24 min-w-0 grid-cols-1 gap-1 rounded-lg border border-border bg-card p-4 outline-none transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex min-w-0 items-center gap-2 font-medium"><FolderIcon folder={folder} /><span className={`min-w-0 truncate ${folder.owned ? "pr-20" : "pr-8"}`}>{folder.name}</span></span>
                <span className="mt-auto text-[13px] text-subtle-foreground">{[countLabel(folder.documentCount), visibilityNote(folder)].filter(Boolean).join(" · ")}</span>
              </Link>
              <div className="absolute top-2 right-2 flex">
                {folder.owned && <FolderAccessButton name={folder.name} onClick={() => setAccessFolder(folder)} />}
                {(folder.owned || !external) && <FolderDelete name={folder.name} hidden={folder.visibility !== "public"} onConfirm={() => void removeFolder(folder.id)} />}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-6">
          {shownFolders.map((folder) => (
            <div key={folder.id} className="flex items-center border-b">
              <Link href={href(folder.id)} className="flex min-h-12 min-w-0 flex-1 items-center gap-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                <FolderIcon folder={folder} /><span className="truncate">{folder.name}</span>
                <span className="ml-auto shrink-0 pr-2 pl-3 text-[13px] whitespace-nowrap text-subtle-foreground">{[visibilityNote(folder), countLabel(folder.documentCount)].filter(Boolean).join(" · ")}</span>
              </Link>
              {folder.owned && <FolderAccessButton name={folder.name} onClick={() => setAccessFolder(folder)} />}
              {(folder.owned || !external) && <FolderDelete name={folder.name} hidden={folder.visibility !== "public"} onConfirm={() => void removeFolder(folder.id)} />}
            </div>
          ))}
        </div>
      ))}

      {section === "files" && (<>
      <DocumentRows
        view={view}
        documents={documents}
        onError={setFailure}
        onRetried={(documentId) => setDocuments((current) => current.map((item) => item.id === documentId ? { ...item, status: "queued", progress: 0, errorMessage: null } : item))}
        onDeleted={() => void refresh()}
        empty={folderId ? "Esta pasta está vazia." : "Nenhum arquivo neste caso ainda."}
      />
      <DocumentPagination {...pagination} />
      </>)}
    </div>
  </div>;
}

function FolderIcon({ folder }: { folder: VaultFolder }) {
  const Icon = folder.visibility === "private" ? FolderLock : folder.visibility === "restricted" ? UsersRound : FolderClosed;
  return <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

function FolderAccessButton({ name, onClick }: { name: string; onClick: () => void }) {
  return <Button type="button" variant="ghost" size="icon-sm" className="size-11 shrink-0 md:size-8" aria-label={`Quem vê a pasta ${name}`} onClick={onClick}><UsersRound aria-hidden="true" /></Button>;
}

/** Reserved folders must be emptied before removal so their access rule is preserved. */
function FolderDelete({ name, hidden = false, onConfirm, className }: { name: string; hidden?: boolean; onConfirm: () => void; className?: string }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" className={`size-11 shrink-0 md:size-8 ${className ?? ""}`} aria-label={`Remover pasta ${name}`}><Trash2 aria-hidden="true" /></Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover a pasta {name}?</AlertDialogTitle>
          <AlertDialogDescription>{hidden ? "Para preservar o acesso reservado, mova o conteúdo ou altere quem vê a pasta antes de removê-la. Pastas privadas ou restritas só podem ser removidas quando estão vazias." : "Os arquivos e as subpastas sobem um nível. Nada é excluído."}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={onConfirm}>Remover pasta</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CaseDetailsForm({ vaultCase, onSaved, onError }: { vaultCase: VaultCase; onSaved: () => void; onError: (message: string) => void }) {
  const [name, setName] = useState(vaultCase.name);
  const [description, setDescription] = useState(vaultCase.description ?? "");
  const [client, setClient] = useState({
    name: vaultCase.client.name ?? "", document: vaultCase.client.document ?? "", email: vaultCase.client.email ?? "",
    phone: vaultCase.client.phone ?? "", notes: vaultCase.client.notes ?? "",
  });
  const [advanced, setAdvanced] = useState(Object.values(vaultCase.client).some(Boolean));
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    onError("");
    const response = await fetch(`/api/vault/cases/${vaultCase.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), description: description.trim() || null, client }),
    });
    setBusy(false);
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      onError(result?.error ?? "Não foi possível salvar o caso.");
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={save} className="grid gap-4 border-b py-5">
      <div className="grid gap-1.5"><Label htmlFor="edit-case-name">Título</Label><Input id="edit-case-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={180} required /></div>
      <div className="grid gap-1.5"><Label htmlFor="edit-case-description">Descrição</Label><Textarea id="edit-case-description" value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-20 resize-y" maxLength={4000} /></div>
      <button type="button" className="flex min-h-11 w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>
        <ChevronRight className={`size-4 transition-transform ${advanced ? "rotate-90" : ""}`} aria-hidden="true" />Dados do cliente (opcional)
      </button>
      {advanced && <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5"><Label htmlFor="edit-client-name">Nome</Label><Input id="edit-client-name" value={client.name} onChange={(event) => setClient({ ...client, name: event.target.value })} maxLength={180} /></div>
        <div className="grid gap-1.5"><Label htmlFor="edit-client-document">CPF ou CNPJ</Label><Input id="edit-client-document" value={client.document} onChange={(event) => setClient({ ...client, document: event.target.value })} maxLength={40} /></div>
        <div className="grid gap-1.5"><Label htmlFor="edit-client-email">E-mail</Label><Input id="edit-client-email" type="email" value={client.email} onChange={(event) => setClient({ ...client, email: event.target.value })} maxLength={200} /></div>
        <div className="grid gap-1.5"><Label htmlFor="edit-client-phone">Telefone</Label><Input id="edit-client-phone" value={client.phone} onChange={(event) => setClient({ ...client, phone: event.target.value })} maxLength={40} /></div>
        <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="edit-client-notes">Observações</Label><Textarea id="edit-client-notes" value={client.notes} onChange={(event) => setClient({ ...client, notes: event.target.value })} className="min-h-20 resize-y" maxLength={4000} /></div>
      </div>}
      <div><Button type="submit" disabled={busy}>{busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}Salvar caso</Button></div>
    </form>
  );
}
