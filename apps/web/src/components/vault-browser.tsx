"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ChevronRight, CircleAlert, FolderClosed, LayoutGrid, Library, List, LoaderCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CaseDelete } from "@/components/vault-case-delete";
import type { OfficeRole } from "@/lib/offices";
import type { VaultCase } from "@/lib/vault";

type View = "cards" | "list";

const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
function formatDate(value: string) {
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
}

function countLabel(count: number) {
  return count === 1 ? "1 arquivo" : `${count} arquivos`;
}

/**
 * The office drive. A case is a folder with its own page; the library is where documents that
 * belong to no case live. Nothing here decides what will be done with a file.
 */
export function VaultBrowser({ initialCases, libraryCount, role }: { initialCases: VaultCase[]; libraryCount: number; role: OfficeRole }) {
  const [cases, setCases] = useState(initialCases);
  const [view, setView] = useState<View>("cards");
  const [creating, setCreating] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [client, setClient] = useState({ name: "", document: "", email: "", phone: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const canWrite = role !== "reviewer";
  const drop = (caseId: string) => setCases((current) => current.filter((item) => item.id !== caseId));

  async function submitCase(event: FormEvent) {
    event.preventDefault();
    const clean = name.trim();
    if (clean.length < 2) { setFailure("Informe um nome de caso com pelo menos 2 caracteres."); return; }
    setBusy(true); setFailure("");
    const response = await fetch("/api/vault/cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: clean, description: description.trim() || null, client }),
    });
    const result = await response.json().catch(() => null) as { error?: string; case?: VaultCase } | null;
    setBusy(false);
    if (!response.ok || !result?.case) { setFailure(result?.error ?? "Não foi possível criar o caso."); return; }
    setCases((current) => [result.case!, ...current.filter((item) => item.id !== result.case!.id)]);
    setName(""); setDescription(""); setClient({ name: "", document: "", email: "", phone: "", notes: "" });
    setCreating(false); setAdvanced(false);
  }

  return <div className="flex min-h-0 flex-1 flex-col px-4 py-6 md:px-8 md:py-8">
    <div data-reveal className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
      <h1 className="display text-[28px] leading-none max-md:sr-only">Cofre</h1>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label="Modo de exibição">
          <Button type="button" variant="ghost" size="icon-sm" className="size-11 md:size-8 aria-pressed:bg-accent aria-pressed:text-foreground" aria-pressed={view === "cards"} onClick={() => setView("cards")} aria-label="Ver em cartões"><LayoutGrid aria-hidden="true" /></Button>
          <Button type="button" variant="ghost" size="icon-sm" className="size-11 md:size-8 aria-pressed:bg-accent aria-pressed:text-foreground" aria-pressed={view === "list"} onClick={() => setView("list")} aria-label="Ver em lista"><List aria-hidden="true" /></Button>
        </div>
        {canWrite && <Button type="button" aria-expanded={creating} variant={creating ? "outline" : "default"} onClick={() => { setCreating((value) => !value); setFailure(""); }}>{creating ? "Cancelar" : <><Plus aria-hidden="true" />Novo caso</>}</Button>}
      </div>
    </div>

    {creating && canWrite && <form data-reveal onSubmit={submitCase} className="grid gap-4 border-b py-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5"><Label htmlFor="case-name">Título</Label><Input id="case-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Silva vs. Construtora Horizonte" maxLength={180} required /></div>
      </div>
      <div className="grid gap-1.5"><Label htmlFor="case-description">Descrição</Label><Textarea id="case-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Do que trata este caso." className="min-h-20 resize-y" maxLength={4000} /></div>
      <button type="button" className="flex min-h-11 w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>
        <ChevronRight className={`size-4 transition-transform ${advanced ? "rotate-90" : ""}`} aria-hidden="true" />Dados do cliente (opcional)
      </button>
      {advanced && <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5"><Label htmlFor="client-name">Nome</Label><Input id="client-name" value={client.name} onChange={(event) => setClient({ ...client, name: event.target.value })} maxLength={180} /></div>
        <div className="grid gap-1.5"><Label htmlFor="client-document">CPF ou CNPJ</Label><Input id="client-document" value={client.document} onChange={(event) => setClient({ ...client, document: event.target.value })} maxLength={40} /></div>
        <div className="grid gap-1.5"><Label htmlFor="client-email">E-mail</Label><Input id="client-email" type="email" value={client.email} onChange={(event) => setClient({ ...client, email: event.target.value })} maxLength={200} /></div>
        <div className="grid gap-1.5"><Label htmlFor="client-phone">Telefone</Label><Input id="client-phone" value={client.phone} onChange={(event) => setClient({ ...client, phone: event.target.value })} maxLength={40} /></div>
        <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="client-notes">Observações</Label><Textarea id="client-notes" value={client.notes} onChange={(event) => setClient({ ...client, notes: event.target.value })} className="min-h-20 resize-y" maxLength={4000} /></div>
      </div>}
      <div><Button type="submit" disabled={busy}>{busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}Criar caso</Button></div>
    </form>}

    {failure && <p className="mt-4 flex items-start gap-2 text-sm text-destructive" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{failure}</p>}

    <div className="mt-5 min-h-0 overflow-auto" data-reveal>
      {view === "cards" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Link href="/app/vault/library" className="grid min-h-28 gap-1 rounded-2xl border p-4 outline-none transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex items-center gap-2 font-medium"><Library className="size-4 text-muted-foreground" aria-hidden="true" />Biblioteca</span>
            <span className="text-sm text-muted-foreground">Arquivos fora de um caso</span>
            <span className="mt-auto text-[13px] text-subtle-foreground">{countLabel(libraryCount)}</span>
          </Link>
          {cases.map((item) => (
            <div key={item.id} className="relative">
              <Link href={`/app/vault/cases/${item.id}`} className="grid min-h-28 gap-1 rounded-2xl border p-4 outline-none transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex items-center gap-2 font-medium"><FolderClosed className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="truncate pr-8">{item.name}</span></span>
                <span className="line-clamp-2 text-sm text-muted-foreground">{item.description || item.client.name || "Sem descrição"}</span>
                <span className="mt-auto text-[13px] text-subtle-foreground">{countLabel(item.documentCount)} · {formatDate(item.updatedAt)}</span>
              </Link>
              {canWrite && <CaseDelete caseId={item.id} name={item.name} documentCount={item.documentCount} onError={setFailure} onDeleted={() => drop(item.id)} className="absolute top-2 right-2" />}
            </div>
          ))}
        </div>
      ) : (
        <div>
          <div className="hidden gap-4 border-b pb-2 text-[13px] text-muted-foreground md:grid md:grid-cols-[minmax(240px,1fr)_120px_120px_44px]"><span>Pasta</span><span>Arquivos</span><span>Atualizado</span><span className="sr-only">Ações</span></div>
          <Link href="/app/vault/library" className="grid min-h-12 grid-cols-[minmax(0,1fr)] items-center gap-4 border-b py-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:grid-cols-[minmax(240px,1fr)_120px_120px]">
            <span className="flex min-w-0 items-center gap-2"><Library className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="truncate">Biblioteca</span></span>
            <span className="hidden text-muted-foreground md:block">{libraryCount}</span>
            <span className="hidden text-muted-foreground md:block">—</span>
          </Link>
          {cases.map((item) => (
            <div key={item.id} className="flex items-center border-b">
              <Link href={`/app/vault/cases/${item.id}`} className="grid min-h-12 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] items-center gap-4 py-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:grid-cols-[minmax(240px,1fr)_120px_120px]">
                <span className="flex min-w-0 items-center gap-2"><FolderClosed className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="truncate">{item.name}</span></span>
                <span className="hidden text-muted-foreground md:block">{item.documentCount}</span>
                <span className="hidden text-muted-foreground md:block">{formatDate(item.updatedAt)}</span>
              </Link>
              {canWrite && <CaseDelete caseId={item.id} name={item.name} documentCount={item.documentCount} onError={setFailure} onDeleted={() => drop(item.id)} />}
            </div>
          ))}
        </div>
      )}
      {cases.length === 0 && <p className="py-10 text-sm text-subtle-foreground">Nenhum caso ainda. Crie o primeiro para organizar os arquivos por processo.</p>}
    </div>
  </div>;
}
