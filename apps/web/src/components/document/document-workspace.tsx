"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { ArrowLeft, CircleAlert, Download, History, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Typography } from "@/lib/document-export";
import type { RichEditorHandle } from "./rich-editor";
import { DocumentReview, type ArtifactReference, type ValidationIssue } from "./document-review";

// The editor and the page renderer are the heavy parts; they load when a document opens.
const RichEditor = dynamic(() => import("./rich-editor").then((module) => module.RichEditor), {
  ssr: false, loading: () => <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Abrindo editor…</div>,
});
const PagePreview = dynamic(() => import("./page-preview").then((module) => module.PagePreview), { ssr: false });

type Artifact = {
  id: string; title: string; content: string; version: number; status: string;
  references: ArtifactReference[]; validationIssues: ValidationIssue[]; conversationId: string | null;
};
type SaveState = "saved" | "dirty" | "saving" | "conflict" | "error";
type Tab = "edit" | "page" | "review";
type Version = { version: number; title: string; createdAt: string };

const AUTOSAVE_MS = 1500;

function unwrap(value: unknown): Artifact | null {
  const record = (value as { artifact?: Partial<Artifact> } | null)?.artifact;
  if (!record || typeof record.id !== "string") return null;
  return {
    id: record.id, title: record.title || "Documento sem título", content: record.content ?? "", version: record.version ?? 1,
    status: record.status ?? "draft", references: record.references ?? [], validationIssues: record.validationIssues ?? [],
    conversationId: record.conversationId ?? null,
  };
}

async function errorMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

/** Word's body typography as the editor's CSS; without a template, the plain export's Arial 11. */
function typographyStyle(typography: Typography | null): CSSProperties {
  const t = typography;
  const width = t?.pageWidthCm && t.marginLeftCm != null && t.marginRightCm != null ? t.pageWidthCm - t.marginLeftCm - t.marginRightCm : 16;
  return {
    "--doc-font": t?.fontFamily ? `"${t.fontFamily.replace(/"/g, "")}", ui-serif, Georgia, serif` : "Arial, Helvetica, sans-serif",
    "--doc-size": `${t?.fontSizePt ?? 11}pt`,
    "--doc-line": String(t?.lineHeight ?? 1.5),
    "--doc-align": t?.textAlign ?? "left",
    "--doc-indent": `${t?.firstLineIndentCm ?? 0}cm`,
    maxWidth: `${Math.max(width, 8)}cm`,
  } as CSSProperties;
}

export type DocumentAsk = { artifactId: string; title: string; excerpt: string; instruction: string };

