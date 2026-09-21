"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CircleAlert, FileText, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
        const response = await fetch("/api/vault/documents", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(await responseError(response, "Não foi possível carregar o Cofre."));
        const body = (await response.json()) as { documents?: VaultDocumentSummary[] } | VaultDocumentSummary[];
        setDocuments(Array.isArray(body) ? body : (body.documents ?? []));
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Não foi possível carregar o Cofre.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  const attached = useMemo(
    () => context.documentIds.map((id) => documents.find((document) => document.id === id)).filter(Boolean) as VaultDocumentSummary[],
    [context.documentIds, documents],
  );

  const cases = useMemo(() => {
    const values = new Map<string, string>();
    for (const document of documents) if (document.caseId) values.set(document.caseId, document.caseName || "Caso sem nome");
    return [...values.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [documents]);

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
    onChange({ caseId: caseId ?? null, documentIds: next });
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <h2 className="text-base font-medium">Fontes desta conversa</h2>
        {onClose && <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar fontes"><X /></Button>}
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-5 [&>*]:min-w-0">
        {attached.length === 0 && (
          <p className="text-sm text-subtle-foreground">
            Nenhum arquivo anexado. O assistente ainda pode procurar em todo o Cofre; anexe algo para restringir a conversa a esses arquivos.
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

        <div className="mt-7 flex min-w-0 flex-col gap-3">
          <h3 className="text-sm font-medium">Adicionar do Cofre</h3>
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="sources-case">Caso</Label>
              <Select value={caseFilter} onValueChange={setCaseFilter}>
                <SelectTrigger id="sources-case" className="w-full max-w-full overflow-hidden [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value={ALL_CASES}>Todos os casos e a biblioteca</SelectItem>
                  {cases.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
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
        </div>
      </div>
    </div>
  );
}
