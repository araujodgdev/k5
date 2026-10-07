"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { documentApi, documentHref, documentKey, type DocumentRef } from "@/lib/document-ref";
import { CanvasResourceReadError } from "@/lib/lume-workspace";
import { PublishDocument } from "./publish-document";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { ArrowLeft, CircleAlert, Download, History, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Typography } from "@/lib/document-export";
import type { RichEditorHandle } from "./rich-editor";
import { DocumentReview, type ArtifactReference, type StoredCitations, type ValidationIssue } from "./document-review";
import { toReview } from "@/lib/citations/labels";
import { DocumentConflictError, type DocumentDraftRevision } from '@/lib/document-drafts';
import { useDocumentDraft, useDocumentDrafts } from './document-drafts-provider';
import { useLumeState, useLumeWorkspace } from '@/components/lume/workspace-context';

// The editor and the page renderer are the heavy parts; they load when a document opens.
const RichEditor = dynamic(() => import("./rich-editor").then((module) => module.RichEditor), {
  ssr: false, loading: () => <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Abrindo editor…</div>,
});
const PagePreview = dynamic(() => import("./page-preview").then((module) => module.PagePreview), { ssr: false });

type Artifact = {
  id: string; title: string; content: string; version: number; status: string;
  references: ArtifactReference[]; validationIssues: ValidationIssue[]; conversationId: string | null;
};
type Tab = "edit" | "page" | "review";
type Version = { version: number; title: string; createdAt: string };

const AUTOSAVE_MS = 1500;
const emptyDraft = () => null;