export function DocumentWorkspace({ artifactId, variant, onClose, onAsk, revision = 0 }: {
  artifactId: string;
  variant: "panel" | "page";
  onClose?: () => void;
  /** Present beside the chat: sends a request about a selected excerpt to the conversation. */
  onAsk?: (request: DocumentAsk) => Promise<void>;
  /** Bumped by the chat when the Lume changed this document. */
  revision?: number;
}) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "missing">("loading");
  const [title, setTitle] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("edit");
  const [typography, setTypography] = useState<Typography | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  // What the editor starts from; replaced (with a new key) whenever the stored text is reloaded.
  const [editorSeed, setEditorSeed] = useState("");
  const [lumeChanged, setLumeChanged] = useState(false);
  const [edits, setEdits] = useState(0);
  const [asked, setAsked] = useState(false);
  // The previous version's blocks, when a reload came from the Lume, so its changes can be marked.
  const [highlightAgainst, setHighlightAgainst] = useState<string[] | null>(null);

  const editorRef = useRef<RichEditorHandle>(null);
  const contentRef = useRef("");
  const titleRef = useRef("");
  const versionRef = useRef(0);
  const saveStateRef = useRef<SaveState>("saved");
  const savingRef = useRef<Promise<boolean> | null>(null);

  const markState = useCallback((next: SaveState) => { saveStateRef.current = next; setSaveState(next); }, []);

  const apply = useCallback((next: Artifact) => {
    setArtifact(next);
    setTitle(next.title);
    titleRef.current = next.title;
    contentRef.current = next.content;
    versionRef.current = next.version;
    setEditorSeed(next.content);
    setEditorKey((key) => key + 1);
    markState("saved");
    setLumeChanged(false);
    setError("");
    setPhase("ready");
  }, [markState]);

  const fetchArtifact = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`, { signal, cache: "no-store" });
    if (!response.ok) throw new Error(await errorMessage(response, "Não foi possível abrir o documento."));
    const next = unwrap(await response.json());
    if (!next) throw new Error("O documento retornou dados incompletos.");
    return next;
  }, [artifactId]);

  const fail = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : "Não foi possível abrir o documento.");
    setPhase((current) => current === "ready" ? current : "missing");
  }, []);

  const load = useCallback((highlight = false) => {
    const previous = highlight ? editorRef.current?.blockTexts() ?? null : null;
    return fetchArtifact().then((next) => { apply(next); setHighlightAgainst(previous); }, fail);
  }, [fetchArtifact, apply, fail]);

  useEffect(() => {
    // The panel and the page are keyed by document, so a new id always starts from "loading".
    const controller = new AbortController();
    fetchArtifact(controller.signal).then(apply, (cause) => { if (!controller.signal.aborted) fail(cause); });
    fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/format`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as { typography: Typography | null; templateName: string | null } : null)
      .then((body) => { if (body) { setTypography(body.typography); setTemplateName(body.templateName); } })
      .catch(() => undefined);
    return () => controller.abort();
  }, [artifactId, fetchArtifact, apply, fail]);

  /** Saves what is on screen. `snapshot` also records a version in the history. */
  const save = useCallback(async (snapshot: boolean): Promise<boolean> => {
    if (savingRef.current) await savingRef.current;
    if (saveStateRef.current !== "dirty" && !(snapshot && saveStateRef.current === "error")) return saveStateRef.current === "saved";
    const sent = { title: titleRef.current.trim() || "Documento sem título", content: contentRef.current };
    markState("saving");
    const run = (async () => {
      try {
        const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`, {
          method: "PUT", headers: { "content-type": "application/json" }, cache: "no-store",
          body: JSON.stringify({ ...sent, version: versionRef.current, snapshot }),
        });
        if (response.status === 409) { markState("conflict"); setError("Este documento mudou em outro lugar. Recarregue para ver a versão atual."); return false; }
        if (!response.ok) throw new Error(await errorMessage(response, "Não foi possível salvar o documento."));
        const next = unwrap(await response.json());
        if (next) { versionRef.current = next.version; setArtifact((current) => current ? { ...current, ...next, content: sent.content } : next); }
        setError("");
        // Typing during the request leaves newer text to save on the next round.
        const changed = contentRef.current !== sent.content || (titleRef.current.trim() || "Documento sem título") !== sent.title;
        markState(changed ? "dirty" : "saved");
        return !changed;
      } catch (cause) {
        markState("error");
        setError(cause instanceof Error ? cause.message : "Não foi possível salvar o documento.");
        return false;
      } finally { savingRef.current = null; }
    })();
    savingRef.current = run;
    return run;
  }, [artifactId, markState]);

  // Autosave after a pause in typing.
  useEffect(() => {
    if (saveState !== "dirty") return;
    const timer = setTimeout(() => void save(false), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [saveState, edits, save, editorKey]);

  // Leaving the page, the tab or the panel records what was written, as a version.
  useEffect(() => {
    const flush = () => {
      if (saveStateRef.current !== "dirty") return;
      void fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`, {
        method: "PUT", headers: { "content-type": "application/json" }, keepalive: true,
        body: JSON.stringify({ title: titleRef.current.trim() || "Documento sem título", content: contentRef.current, version: versionRef.current, snapshot: true }),
      }).catch(() => undefined);
    };
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => { window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", onHide); flush(); };
  }, [artifactId]);

  // The Lume changed the document: reload, unless the person has words the reload would discard.
  const seenRevision = useRef(revision);
  useEffect(() => {
    if (revision === seenRevision.current) return;
    seenRevision.current = revision;
    setAsked(false);
    if (saveStateRef.current === "dirty" || saveStateRef.current === "saving") setLumeChanged(true);
    else void load(true);
  }, [revision, load]);

  async function keepMine() {
    // The Lume's version stays in the history; the person's text becomes the newest version.
    const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`, { cache: "no-store" });
    const latest = response.ok ? unwrap(await response.json()) : null;
    if (latest) versionRef.current = latest.version;
    setLumeChanged(false);
    markState("dirty");
    await save(true);
  }

  // The Lume reads the stored text, so what is on screen is saved as a version first.
  async function ask(request: { excerpt: string; instruction: string }) {
    if (!onAsk) return;
    if (!(await save(true)) && saveStateRef.current !== "saved") throw new Error("Salve o documento antes de pedir ao Lume.");
    await onAsk({ artifactId, title: titleRef.current.trim() || "Documento sem título", ...request });
    setAsked(true);
  }

  function changeContent(markdown: string) {
    contentRef.current = markdown;
    setEdits((count) => count + 1);
    if (saveStateRef.current !== "conflict") markState("dirty");
  }
  function changeTitle(value: string) {
    setTitle(value);
    titleRef.current = value;
    setEdits((count) => count + 1);
    if (saveStateRef.current !== "conflict") markState("dirty");
  }

  async function openTab(next: Tab) {
    if (next === "page") await save(true);
    setTab(next);
  }

  async function exportDocx(event: MouseEvent<HTMLAnchorElement>) {
    if (saveStateRef.current !== "dirty" && saveStateRef.current !== "saving") return;
    event.preventDefault();
    const href = event.currentTarget.href;
    if (await save(true)) window.location.assign(href);
  }

  if (phase === "loading") {
    return <div className="grid flex-1 place-items-center text-sm text-muted-foreground" role="status"><span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Abrindo documento…</span></div>;
  }
  if (phase === "missing" || !artifact) {
    return (
      <div className="grid flex-1 place-items-center px-6 text-center">
        <div>
          <p className="text-sm text-destructive">{error || "Documento não encontrado."}</p>
          {onClose ? <Button variant="outline" className="mt-4" onClick={onClose}>Fechar</Button>
            : <Button asChild variant="outline" className="mt-4"><Link href="/app/agents">Voltar ao Lume</Link></Button>}
        </div>
      </div>
    );
  }

  const issues = artifact.validationIssues ?? [];
  const status = saveState === "saving" ? "Salvando…" : saveState === "dirty" ? "Alterações não salvas" : saveState === "conflict" ? "Conflito de versão"
    : saveState === "error" ? "Não salvo" : "Salvo";
  const backHref = artifact.conversationId ? `/app/agents?conversationId=${encodeURIComponent(artifact.conversationId)}` : "/app/agents";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="flex min-h-14 shrink-0 items-center gap-1.5 border-b px-2 md:px-4">
        {variant === "page"
          ? <Button asChild variant="ghost" size="icon" className="size-11 md:size-9" aria-label="Voltar à conversa"><Link href={backHref}><ArrowLeft /></Link></Button>
          : <Button variant="ghost" size="icon" className="size-11 lg:hidden" aria-label="Voltar à conversa" onClick={onClose}><ArrowLeft /></Button>}
        <label className="min-w-0 flex-1">
          <span className="sr-only">Título do documento</span>
          <input value={title} onChange={(event) => changeTitle(event.target.value)} maxLength={200} placeholder="Título do documento"
            className={cn("w-full truncate bg-transparent outline-none placeholder:text-subtle-foreground focus-visible:underline focus-visible:decoration-brand focus-visible:underline-offset-4",
              variant === "page" ? "display text-[22px] md:text-[26px]" : "text-[15px] font-medium")} />
        </label>
        <span className={cn("hidden shrink-0 text-xs sm:inline", saveState === "conflict" || saveState === "error" ? "text-destructive" : "text-muted-foreground")} aria-live="polite">{status}</span>
        <Versions artifactId={artifact.id} current={artifact.version} beforeRestore={() => save(true)} onRestored={() => void load(true)} />
        <Button asChild className="min-h-11 md:min-h-9">
          <a href={`/api/artifacts/${encodeURIComponent(artifact.id)}/export`} onClick={(event) => void exportDocx(event)} aria-label="Exportar DOCX">
            <Download aria-hidden="true" /><span className="hidden sm:inline">Exportar DOCX</span>
          </a>
        </Button>
        {variant === "panel" && <Button variant="ghost" size="icon" className="hidden size-9 lg:inline-flex" aria-label="Fechar documento" onClick={onClose}><X /></Button>}
      </header>

      <div className="flex shrink-0 items-center gap-1 border-b px-2 md:px-4" role="tablist" aria-label="Modo do documento">
        {([["edit", "Editar"], ["page", "Página"], ["review", issues.length ? `Revisão (${issues.length})` : "Revisão"]] as const).map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} aria-controls={`document-${value}`} id={`document-tab-${value}`}
            onClick={() => void openTab(value)}
            className={cn("relative min-h-11 px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring md:min-h-10",
              tab === value ? "font-medium text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-brand" : "text-muted-foreground hover:text-foreground")}>
            {label}
          </button>
        ))}
        <span className="ml-auto hidden truncate pl-3 text-xs text-subtle-foreground md:inline">{templateName ? `Modelo: ${templateName}` : "Sem modelo de documento"}</span>
      </div>

      {asked && !lumeChanged && (
        <div className="flex flex-wrap items-center gap-2 border-b border-l-2 border-l-brand px-4 py-2 text-sm" role="status">
          <span className="min-w-0 flex-1">Pedido enviado ao Lume. A alteração aparece aqui quando ele terminar.</span>
          {onClose && <Button size="sm" variant="ghost" className="min-h-11 lg:hidden" onClick={onClose}>Ver conversa</Button>}
        </div>
      )}
      {lumeChanged && (
        <div className="flex flex-wrap items-center gap-2 border-b border-l-2 border-l-brand px-4 py-2 text-sm" role="status">
          <span className="min-w-0 flex-1">O Lume alterou este documento enquanto você editava.</span>
          <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" onClick={() => void load(true)}>Ver versão do Lume</Button>
          <Button size="sm" variant="ghost" className="min-h-11 md:min-h-8" onClick={() => void keepMine()}>Manter a minha</Button>
        </div>
      )}
      {error && (
        <p className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-sm text-destructive" role="alert">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1">{error}</span>
          {saveState === "conflict" && <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" onClick={() => void load(true)}>Recarregar</Button>}
        </p>
      )}

      <div id="document-edit" role="tabpanel" aria-labelledby="document-tab-edit" hidden={tab !== "edit"} className="flex min-h-0 flex-1 flex-col data-[hidden]:hidden" data-hidden={tab !== "edit" || undefined}>
        <RichEditor key={editorKey} ref={editorRef} initialMarkdown={editorSeed} onChange={changeContent} onSave={() => void save(true)}
          style={typographyStyle(typography)} label="Texto do documento" onAsk={onAsk ? ask : undefined} highlightAgainst={highlightAgainst} />
      </div>
      {tab === "page" && (
        <div id="document-page" role="tabpanel" aria-labelledby="document-tab-page" className="flex min-h-0 flex-1 flex-col">
          <PagePreview artifactId={artifact.id} version={artifact.version} />
        </div>
      )}
      {tab === "review" && (
        <div id="document-review" role="tabpanel" aria-labelledby="document-tab-review" className="flex min-h-0 flex-1 flex-col">
          <DocumentReview artifactId={artifact.id} version={artifact.version} dirty={saveState !== "saved"} status={artifact.status} issues={issues} references={artifact.references ?? []} />
        </div>
      )}
    </div>
  );
}

function Versions({ artifactId, current, beforeRestore, onRestored }: { artifactId: string; current: number; beforeRestore: () => Promise<boolean>; onRestored: () => void }) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/versions`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await errorMessage(response, "Não foi possível listar as versões."));
        setVersions(((await response.json()) as { versions: Version[] }).versions);
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível listar as versões."); });
    return () => controller.abort();
  }, [open, artifactId]);

  async function restore(version: number) {
    setBusy(version);
    setError("");
    try {
      await beforeRestore();
      const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/restore`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Não foi possível restaurar a versão."));
      setOpen(false);
      onRestored();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível restaurar a versão.");
    } finally { setBusy(null); }
  }

  const when = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); };

  return (
    <Popover open={open} onOpenChange={(next) => { if (next) { setVersions(null); setError(""); } setOpen(next); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="size-11 md:size-9" aria-label="Versões"><History /></Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <p className="border-b px-4 py-3 text-sm font-medium">Versões</p>
        <div className="max-h-80 overflow-y-auto">
          {!versions && !error && <p role="status" className="px-4 py-3 text-sm text-muted-foreground">Carregando…</p>}
          {error && <p role="alert" className="px-4 py-3 text-sm text-destructive">{error}</p>}
          {versions?.length === 0 && <p className="px-4 py-3 text-sm text-subtle-foreground">Nenhuma versão registrada.</p>}
          {versions && versions.length > 0 && (
            <div className="divide-y">
              {versions.map((item) => (
                <div key={item.version} className="flex items-center gap-2 px-4 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">Versão {item.version}{item.version === current ? " · atual" : ""}</p>
                    <p className="text-xs text-muted-foreground">{when(item.createdAt)}</p>
                  </div>
                  {item.version !== current && (
                    <Button size="sm" variant="ghost" className="min-h-11 md:min-h-8" disabled={busy !== null} onClick={() => void restore(item.version)}>
                      {busy === item.version && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}Restaurar
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
