"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CircleAlert, FileText, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { requestCapability } from "@/lib/capabilities/http-client";
import type { ResearchCaseReference } from "@/lib/application/research-case-service";

export type VaultDocumentSummary = {
  id: string;
  name: string;
  caseId?: string | null;
  caseName?: string | null;
  status: "queued" | "processing" | "ready" | "failed" | string;
};

/** What this conversation has on its desk. `caseId` is where new uploads land, not a filter on answers. */
export type AgentContext = {
  caseId: string | null;
  documentIds: string[];
  researchReferenceIds: string[];
};

const ALL_CASES = "__all";

function statusLabel(document: VaultDocumentSummary) {
  if (document.status === "ready") return "Pronto";
  if (document.status === "failed") return "Falhou";
  if (document.status === "processing") return "Processando";
  return "Na fila";
}

async function responseError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
  return body?.error ?? body?.message ?? fallback;
}

/**
 * A plain view of the files attached to this conversation, and a way to add or remove one.
 * It does not decide what the person is here to do: work is asked for in the conversation.
 */
export function AgentSourcesPanel({ context, onChange, onClose }: {
  context: AgentContext;
  onChange: (context: AgentContext) => void;
  onClose?: () => void;
}) {
  const [documents, setDocuments] = useState<VaultDocumentSummary[]>([]);
  const [cases, setCases] = useState<Array<{ id: string; name: string }>>([]);
  const [references, setReferences] = useState<ResearchCaseReference[]>([]);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [referencesError, setReferencesError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [caseFilter, setCaseFilter] = useState<string>(context.caseId ?? ALL_CASES);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const [response, caseResponse] = await Promise.all([
          fetch("/api/vault/documents", { signal: controller.signal, cache: "no-store" }),
          fetch("/api/vault/cases", { signal: controller.signal, cache: "no-store" }),
        ]);
        if (!response.ok) throw new Error(await responseError(response, "Não foi possível carregar o Cofre."));
        const body = (await response.json()) as { documents?: VaultDocumentSummary[] } | VaultDocumentSummary[];
        setDocuments(Array.isArray(body) ? body : (body.documents ?? []));
        if (caseResponse.ok) setCases(((await caseResponse.json()) as { cases: Array<{ id: string; name: string }> }).cases);
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Não foi possível carregar o Cofre.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!context.caseId) return;
    const caseId = context.caseId;
    let live = true;
    const load = async () => {
      setReferencesLoading(true); setReferencesError("");
      const result = await requestCapability('k5_research_list_references', { caseId });
      if (!live) return;
      if (result.ok) setReferences((result.data as { references: ResearchCaseReference[] }).references);
      else setReferencesError(result.error);
      setReferencesLoading(false);
    };
    void load();
    return () => { live = false; };
  }, [context.caseId]);

  const attached = useMemo(
    () => context.documentIds.map((id) => documents.find((document) => document.id === id)).filter(Boolean) as VaultDocumentSummary[],
    [context.documentIds, documents],
  );

  const term = query.trim().toLocaleLowerCase("pt-BR");
  const available = documents.filter((document) => {
    if (context.documentIds.includes(document.id)) return false;
    if (caseFilter !== ALL_CASES && document.caseId !== caseFilter) return false;
    return !term || document.name.toLocaleLowerCase("pt-BR").includes(term);
  });

  function toggle(id: string) {
    const selected = context.documentIds.includes(id);
    const next = selected ? context.documentIds.filter((value) => value !== id) : [...context.documentIds, id];
    const caseId = selected ? context.caseId : documents.find((document) => document.id === id)?.caseId ?? context.caseId;
    onChange({ caseId: caseId ?? null, documentIds: next, researchReferenceIds: caseId === context.caseId ? context.researchReferenceIds : [] });
  }

  function selectCase(value: string) {
    setCaseFilter(value);
    setReferences([]);
    const next = value === ALL_CASES ? null : value;
    onChange({ ...context, caseId: next, researchReferenceIds: next === context.caseId ? context.researchReferenceIds : [] });
  }

  function toggleReference(id: string) {
    const selected = context.researchReferenceIds.includes(id);
    onChange({ ...context, researchReferenceIds: selected
      ? context.researchReferenceIds.filter(value => value !== id)
      : [...context.researchReferenceIds, id] });
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <h2 className="text-base font-medium">Fontes desta conversa</h2>
        {onClose && <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar fontes"><X /></Button>}
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-5 [&>*]:min-w-0">
        {attached.length === 0 && context.researchReferenceIds.length === 0 && (
          <p className="text-sm text-subtle-foreground">
            Nenhuma fonte selecionada. O assistente ainda pode procurar no Cofre; escolha arquivos ou referências para esta conversa.
          </p>
        )}
        {attached.map((document) => (
          <div key={document.id} className="flex min-h-12 min-w-0 items-center gap-3 border-b py-2 text-sm last:border-b-0">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{document.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{document.caseName ?? "Biblioteca"} · {statusLabel(document)}</span>
            </span>
            <Button variant="ghost" size="icon-sm" className="size-11 shrink-0 md:size-8" onClick={() => toggle(document.id)} aria-label={`Remover ${document.name}`}><X /></Button>
          </div>
        ))}

        {context.researchReferenceIds.map(id => {
          const reference = references.find(item => item.id === id);
          return <div key={id} className="flex min-h-12 min-w-0 items-center gap-3 border-b py-2 text-sm"><span className="min-w-0 flex-1"><span className="block truncate">{reference?.material?.title ?? 'Referência do caso'}</span><span className="block text-xs text-muted-foreground">{reference?.material?.kind === 'full_text' ? 'Inteiro teor' : 'Ementa'} · Julgado</span></span><Button variant="ghost" size="icon-sm" className="size-11 shrink-0 md:size-8" onClick={() => toggleReference(id)} aria-label={`Remover referência ${reference?.material?.title ?? id}`}><X /></Button></div>;
        })}

        <div className="mt-7 flex min-w-0 flex-col gap-3">
          <h3 className="text-sm font-medium">Adicionar do Cofre</h3>
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="sources-case">Caso</Label>
              <Select value={caseFilter} onValueChange={selectCase}>
                <SelectTrigger id="sources-case" className="w-full max-w-full overflow-hidden [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value={ALL_CASES}>Todos os casos e a biblioteca</SelectItem>
                  {cases.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="sources-search">Buscar</Label>
              <div className="relative min-w-0">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden="true" />
                <Input id="sources-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome do arquivo" className="h-11 pl-9 md:h-9" />
              </div>
            </div>
          </div>

          {loading && <p className="py-3 text-sm text-muted-foreground">Carregando o Cofre…</p>}
          {loadError && <p className="flex gap-2 py-3 text-sm text-destructive" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{loadError}</p>}
          {!loading && !loadError && available.length === 0 && (
            <p className="py-3 text-sm text-subtle-foreground">Nada mais para anexar aqui. <Link href="/app/vault" className="underline underline-offset-2">Abrir o Cofre</Link>.</p>
          )}
          <div className="min-w-0">
            {available.slice(0, 60).map((document) => (
              <button
                key={document.id}
                type="button"
                onClick={() => toggle(document.id)}
                className="flex min-h-12 min-w-0 w-full items-center gap-3 border-b py-2 text-left text-sm outline-none last:border-b-0 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{document.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{document.caseName ?? "Biblioteca"} · {statusLabel(document)}</span>
                </span>
                <span className="shrink-0 text-xs text-subtle-foreground">Anexar</span>
              </button>
            ))}
          </div>
          <div className="mt-5 border-t pt-5"><h3 className="text-sm font-medium">Referências do caso</h3>
            {!context.caseId && <p className="py-3 text-sm text-subtle-foreground">Escolha um caso para selecionar julgados vinculados.</p>}
            {referencesLoading && <p className="py-3 text-sm text-muted-foreground">Carregando referências…</p>}
            {referencesError && <p role="alert" className="py-3 text-sm text-destructive">{referencesError}</p>}
            {context.caseId && !referencesLoading && !referencesError && references.length === 0 && <p className="py-3 text-sm text-subtle-foreground">Este caso ainda não tem referências. <Link href="/app/research" className="underline underline-offset-2">Abrir Pesquisa</Link>.</p>}
            {context.caseId && references.filter(item => !context.researchReferenceIds.includes(item.id)).map(reference => <button key={reference.id} type="button" disabled={!reference.material?.localAllowed || reference.material.materialStatus !== 'ready'} onClick={() => toggleReference(reference.id)} className="flex min-h-12 min-w-0 w-full items-center justify-between gap-3 border-b py-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"><span className="min-w-0"><span className="block truncate">{reference.material?.title ?? 'Material indisponível'}</span><span className="block text-xs text-muted-foreground">{reference.material?.kind === 'full_text' ? 'Inteiro teor' : 'Ementa'} · {reference.material?.tribunal ?? 'Fonte indisponível'}</span></span><span className="shrink-0 text-xs text-subtle-foreground">{reference.material?.localAllowed && reference.material.materialStatus === 'ready' ? 'Selecionar' : 'Indisponível'}</span></button>)}
          </div>
        </div>
      </div>
    </div>
  );
}