function unwrap(value: unknown): Artifact | null {
  const body = value as { artifact?: Partial<Artifact>; page?: Partial<Artifact> } | null;
  const record = body?.artifact ?? body?.page;
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

export type DocumentAsk = { document: DocumentRef; title: string; excerpt: string; instruction: string };
export function DocumentWorkspace({ resource }: { resource: DocumentRef }) {
  return <DocumentEditor key={documentKey(resource)} resource={resource} />;
}

function DocumentEditor({ resource }: { resource: DocumentRef }) {
  const router = useRouter();
  const api = documentApi(resource);
  const key = documentKey(resource);
  const shared = resource.kind === "case-page";
  const workspace = useLumeWorkspace();
  const canvasState = useLumeState();
  const revision = canvasState.revisions[key] ?? 0;
  const draft = useDocumentDraft(key);
  const { register } = useDocumentDrafts();
  const draftState = useSyncExternalStore(draft.subscribe, draft.getSnapshot, emptyDraft);
  const [storedArtifact, setArtifact] = useState<Artifact | null>(null);
  const artifact = storedArtifact && draftState ? { ...storedArtifact, version: draftState.version } : null;
  const [phase, setPhase] = useState<"loading" | "ready" | "missing">("loading");
  const title = draftState?.title ?? '';
  const saveState = draftState?.state ?? 'saved';
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("edit");
  const [typography, setTypography] = useState<Typography | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  // What the editor starts from; replaced (with a new key) whenever the stored text is reloaded.
  const [editorSeed, setEditorSeed] = useState("");
  const [lumeChanged, setLumeChanged] = useState(false);
  const [asked, setAsked] = useState(false);
  // The previous version's blocks, when a reload came from the Lume, so its changes can be marked.
  const [highlightAgainst, setHighlightAgainst] = useState<string[] | null>(null);
  const [citations, setCitations] = useState<StoredCitations | null>(null);
  const [humanPending, setHumanPending] = useState<{ version: number; count: number } | null>(null);
  const onHumanPendingChange = useCallback((count: number) => setHumanPending({ version: artifact?.version ?? 0, count }), [artifact?.version]);
  const [rechecking, setRechecking] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "docx" | null>(null);
  const [exportError, setExportError] = useState("");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const editorRef = useRef<RichEditorHandle>(null);

  const request = useCallback(async (url: string, init?: RequestInit) => {
    const read = draft.captureRevision();
    const access = workspace.controller.captureResourceAccess({ kind: 'document', document: resource, href: documentHref(resource), title: draft.getSnapshot()?.title ?? '' });
    if (!draft.isValid(read)) throw new DOMException('Recurso invalidado.', 'AbortError');
    const response = await fetch(url, init);
    if (!draft.isValid(read)) throw new DOMException('Recurso invalidado.', 'AbortError');
    if (response.status === 401) { router.replace('/sign-in'); router.refresh(); throw new CanvasResourceReadError(401); }
    if (shared && (response.status === 403 || response.status === 404)) {
      workspace.invalidateResource(access);
      throw new CanvasResourceReadError(response.status);
    }
    if (response.status === 409) {
      draft.conflict();
      throw new DocumentConflictError('Este documento mudou em outro lugar. Suas alterações foram preservadas. Escolha qual versão manter.');
    }
    return response;
  }, [draft, resource, router, shared, workspace]);

  const apply = useCallback((next: Artifact, read: DocumentDraftRevision) => {
    if (!draft.replace(next, read)) return;
    setArtifact(next);
    setEditorSeed(next.content);
    setEditorKey((key) => key + 1);
    setLumeChanged(false);
    setError("");
    setPhase("ready");
  }, [draft]);

  const fetchArtifact = useCallback(async (signal?: AbortSignal) => {
    const read = draft.captureRevision();
    const response = await request(`${api}`, { signal, cache: "no-store" });
    if (!response.ok) throw new Error(await errorMessage(response, "Não foi possível abrir o documento."));
    const next = unwrap(await response.json());
    if (!draft.isValid(read)) throw new DOMException('Recurso invalidado.', 'AbortError');
    if (!next) throw new Error("O documento retornou dados incompletos.");
    return next;
  }, [api, draft, request]);

  const fail = useCallback((cause: unknown) => {
    if (cause instanceof DOMException && cause.name === 'AbortError') return;
    setError(cause instanceof Error ? cause.message : "Não foi possível abrir o documento.");
    setPhase((current) => current === "ready" ? current : "missing");
  }, []);

  const load = useCallback((highlight = false, read = draft.captureRevision()) => {
    const previous = highlight ? editorRef.current?.blockTexts() ?? null : null;
    return draft.waitForSave().then(() => fetchArtifact()).then((next) => {
      apply(next, read); setHighlightAgainst(previous);
    }, fail);
  }, [draft, fetchArtifact, apply, fail]);

  useEffect(() => {
    const controller = new AbortController();
    const read = draft.captureRevision();
    void draft.waitForSave().then(() => fetchArtifact(controller.signal)).then(next => {
      if (controller.signal.aborted || !draft.isValid(read)) return;
      draft.open(next, read);
      const current = draft.getSnapshot();
      setArtifact(next);
      setEditorSeed(current?.content ?? next.content);
      setEditorKey(key => key + 1);
      setPhase('ready');
    }, (cause) => { if (!controller.signal.aborted) fail(cause); });
    request(`${api}/format`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as { typography: Typography | null; templateName: string | null } : null)
      .then((body) => { if (body && !controller.signal.aborted && draft.isValid(read)) { setTypography(body.typography); setTemplateName(body.templateName); } })
      .catch(() => undefined);
    return () => controller.abort();
  }, [api, draft, fetchArtifact, fail, request]);

  // The citation check of the stored text; the Lume's writes refresh it on the server.
  const storedVersion = artifact?.version;
  useEffect(() => {
    if (!storedVersion || shared) return;
    const controller = new AbortController();
    fetch(`${api}/citations`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as StoredCitations : null)
      .then((body) => { if (body) setCitations(body); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [api, storedVersion, shared]);

  /** Saves what is on screen. `snapshot` also records a version in the history. */
  const save = useCallback((snapshot: boolean, leaving = false) => draft.save(async sent => {
    const read = draft.captureRevision();
    const body = JSON.stringify(sent);
    const response = await request(`${api}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, cache: 'no-store', body,
      keepalive: leaving && new TextEncoder().encode(body).byteLength <= 64 * 1024,
    });
    if (!response.ok) throw new Error(await errorMessage(response, 'Não foi possível salvar o documento.'));
    const next = unwrap(await response.json());
    if (!draft.isValid(read)) throw new DOMException('Recurso invalidado.', 'AbortError');
    if (!next) throw new Error('O documento retornou dados incompletos.');
    setArtifact(next);
    setError('');
    return { version: next.version };
  }, snapshot), [api, draft, request]);

  useEffect(() => register(key, () => save(true)), [key, register, save]);

  // Autosave after a pause in typing.
  useEffect(() => {
    if (saveState !== "dirty") return;
    const timer = setTimeout(() => void save(false), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [saveState, draftState?.content, draftState?.title, save, editorKey]);


  // Lifecycle saves share the autosave lock and update its version, including when the
  // page is restored from the back/forward cache. Unmount still finishes a queued save.
  useEffect(() => {
    const flush = () => { void save(true, true); };
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [draft, save]);

  // The Lume changed the document: reload, unless the person has words the reload would discard.
  const seenRevision = useRef(revision);
  useEffect(() => {
    if (revision === seenRevision.current) return;
    seenRevision.current = revision;
    const frame = requestAnimationFrame(() => {
      setAsked(false);
      if (draft.getSnapshot()?.state !== "saved") setLumeChanged(true);
      else void load(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [revision, draft, load]);

  async function keepMine() {
    // The Lume's version stays in the history; the person's text becomes the newest version.
    try {
      await draft.waitForSave();
      const latest = await fetchArtifact();
      draft.rebase(latest.version);
      setLumeChanged(false);
      await save(true);
    } catch (cause) { fail(cause); }
  }

  // The Lume reads the stored text, so what is on screen is saved as a version first.
  async function ask(request: { excerpt: string; instruction: string }) {
    if (!await save(true)) throw new Error("Salve o documento antes de pedir ao Lume.");
    await workspace.ask({ document: resource, title: draft.getSnapshot()?.title.trim() || "Documento sem título", ...request });
    setAsked(true);
  }

  async function recheckCitations() {
    setRechecking(true);
    try {
      if (!await save(true)) return;
      const response = await fetch(`${api}/citations`, { method: "POST", cache: "no-store" });
      if (!response.ok) throw new Error(await errorMessage(response, "Não foi possível conferir as citações."));
      setCitations(await response.json() as StoredCitations);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível conferir as citações.");
    } finally { setRechecking(false); }
  }

  function changeContent(markdown: string) {
    draft.edit({ content: markdown });
  }
  function changeTitle(value: string) {
    draft.edit({ title: value });
  }

  async function openTab(next: Tab) {
    if (next === "page" && !await save(true)) return;
    setTab(next);
  }

  async function download(format: "pdf" | "docx") {
    if (exporting || !artifact) return;
    setExportMenuOpen(false);
    setExporting(format);
    setExportError("");
    try {
      const read = draft.captureRevision();
      if (!await save(true)) return;
      const response = await request(`${api}/export?format=${format}&version=${draft.getSnapshot()?.version}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await errorMessage(response, "Não foi possível exportar o documento."));
      const blob = await response.blob();
      if (!draft.isValid(read)) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${draft.getSnapshot()?.title.replace(/[\\/:*?"<>|]/g, "-") || "documento"}.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) { setExportError(cause instanceof Error ? cause.message : "Não foi possível exportar o documento."); }
    finally { setExporting(null); }
  }

  if (phase === "loading") {
    return <div className="grid flex-1 place-items-center text-sm text-muted-foreground" role="status"><span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Abrindo documento…</span></div>;
  }
  if (phase === "missing" || !artifact) {
    return (
      <div className="grid flex-1 place-items-center px-6 text-center">
        <div>
          <p className="text-sm text-destructive">{error || "Documento não encontrado."}</p>
          <Button asChild variant="outline" className="mt-4"><Link href="/app/agents">Voltar ao Lume</Link></Button>
        </div>
      </div>
    );
  }

  const issues = artifact.validationIssues ?? [];
  const pendingCitations = citations?.review ? toReview(citations.review.items).length : 0;
  const reviewCount = humanPending?.version === artifact.version ? humanPending.count : issues.length + pendingCitations;
  const status = saveState === "saving" ? "Salvando…" : saveState === "dirty" ? "Alterações não salvas" : saveState === "conflict" ? "Conflito de versão"
    : saveState === "error" ? "Não salvo" : "Salvo";
  const backHref = shared ? `/app/vault/cases/${encodeURIComponent(resource.caseId)}?section=pages` : artifact.conversationId ? `/app/agents?conversationId=${encodeURIComponent(artifact.conversationId)}` : "/app/agents";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="flex min-h-14 shrink-0 items-center gap-1.5 border-b px-2 md:px-4">
        <Button asChild variant="ghost" size="icon" className="size-11 md:size-9" aria-label="Voltar à conversa"><Link href={backHref}><ArrowLeft /></Link></Button>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Título do documento</span>
          <input value={title} onChange={(event) => changeTitle(event.target.value)} maxLength={200} placeholder="Título do documento"
            className="display w-full truncate bg-transparent text-[22px] outline-none placeholder:text-subtle-foreground focus-visible:underline focus-visible:decoration-brand focus-visible:underline-offset-4 md:text-[26px]" />
        </label>
        <span className={cn("hidden shrink-0 text-xs sm:inline", saveState === "conflict" || saveState === "error" ? "text-destructive" : "text-muted-foreground")} aria-live="polite">{status}</span>
        <Versions api={api} request={request} current={artifact.version} beforeRestore={async () => {
          const read = draft.captureRevision();
          return await save(true) && draft.isValid(read) ? { version: draft.getSnapshot()?.version ?? artifact.version, read } : null;
        }} onRestored={(read) => void load(true, read)} />
        {!shared && <PublishDocument artifactId={artifact.id} beforePublish={() => save(true)} />}
        <Popover open={exportMenuOpen} onOpenChange={setExportMenuOpen}>
          <PopoverTrigger asChild><Button className="min-h-11 md:min-h-9" disabled={exporting !== null} aria-label={exporting ? `Exportando ${exporting.toUpperCase()}` : "Exportar documento"}>{exporting ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Download aria-hidden="true" />}<span className="hidden sm:inline">{exporting ? "Exportando…" : "Exportar"}</span></Button></PopoverTrigger>
          <PopoverContent align="end" className="grid w-44 gap-1 p-1">
            <Button variant="ghost" className="min-h-11 justify-start" onClick={() => void download("pdf")}>Exportar PDF</Button>
            <Button variant="ghost" className="min-h-11 justify-start" onClick={() => void download("docx")}>Exportar DOCX</Button>
          </PopoverContent>
        </Popover>
      </header>
      <p className="border-b px-4 py-2 text-xs text-muted-foreground">{shared ? "Compartilhado com quem tem acesso à pasta e às fontes utilizadas." : "Particular. Só você pode acessar este documento."}</p>
      {exportError && <p role="alert" className="border-b px-4 py-3 text-sm text-destructive">{exportError}</p>}

      <div className="flex shrink-0 items-center gap-1 border-b px-2 md:px-4" role="tablist" aria-label="Modo do documento">
        {([["edit", "Editar"], ["page", "Página"], ["review", reviewCount ? `Revisão (${reviewCount})` : "Revisão"]] as const).filter(([value]) => !shared || value !== "review").map(([value, label]) => (
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
        </div>
      )}
      {(lumeChanged || saveState === 'conflict') && (
        <div className="flex flex-wrap items-center gap-2 border-b border-l-2 border-l-brand px-4 py-2 text-sm" role="status">
          <span className="min-w-0 flex-1">{lumeChanged ? 'O Lume alterou este documento enquanto você editava.' : 'Este documento mudou em outro lugar. Suas alterações foram preservadas.'}</span>
          <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" onClick={() => void load(true)}>{lumeChanged ? 'Ver versão do Lume' : 'Ver versão salva'}</Button>
          <Button size="sm" variant="ghost" className="min-h-11 md:min-h-8" onClick={() => void keepMine()}>Manter a minha</Button>
        </div>
      )}
      {(error || draftState?.error) && (
        <p className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-sm text-destructive" role="alert">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1">{draftState?.error || error}</span>
          {saveState === "error" && <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" onClick={() => void save(true)}>Tentar salvar novamente</Button>}
        </p>
      )}

      <div id="document-edit" role="tabpanel" aria-labelledby="document-tab-edit" hidden={tab !== "edit"} className="flex min-h-0 flex-1 flex-col data-[hidden]:hidden" data-hidden={tab !== "edit" || undefined}>
        <RichEditor key={editorKey} ref={editorRef} initialMarkdown={editorSeed} onChange={changeContent} onSave={() => void save(true)}
          style={typographyStyle(typography)} label="Texto do documento" onAsk={ask} highlightAgainst={highlightAgainst} />
      </div>
      {tab === "page" && (
        <div id="document-page" role="tabpanel" aria-labelledby="document-tab-page" className="flex min-h-0 flex-1 flex-col">
          <PagePreview api={api} version={artifact.version} request={request} />
        </div>
      )}
      {tab === "review" && (
        <div id="document-review" role="tabpanel" aria-labelledby="document-tab-review" className="flex min-h-0 flex-1 flex-col">
          <DocumentReview artifactId={artifact.id} version={artifact.version} dirty={saveState !== "saved"} status={artifact.status} issues={issues} references={artifact.references ?? []}
            citations={citations} rechecking={rechecking} onRecheck={() => void recheckCitations()} onPendingChange={onHumanPendingChange} />
        </div>
      )}
    </div>
  );
}

function Versions({ api, current, request, beforeRestore, onRestored }: {
  api: string; current: number; request: (url: string, init?: RequestInit) => Promise<Response>;
  beforeRestore: () => Promise<{ version: number; read: DocumentDraftRevision } | null>;
  onRestored: (read: DocumentDraftRevision) => void;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    request(`${api}/versions`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await errorMessage(response, "Não foi possível listar as versões."));
        setVersions(((await response.json()) as { versions: Version[] }).versions);
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível listar as versões."); });
    return () => controller.abort();
  }, [open, api, request]);

  async function restore(version: number) {
    setBusy(version);
    setError("");
    try {
      const saved = await beforeRestore();
      if (saved === null) {
        setError("Salve as alterações antes de restaurar uma versão.");
        return;
      }
      const response = await request(`${api}/restore`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(api.startsWith('/api/cases/') ? { version: saved.version, restoreVersion: version } : { version }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Não foi possível restaurar a versão."));
      setOpen(false);
      onRestored(saved.read);
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
