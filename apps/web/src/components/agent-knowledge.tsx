"use client";

import { useId, useRef, useState } from "react";
import { CircleAlert, FileText, LoaderCircle, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DOCUMENT_ACCEPT } from "@/lib/ai-modalities";
import type { Knowledge, KnowledgeCandidate, KnowledgeMode, KnowledgeScope } from "@/lib/agent-knowledge";

export type KnowledgeState = { office: Knowledge[]; personal: Knowledge[]; budget: number; canEditOffice: boolean };

const modeLabel: Record<KnowledgeMode, string> = { always: "Ler sempre", search: "Buscar quando precisar" };
const statusLabel: Record<string, string> = { queued: "Na fila", processing: "Processando", ready: "Pronto", failed: "Falhou no processamento" };
// Short documents are cheap to read every time; longer ones default to search.
const defaultMode = (characters: number): KnowledgeMode => characters > 0 && characters <= 10_000 ? "always" : "search";
const thousands = (value: number) => value >= 1000 ? `${Math.round(value / 1000).toLocaleString("pt-BR")} mil` : value.toLocaleString("pt-BR");

async function errorMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

/** Mirrors the prompt: ready always-read documents, office first, each document once. */
function alwaysUsed(state: KnowledgeState) {
  const seen = new Set<string>();
  return [...state.office, ...state.personal]
    .filter((item) => item.mode === "always" && item.status === "ready" && !seen.has(item.documentId) && seen.add(item.documentId))
    .reduce((sum, item) => sum + item.characters, 0);
}

export function AgentKnowledge({ initial, initialCandidates }: { initial: KnowledgeState; initialCandidates: KnowledgeCandidate[] }) {
  const [state, setState] = useState(initial);
  const [candidates, setCandidates] = useState(initialCandidates);
  const used = alwaysUsed(state);
  const update = (scope: KnowledgeScope, change: (items: Knowledge[]) => Knowledge[]) => setState((current) => ({ ...current, [scope]: change(current[scope]) }));

  return (
    <section aria-labelledby="knowledge-heading" className="mt-10 border-t pt-8">
      <h2 id="knowledge-heading" className="font-medium">Conhecimento</h2>
      <p className="mt-1 text-sm text-muted-foreground">Documentos do Cofre que o Lume consulta. &ldquo;Ler sempre&rdquo; envia o texto em toda conversa; &ldquo;Buscar quando precisar&rdquo; só procura nele quando o assunto pede.</p>
      <p className="mt-2 text-[13px] text-muted-foreground" aria-live="polite">
        Leitura fixa: {thousands(used)} de {thousands(state.budget)} caracteres.
        {used > state.budget && " Os que passarem do limite serão buscados quando precisar."}
      </p>
      <KnowledgeGroup scope="office" title="Do escritório" items={state.office} editable={state.canEditOffice} candidates={candidates}
        emptyText="Nenhum documento do escritório." readOnlyNote="Definido pela administração do escritório."
        onChange={update} onUploaded={(item) => setCandidates((list) => [item, ...list])} />
      <KnowledgeGroup scope="personal" title="Meus documentos" items={state.personal} editable candidates={candidates}
        emptyText="Nenhum documento seu." note="Consultados só nas suas conversas e minutas."
        onChange={update} onUploaded={(item) => setCandidates((list) => [item, ...list])} />
    </section>
  );
}

