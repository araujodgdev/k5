"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ChevronRight, CircleAlert, FolderClosed, FolderPlus, LayoutGrid, List, LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DocumentRows, UploadControl, usePolledDocuments } from "@/components/vault-files";
import { CaseDelete } from "@/components/vault-case-delete";
import { JudicialCaseLinks } from "@/components/judicial-case-links";
import { ResearchCaseReferences } from "@/components/research-case-references";
import { VaultAnnexes } from "@/components/vault-annexes";
import { DrivePanel } from "@/components/google/drive-panel";
import type { OfficeRole } from "@/lib/offices";
import type { VaultCase, VaultDocument, VaultFolder } from "@/lib/vault";

type View = "cards" | "list";

function countLabel(count: number) {
  return count === 1 ? "1 arquivo" : `${count} arquivos`;
}

export function VaultCaseView({ vaultCase, folders, path, initialDocuments, folderId, role, initialSection = 'files' }: {
  vaultCase: VaultCase;
  folders: VaultFolder[];
  path: VaultFolder[];
  initialDocuments: VaultDocument[];
  folderId: string | null;
  role: OfficeRole;
  initialSection?: 'files' | 'references' | 'annexes';
}) {
  const router = useRouter();
  const canWrite = role !== "reviewer";
  const query = `caseId=${encodeURIComponent(vaultCase.id)}&folderId=${folderId ? encodeURIComponent(folderId) : "root"}`;
  const { documents, setDocuments, refresh } = usePolledDocuments(query, initialDocuments);
  const [view, setView] = useState<View>("list");
  const [section, setSection] = useState<"files" | "processes" | "references" | "annexes">(initialSection);
  const [failure, setFailure] = useState("");
  const [folderName, setFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [editing, setEditing] = useState(false);
  const [driveOpen, setDriveOpen] = useState(false);

  const base = `/app/vault/cases/${vaultCase.id}`;
  const href = (target: string | null) => (target ? `${base}?folder=${encodeURIComponent(target)}` : base);

  async function submitFolder(event: FormEvent) {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) return;
    setFailure("");
    const response = await fetch("/api/vault/folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId: vaultCase.id, name, parentId: folderId }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      setFailure(result?.error ?? "Não foi possível criar a pasta.");
      return;
    }
    setFolderName("");
    setCreatingFolder(false);
    router.refresh();
  }

  async function removeFolder(id: string) {
    setFailure("");
    const response = await fetch(`/api/vault/folders/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      setFailure(result?.error ?? "Não foi possível remover a pasta.");
      return;
    }
    router.refresh();
  }

  return <div className="flex min-h-0 flex-1 flex-col px-5 py-6 md:px-10 md:py-10">
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

    <div className="mt-3 flex flex-wrap items-end justify-between gap-4 border-b pb-5" data-reveal>
      <div className="min-w-0">
        <h1 className="page-title truncate leading-none">{vaultCase.name}</h1>
        {vaultCase.description && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{vaultCase.description}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" asChild><Link href={`/app/agenda?caseId=${encodeURIComponent(vaultCase.id)}`}>Tarefas e Agenda</Link></Button>
        {!folderId && (
          <div className="flex gap-1" role="group" aria-label="Seção do caso">
            <Button type="button" variant="ghost" className={section === "files" ? "bg-accent text-foreground" : ""} aria-pressed={section === "files"} onClick={() => setSection("files")}>Arquivos</Button>
            <Button type="button" variant="ghost" className={section === "processes" ? "bg-accent text-foreground" : ""} aria-pressed={section === "processes"} onClick={() => setSection("processes")}>Processos</Button>
            <Button type="button" variant="ghost" className={section === "references" ? "bg-accent text-foreground" : ""} aria-pressed={section === "references"} onClick={() => setSection("references")}>Referências</Button>
            <Button type="button" variant="ghost" className={section === "annexes" ? "bg-accent text-foreground" : ""} aria-pressed={section === "annexes"} onClick={() => setSection("annexes")}>Anexos</Button>
          </div>
        )}
        {section === "files" && (
          <>
            <div className="flex gap-1" role="group" aria-label="Modo de exibição">
              <Button type="button" variant="ghost" size="icon-sm" className="size-11 md:size-8 aria-pressed:bg-accent aria-pressed:text-foreground" aria-pressed={view === "cards"} onClick={() => setView("cards")} aria-label="Ver em cartões"><LayoutGrid aria-hidden="true" /></Button>
              <Button type="button" variant="ghost" size="icon-sm" className="size-11 md:size-8 aria-pressed:bg-accent aria-pressed:text-foreground" aria-pressed={view === "list"} onClick={() => setView("list")} aria-label="Ver em lista"><List aria-hidden="true" /></Button>
            </div>
            {canWrite && <Button type="button" variant="outline" aria-expanded={creatingFolder} onClick={() => { setCreatingFolder((value) => !value); setFailure(""); }}><FolderPlus aria-hidden="true" />Nova pasta</Button>}
            <UploadControl canWrite={canWrite} scope="case" caseId={vaultCase.id} folderId={folderId} onError={setFailure} onUploaded={(document) => setDocuments((current) => [document, ...current])} />
            <Button type="button" variant="outline" aria-expanded={driveOpen} onClick={() => setDriveOpen(open => !open)}>
              {driveOpen ? "Fechar Google Drive" : canWrite ? "Importar do Google Drive" : "Ver Google Drive"}
            </Button>
          </>
        )}
        {canWrite && <Button type="button" variant="ghost" aria-expanded={editing} onClick={() => setEditing((value) => !value)}>{editing ? "Fechar detalhes" : "Detalhes"}</Button>}
        {canWrite && <CaseDelete caseId={vaultCase.id} name={vaultCase.name} documentCount={vaultCase.documentCount} onError={setFailure} onDeleted={() => { router.push("/app/vault"); router.refresh(); }} />}
      </div>
    </div>

    {section === "files" && creatingFolder && canWrite && <form onSubmit={submitFolder} className="flex flex-wrap items-end gap-3 border-b py-4">
      <div className="grid gap-1.5"><Label htmlFor="folder-name">Nome da pasta</Label><Input id="folder-name" value={folderName} onChange={(event) => setFolderName(event.target.value)} maxLength={120} className="min-w-56" required /></div>
      <Button type="submit" disabled={!folderName.trim()}>Criar pasta</Button>
    </form>}

    {editing && canWrite && <CaseDetailsForm vaultCase={vaultCase} onSaved={() => { setEditing(false); router.refresh(); }} onError={setFailure} />}

    {failure && <p className="mt-4 flex items-start gap-2 text-sm text-destructive" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{failure}</p>}

    <div className="mt-5 min-h-0 overflow-auto">
      {section === "files" && driveOpen && <DrivePanel role={role} initialCaseId={vaultCase.id} initialFolderId={folderId} onImported={refresh} />}
      {!folderId && section === "processes" && <JudicialCaseLinks caseId={vaultCase.id} canWrite={canWrite} />}
      {!folderId && section === "references" && <ResearchCaseReferences caseId={vaultCase.id} canWrite={canWrite} />}
      {!folderId && section === "annexes" && <VaultAnnexes caseId={vaultCase.id} canWrite={canWrite} />}

      {section === "files" && folders.length > 0 && (view === "cards" ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {folders.map((folder) => (
            <div key={folder.id} className="relative">
              <Link href={href(folder.id)} className="grid min-h-24 gap-1 rounded-2xl border p-4 outline-none transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex items-center gap-2 font-medium"><FolderClosed className="size-4 text-muted-foreground" aria-hidden="true" /><span className="truncate pr-8">{folder.name}</span></span>
                <span className="mt-auto text-[13px] text-subtle-foreground">{countLabel(folder.documentCount)}</span>
              </Link>
              {canWrite && <FolderDelete name={folder.name} onConfirm={() => void removeFolder(folder.id)} className="absolute top-2 right-2" />}
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-6">
          {folders.map((folder) => (
            <div key={folder.id} className="flex items-center border-b">
              <Link href={href(folder.id)} className="flex min-h-12 min-w-0 flex-1 items-center gap-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                <FolderClosed className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="truncate">{folder.name}</span>
                <span className="ml-auto pr-2 text-[13px] text-subtle-foreground">{countLabel(folder.documentCount)}</span>
              </Link>
              {canWrite && <FolderDelete name={folder.name} onConfirm={() => void removeFolder(folder.id)} />}
            </div>
          ))}
        </div>
      ))}

      {section === "files" && (
      <DocumentRows
        documents={documents}
        canWrite={canWrite}
        onError={setFailure}
        onRetried={(documentId) => setDocuments((current) => current.map((item) => item.id === documentId ? { ...item, status: "queued", progress: 0, errorMessage: null } : item))}
        onDeleted={(documentId) => setDocuments((current) => current.filter((item) => item.id !== documentId))}
        empty={folderId ? "Esta pasta está vazia." : "Nenhum arquivo neste caso ainda."}
      />
      )}
    </div>
  </div>;
}

function FolderDelete({ name, onConfirm, className }: { name: string; onConfirm: () => void; className?: string }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" className={`size-11 shrink-0 md:size-8 ${className ?? ""}`} aria-label={`Remover pasta ${name}`}><Trash2 aria-hidden="true" /></Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover a pasta {name}?</AlertDialogTitle>
          <AlertDialogDescription>Os arquivos e as subpastas sobem um nível. Nada é excluído.</AlertDialogDescription>
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
