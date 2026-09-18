"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CircleAlert, FileText, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type VaultDocument = {
  id: string;
  name: string;
  caseId?: string | null;
  caseName?: string | null;
  status: "queued" | "processing" | "ready" | "failed" | string;
};

export type AgentContext = {
  caseId: string | null;
  documentIds: string[];
};

type CitationCandidate = { id: string; text: string; sourceLabel: string };
type RunKind = "chronology" | "draft";
type RunState = {
  id: string;
  kind?: RunKind;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress?: number;
  error?: string | null;
  artifactId?: string | null;
  createdAt?: string;
};

const ALL_CASES = "__all";
const kindLabels: Record<RunKind, string> = { chronology: "Cronologia", draft: "Minuta" };

function runStatusText(run: RunState) {
  if (run.status === "queued") return "Na fila";
  if (run.status === "running") return `Processando${typeof run.progress === "number" ? ` · ${run.progress}%` : ""}`;
  if (run.status === "completed") return "Pronto";
  if (run.status === "failed") return "Não foi possível concluir";
  return "Cancelado";
}

const isActive = (run: RunState) => run.status === "queued" || run.status === "running";

type Props = {
  context: AgentContext;
  onChange: (context: AgentContext) => void;
  onClose?: () => void;
};

function unwrapRun(value: unknown): RunState | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const run = (record.run ?? value) as Record<string, unknown>;
  if (typeof run.id !== "string" || typeof run.status !== "string") return null;
  return run as unknown as RunState;
}

async function responseError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
  return body?.error ?? body?.message ?? fallback;
}