function KnowledgeGroup({ scope, title, note, readOnlyNote, emptyText, items, editable, candidates, onChange, onUploaded }: {
  scope: KnowledgeScope; title: string; note?: string; readOnlyNote?: string; emptyText: string;
  items: Knowledge[]; editable: boolean; candidates: KnowledgeCandidate[];
  onChange: (scope: KnowledgeScope, change: (items: Knowledge[]) => Knowledge[]) => void;
  onUploaded: (item: KnowledgeCandidate) => void;
}) {
  const [busy, setBusy] = useState<"" | "add" | "upload">("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const selectId = useId();
  const available = candidates.filter((candidate) => !items.some((item) => item.documentId === candidate.id));

  async function add(documentId: string, mode: KnowledgeMode) {
    setError("");
    const response = await fetch("/api/agent/knowledge", {
      method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ scope, documentId, mode, note: "" }),
    });
    if (!response.ok) throw new Error(await errorMessage(response, "Não foi possível adicionar o documento."));
    const { knowledge } = await response.json() as { knowledge: Knowledge };
    onChange(scope, (list) => [...list, knowledge]);
  }

  async function choose(documentId: string) {
    const candidate = candidates.find((item) => item.id === documentId);
    setBusy("add");
    try { await add(documentId, defaultMode(candidate?.characters ?? 0)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível adicionar o documento."); }
    finally { setBusy(""); }
  }

  async function upload(file: File) {
    setBusy("upload");
    setError("");
    try {
      // Stored in the Cofre library like any upload; it is searchable once processing ends.
      const form = new FormData();
      form.set("file", file);
      form.set("scope", "library");
      const response = await fetch("/api/vault/documents", { method: "POST", body: form, cache: "no-store" });
      if (!response.ok) throw new Error(await errorMessage(response, "Não foi possível enviar o arquivo."));
      const { document } = await response.json() as { document: { id: string; name: string; status: string } };
      onUploaded({ id: document.id, name: document.name, status: document.status, characters: 0, caseName: null });
      await add(document.id, "search");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar o arquivo.");
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="mt-6" role="group" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-medium">{title}</h3>
      {(editable ? note : readOnlyNote) && <p className="mt-1 text-[13px] text-muted-foreground">{editable ? note : readOnlyNote}</p>}
      <div className="mt-3 divide-y border-y">
        {items.length === 0 && <p className="py-4 text-sm text-subtle-foreground">{emptyText}</p>}
        {items.map((item) => (
          <KnowledgeRow key={item.id} scope={scope} item={item} editable={editable}
            onSaved={(next) => onChange(scope, (list) => list.map((entry) => entry.id === next.id ? next : entry))}
            onRemoved={() => onChange(scope, (list) => list.filter((entry) => entry.id !== item.id))} />
        ))}
      </div>
      {editable && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor={selectId} className="sr-only">Adicionar do Cofre</label>
          <select id={selectId} value="" disabled={Boolean(busy) || available.length === 0}
            onChange={(event) => { if (event.target.value) void choose(event.target.value); }}
            className="h-11 min-w-0 max-w-full flex-1 rounded-md border bg-background px-3 text-sm md:h-9 md:max-w-72">
            <option value="">{available.length ? "Adicionar do Cofre" : "Nenhum outro documento no Cofre"}</option>
            {available.map((item) => <option key={item.id} value={item.id}>{item.caseName ? `${item.name} · ${item.caseName}` : item.name}</option>)}
          </select>
          <input ref={fileRef} type="file" accept={DOCUMENT_ACCEPT} className="sr-only" tabIndex={-1}
            onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
          <Button type="button" variant="outline" className="min-h-11 md:min-h-9" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}>
            {busy === "upload" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Upload aria-hidden="true" />}Enviar arquivo
          </Button>
          {busy === "add" && <span role="status" className="text-[13px] text-muted-foreground">Adicionando…</span>}
        </div>
      )}
      {error && <p role="alert" className="mt-2 flex items-start gap-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
    </div>
  );
}

function KnowledgeRow({ scope, item, editable, onSaved, onRemoved }: {
  scope: KnowledgeScope; item: Knowledge; editable: boolean; onSaved: (item: Knowledge) => void; onRemoved: () => void;
}) {
  const [note, setNote] = useState(item.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = useId();

  async function save(mode: KnowledgeMode, nextNote: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/agent/knowledge/${encodeURIComponent(item.id)}`, {
        method: "PUT", headers: { "content-type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ scope, mode, note: nextNote, version: item.version }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Não foi possível salvar."));
      const saved = (await response.json() as { knowledge: Knowledge }).knowledge;
      setNote(saved.note);
      onSaved(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar.");
    } finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/agent/knowledge/${encodeURIComponent(item.id)}?scope=${scope}`, { method: "DELETE", cache: "no-store" });
      if (!response.ok) throw new Error(await errorMessage(response, "Não foi possível remover."));
      onRemoved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível remover.");
      setBusy(false);
    }
  }

  const meta = item.status === "ready" ? `${thousands(item.characters)} caracteres` : statusLabel[item.status] ?? item.status;

  return (
    <div className="grid gap-2 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-4">
      <div className="min-w-0">
        <p className="flex min-w-0 items-center gap-2 text-sm">
          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate font-medium">{item.name}</span>
        </p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{editable ? meta : `${modeLabel[item.mode]} · ${meta}`}</p>
        {editable ? (
          <div className="mt-2">
            <label htmlFor={`${id}-note`} className="sr-only">Quando usar {item.name}</label>
            <input id={`${id}-note`} value={note} maxLength={300} disabled={busy} placeholder="Quando usar (opcional)"
              onChange={(event) => setNote(event.target.value)}
              onBlur={() => { if (note.trim() !== item.note) void save(item.mode, note); }}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
              className="h-11 w-full rounded-md border bg-background px-3 text-sm placeholder:text-subtle-foreground md:h-8" />
          </div>
        ) : item.note && <p className="mt-1 text-sm text-muted-foreground">{item.note}</p>}
        {error && <p role="alert" className="mt-1 flex items-start gap-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
      </div>
      {editable && (
        <div className="flex items-center gap-1">
          <label htmlFor={`${id}-mode`} className="sr-only">Modo de leitura de {item.name}</label>
          <select id={`${id}-mode`} value={item.mode} disabled={busy} onChange={(event) => void save(event.target.value as KnowledgeMode, note)}
            className="h-11 rounded-md border bg-background px-3 text-sm md:h-9">
            {(Object.keys(modeLabel) as KnowledgeMode[]).map((mode) => <option key={mode} value={mode}>{modeLabel[mode]}</option>)}
          </select>
          <Button type="button" variant="ghost" className="min-h-11 md:min-h-9" disabled={busy} onClick={() => void remove()} aria-label={`Remover ${item.name}`}>Remover</Button>
        </div>
      )}
    </div>
  );
}
