"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { CircleAlert, Download, FileText, LoaderCircle, Plus, RotateCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { OfficeRole } from "@/lib/offices";
import type { VaultDocument } from "@/lib/vault";

type VaultCase = { id: string; name: string };

const ALL_CASES = "__all";
// 44px on touch, compact from md up.
const touchIcon = "size-11 md:size-8";

export function VaultBrowser({ initialDocuments, initialCases, role }: { initialDocuments: VaultDocument[]; initialCases: VaultCase[]; role: OfficeRole }) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [cases, setCases] = useState(initialCases);
  const [scope, setScope] = useState<"all" | "library" | "case">("all");
  const [caseId, setCaseId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [caseName, setCaseName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const canWrite = role !== "reviewer";

  const refresh = useCallback(async () => {
    const search = new URLSearchParams();
    if (scope !== "all") search.set("scope", scope);
    if (scope === "case" && caseId) search.set("caseId", caseId);
    const response = await fetch(`/api/vault/documents?${search}`, { cache: "no-store" });
    if (response.ok) setDocuments((await response.json() as { documents: VaultDocument[] }).documents);
  }, [scope, caseId]);

  const pending = documents.some((document) => document.status === "queued" || document.status === "processing");
  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = pending ? window.setInterval(() => void refresh(), 3_000) : undefined;
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [pending, refresh]);

  async function submitUpload(event: FormEvent) {
    event.preventDefault();
    if (!file) { setFailure("Escolha um arquivo para enviar."); return; }
    if (scope === "case" && !caseId) { setFailure("Escolha um caso para o documento."); return; }
    setBusy(true); setNotice(""); setFailure("");
    const body = new FormData(); body.set("file", file); body.set("scope", scope === "case" ? "case" : "library"); if (scope === "case") body.set("caseId", caseId);
    const response = await fetch("/api/vault/documents", { method: "POST", body });
    const result = await response.json() as { error?: string; document?: VaultDocument };
    setBusy(false);
    if (!response.ok || !result.document) { setFailure(result.error ?? "Não foi possível enviar o arquivo."); return; }
    setFile(null); if (input.current) input.current.value = "";
    setDocuments((current) => [result.document!, ...current]);
    setNotice("Documento enviado. O processamento continua em segundo plano.");
  }

  async function submitCase(event: FormEvent) {
    event.preventDefault();
    const name = caseName.trim(); if (!name) return;
    setBusy(true); setNotice(""); setFailure("");
    const response = await fetch("/api/vault/cases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const result = await response.json() as { error?: string; case?: VaultCase };
    setBusy(false);
    if (!response.ok || !result.case) { setFailure(result.error ?? "Não foi possível criar o caso."); return; }
    setCases((current) => [result.case!, ...current]); setCaseId(result.case.id); setScope("case"); setCaseName("");
  }

  async function retry(documentId: string) {
    setNotice(""); setFailure("");
    const response = await fetch(`/api/vault/documents/${documentId}/retry`, { method: "POST" });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setFailure(result.error ?? "Não foi possível reenviar o documento."); return; }
    setDocuments((current) => current.map((document) => document.id === documentId ? { ...document, status: "queued", progress: 0, errorMessage: null } : document));
  }

  return <div className="flex min-h-0 flex-1 flex-col px-4 py-6 md:px-8 md:py-8">
    <div data-reveal className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
      <h1 className="display text-[28px] leading-none">Cofre</h1>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Mostrar documentos">
        {(["all", "library", "case"] as const).map((value) => <Button key={value} type="button" variant="ghost" size="sm" aria-pressed={scope === value} className="h-11 text-subtle-foreground md:h-8 aria-pressed:bg-accent aria-pressed:text-foreground" onClick={() => setScope(value)}>{value === "all" ? "Todos" : value === "library" ? "Biblioteca" : "Casos"}</Button>)}
      </div>
    </div>

    {scope === "case" && <div data-reveal className="mt-4 flex flex-wrap items-end gap-3 border-b pb-4">
      <div className="grid gap-1.5"><Label htmlFor="vault-case-filter">Caso</Label><Select value={caseId || ALL_CASES} onValueChange={(value) => setCaseId(value === ALL_CASES ? "" : value)}><SelectTrigger id="vault-case-filter" className="min-w-48"><SelectValue /></SelectTrigger><SelectContent position="popper"><SelectItem value={ALL_CASES}>Todos os casos</SelectItem>{cases.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
      {canWrite && <form onSubmit={submitCase} className="flex flex-wrap items-end gap-2"><div className="grid gap-1.5"><Label htmlFor="vault-new-case">Novo caso</Label><Input id="vault-new-case" value={caseName} onChange={(event) => setCaseName(event.target.value)} placeholder="Nome do caso" maxLength={180} /></div><Button type="submit" variant="outline" disabled={busy || !caseName.trim()}><Plus aria-hidden="true" />Criar caso</Button></form>}
    </div>}

    {canWrite && <form data-reveal onSubmit={submitUpload} className="mt-5 flex flex-wrap items-end gap-3 border-b pb-5">
      <div className="grid gap-1.5">
        <Label htmlFor="vault-file">Documento</Label>
        {/* The native file control carries its own font and chrome, so the button is ours and the input stays hidden. */}
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" onClick={() => input.current?.click()}>Escolher arquivo</Button>
          <span className="max-w-56 truncate text-sm text-muted-foreground">{file ? file.name : "Nenhum arquivo escolhido"}</span>
          <input ref={input} id="vault-file" type="file" className="sr-only" accept=".pdf,.docx,.eml,.xlsx,.csv,.txt" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </div>
      </div>
      {scope === "case" && <div className="grid gap-1.5"><Label htmlFor="vault-upload-case">Caso</Label><Select value={caseId} onValueChange={setCaseId}><SelectTrigger id="vault-upload-case" className="min-w-48"><SelectValue placeholder="Escolha um caso" /></SelectTrigger><SelectContent position="popper">{cases.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>}
      <Button type="submit" disabled={busy || !file}>{busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}Enviar</Button>
    </form>}
    {!canWrite && <p data-reveal className="mt-5 border-b pb-5 text-sm text-muted-foreground">Seu papel permite consultar e baixar documentos.</p>}
    {notice && <p className="mt-4 text-sm text-muted-foreground" role="status">{notice}</p>}
    {failure && <p className="mt-4 flex items-start gap-2 text-sm text-destructive" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{failure}</p>}

    <div className="mt-4 min-h-0 overflow-auto">
      {documents.length ? <div>
        <div className="hidden grid-cols-[minmax(240px,1fr)_150px_120px_130px] gap-4 border-b pb-2 text-[13px] text-muted-foreground md:grid"><span>Documento</span><span>Destino</span><span>Estado</span><span className="text-right">Ações</span></div>
        {documents.map((document) => <div key={document.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b py-2 text-sm md:grid-cols-[minmax(240px,1fr)_150px_120px_130px] md:py-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2"><FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="truncate">{document.name}</span></div>
            <p className={`mt-0.5 truncate pl-6 text-[13px] md:hidden ${document.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{document.caseName ?? "Biblioteca"} · {stateLabel(document)}</p>
          </div>
          <span className="hidden truncate text-muted-foreground md:block">{document.caseName ?? "Biblioteca"}</span>
          <span className={`hidden md:block ${document.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{stateLabel(document)}</span>
          <div className="flex justify-end gap-1"><Button asChild variant="ghost" size="icon-sm" className={touchIcon}><a href={`/api/vault/documents/${document.id}/download`} aria-label={`Baixar ${document.name}`}><Download aria-hidden="true" /></a></Button>{document.status === "failed" && canWrite && <Button type="button" variant="ghost" size="icon-sm" className={touchIcon} onClick={() => void retry(document.id)} aria-label={`Reenviar ${document.name}`}><RotateCw aria-hidden="true" /></Button>}</div>
        </div>)}
      </div> : <p className="py-10 text-sm text-subtle-foreground">Nenhum documento neste destino.</p>}
    </div>
  </div>;
}

function stateLabel(document: VaultDocument) {
  if (document.status === "queued") return "Na fila";
  if (document.status === "processing") return `Processando ${document.progress}%`;
  if (document.status === "ready") return "Pronto";
  return document.errorMessage ? `Falhou: ${document.errorMessage}` : "Falhou";
}