export function AgentContextPanel({ context, onChange, onClose }: Props) {
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [kind, setKind] = useState<RunKind>("chronology");
  const [templateId, setTemplateId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [citations, setCitations] = useState<CitationCandidate[]>([]);
  const [approvedCitationIds, setApprovedCitationIds] = useState<string[]>([]);
  const [citationsLoading, setCitationsLoading] = useState(false);
  const [citationsError, setCitationsError] = useState("");
  // Recent runs come from the server so progress survives closing the panel.
  const [runs, setRuns] = useState<RunState[]>([]);
  const [runError, setRunError] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function loadDocuments() {
      setLoading(true);
      setLoadError("");
      try {
        const response = await fetch("/api/vault/documents?scope=all", { signal: controller.signal });
        if (!response.ok) throw new Error(await responseError(response, "Não foi possível carregar os documentos."));
        const body = (await response.json()) as { documents?: VaultDocument[] } | VaultDocument[];
        setDocuments(Array.isArray(body) ? body : (body.documents ?? []));
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Não foi possível carregar os documentos.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadDocuments();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (kind !== "draft" || context.documentIds.length === 0) return;
    const controller = new AbortController();
    async function loadCitations() {
      setCitationsLoading(true);
      setCitationsError("");
      try {
        const results = await Promise.all(
          context.documentIds.map(async (documentId) => {
            const response = await fetch(`/api/citations?documentId=${encodeURIComponent(documentId)}`, { signal: controller.signal });
            if (!response.ok) throw new Error(await responseError(response, "Não foi possível procurar citações."));
            const body = (await response.json()) as { candidates?: CitationCandidate[] } | CitationCandidate[];
            return Array.isArray(body) ? body : (body.candidates ?? []);
          }),
        );
        const unique = new Map(results.flat().map((candidate) => [candidate.id, candidate]));
        setCitations([...unique.values()]);
      } catch (error) {
        if (!controller.signal.aborted) { setCitations([]); setCitationsError(error instanceof Error ? error.message : "Não foi possível procurar citações."); }
      } finally {
        if (!controller.signal.aborted) setCitationsLoading(false);
      }
    }
    void loadCitations();
    return () => controller.abort();
  }, [context.documentIds, kind]);

  const hasActiveRun = runs.some(isActive);
  useEffect(() => {
    let cancelled = false;
    async function loadRuns() {
      try {
        const response = await fetch("/api/runs", { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as { runs?: RunState[] };
        if (!cancelled) setRuns(body.runs ?? []);
      } catch {
        // The next tick retries; the last known state stays visible.
      }
    }
    const first = window.setTimeout(() => void loadRuns(), 0);
    const timer = hasActiveRun ? window.setInterval(() => void loadRuns(), 2000) : undefined;
    return () => { cancelled = true; window.clearTimeout(first); window.clearInterval(timer); };
  }, [hasActiveRun]);

  const cases = useMemo(() => {
    const values = new Map<string, string>();
    for (const document of documents) {
      if (document.caseId) values.set(document.caseId, document.caseName || "Caso sem nome");
    }
    return [...values.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [documents]);

  const availableDocuments = documents.filter(
    (document) => document.status === "ready" && (!context.caseId || document.caseId === context.caseId),
  );
  const templates = documents.filter(
    (document) => document.status === "ready" && /\.docx$/i.test(document.name),
  );
  const canStart = context.documentIds.length > 0 && !starting && (kind === "chronology" || Boolean(templateId));

  function setCase(caseId: string) {
    const allowed = new Set(documents.filter((document) => !caseId || document.caseId === caseId).map((document) => document.id));
    onChange({ caseId: caseId || null, documentIds: context.documentIds.filter((id) => allowed.has(id)) });
  }

  function toggleDocument(id: string) {
    const selected = context.documentIds.includes(id);
    onChange({
      ...context,
      documentIds: selected ? context.documentIds.filter((value) => value !== id) : [...context.documentIds, id],
    });
  }

  async function startRun() {
    if (!canStart) return;
    setRunError("");
    setStarting(true);
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind,
        documentIds: context.documentIds,
        ...(kind === "draft" ? { templateId, approvedCitationIds } : {}),
        instructions: instructions.trim(),
      }),
    });
    if (!response.ok) {
      setRunError(await responseError(response, "Não foi possível iniciar o trabalho."));
      setStarting(false);
      return;
    }
    const next = unwrapRun(await response.json());
    if (next) setRuns((current) => [{ ...next, kind }, ...current.filter((item) => item.id !== next.id)]);
    setStarting(false);
  }

  async function changeRun(id: string, action: "retry" | "cancel") {
    setRunError("");
    const response = await fetch(`/api/runs/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!response.ok) {
      setRunError(await responseError(response, "Não foi possível atualizar o trabalho."));
      return;
    }
    const next = unwrapRun(await response.json());
    if (next) setRuns((current) => current.map((item) => item.id === next.id ? next : item));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-5 py-4">
        <h2 className="text-base font-medium">Preparar documento</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="grid gap-5">
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Tipo de trabalho</legend>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 border-b py-2 text-sm">
              <input type="radio" name="run-kind" value="chronology" checked={kind === "chronology"} onChange={() => { setKind("chronology"); setApprovedCitationIds([]); setCitations([]); }} className="size-4 accent-foreground" />
              <span><span className="block font-medium">Cronologia</span><span className="text-muted-foreground">Organiza fatos, divergências e lacunas.</span></span>
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 border-b py-2 text-sm">
              <input type="radio" name="run-kind" value="draft" checked={kind === "draft"} onChange={() => { setKind("draft"); setApprovedCitationIds([]); setCitations([]); }} className="size-4 accent-foreground" />
              <span><span className="block font-medium">Minuta</span><span className="text-muted-foreground">Redige a partir de um modelo do escritório.</span></span>
            </label>
          </fieldset>

          {cases.length > 0 && (
            <div className="grid gap-1.5">
              <Label htmlFor="agent-case">Caso</Label>
              <Select value={context.caseId ?? ALL_CASES} onValueChange={(value) => setCase(value === ALL_CASES ? "" : value)}>
                <SelectTrigger id="agent-case" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value={ALL_CASES}>Biblioteca e todos os casos</SelectItem>
                  {cases.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <fieldset className="grid gap-1">
            <legend className="mb-1 text-sm font-medium">Documentos de fatos</legend>
            {loading && <p className="py-3 text-sm text-muted-foreground">Carregando documentos…</p>}
            {loadError && <p className="flex gap-2 py-3 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" />{loadError}</p>}
            {!loading && !loadError && availableDocuments.length === 0 && <p className="py-3 text-sm text-subtle-foreground">Nenhum documento processado neste contexto.</p>}
            {availableDocuments.map((document) => (
              <label key={document.id} className="flex min-h-11 cursor-pointer items-center gap-3 border-b py-2 text-sm last:border-b-0">
                <input type="checkbox" checked={context.documentIds.includes(document.id)} onChange={() => toggleDocument(document.id)} className="size-4 rounded accent-foreground" />
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0"><span className="block truncate">{document.name}</span>{document.caseName && <span className="block truncate text-xs text-muted-foreground">{document.caseName}</span>}</span>
              </label>
            ))}
          </fieldset>

          {kind === "draft" && (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="agent-template">Modelo DOCX</Label>
                <Select value={templateId} onValueChange={setTemplateId} disabled={templates.length === 0}>
                  <SelectTrigger id="agent-template" className="w-full"><SelectValue placeholder={templates.length ? "Selecione o timbrado e a estrutura" : "Nenhum modelo DOCX processado"} /></SelectTrigger>
                  <SelectContent position="popper">
                    {templates.map((document) => <SelectItem key={document.id} value={document.id}>{document.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <fieldset className="grid gap-1">
                <legend className="mb-1 text-sm font-medium">Citações jurídicas autorizadas</legend>
                <p className="mb-1 text-xs text-muted-foreground">Nenhuma é usada sem sua seleção explícita.</p>
                {citationsLoading && <p className="py-2 text-sm text-muted-foreground">Procurando citações nos documentos…</p>}
                {citationsError && <p className="flex gap-2 py-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" />{citationsError}</p>}
                {!citationsLoading && !citationsError && citations.length === 0 && <p className="py-2 text-sm text-subtle-foreground">Nenhuma citação candidata encontrada.</p>}
                {citations.map((citation) => (
                  <label key={citation.id} className="flex cursor-pointer gap-3 border-b py-2.5 text-sm last:border-b-0">
                    <input type="checkbox" checked={approvedCitationIds.includes(citation.id)} onChange={() => setApprovedCitationIds((current) => current.includes(citation.id) ? current.filter((id) => id !== citation.id) : [...current, citation.id])} className="mt-0.5 size-4 shrink-0 rounded accent-foreground" />
                    <span><span className="line-clamp-3">{citation.text}</span><span className="mt-1 block text-xs text-muted-foreground">{citation.sourceLabel}</span></span>
                  </label>
                ))}
              </fieldset>
            </>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="run-instructions">Orientações</Label>
            <Textarea id="run-instructions" value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder={kind === "chronology" ? "Ex.: destaque mudanças de responsabilidade." : "Ex.: adote uma argumentação direta e sinalize dados ausentes."} className="min-h-24 resize-y" />
          </div>

          {runs.length > 0 && (
            <section aria-labelledby="recent-runs" aria-live="polite">
              <h3 id="recent-runs" className="mb-1 text-sm font-medium">Trabalhos recentes</h3>
              {runs.slice(0, 5).map((item) => (
                <div key={item.id} className="flex min-h-12 items-center justify-between gap-3 border-b py-2 text-sm last:border-b-0">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2">
                      {isActive(item) && <LoaderCircle className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                      <span>{item.kind ? kindLabels[item.kind] : "Trabalho"}</span>
                      <span className="text-muted-foreground">· {runStatusText(item)}</span>
                    </p>
                    {item.error && <p className="mt-0.5 text-xs text-destructive">{item.error}</p>}
                  </div>
                  {item.status === "completed" && item.artifactId && <Button asChild variant="outline" size="sm" className="h-11 shrink-0 md:h-8"><Link href={`/app/documents/${item.artifactId}`}>Abrir</Link></Button>}
                  {item.status === "failed" && <Button variant="ghost" size="sm" className="h-11 shrink-0 md:h-8" onClick={() => void changeRun(item.id, "retry")}>Tentar novamente</Button>}
                  {isActive(item) && <Button variant="ghost" size="sm" className="h-11 shrink-0 md:h-8" onClick={() => void changeRun(item.id, "cancel")}>Cancelar</Button>}
                </div>
              ))}
            </section>
          )}
          {runError && <p className="flex gap-2 text-sm text-destructive" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" />{runError}</p>}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t px-5 py-4">
        {onClose && <Button variant="ghost" onClick={onClose}>Fechar</Button>}
        <Button onClick={() => void startRun()} disabled={!canStart}>{starting && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}{kind === "chronology" ? "Criar cronologia" : "Criar minuta"}</Button>
      </div>
    </div>
  );
}
