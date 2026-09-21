"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Bold,
  CircleAlert,
  Download,
  Heading2,
  Italic,
  List,
  ListOrdered,
  LoaderCircle,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocumentVerification } from './document-verification';

type ArtifactReference = {
  id?: string;
  sourceLabel?: string;
  label?: string;
  locator?: string;
  excerpt?: string;
};

type ValidationIssue = string | { message?: string; text?: string };

type Artifact = {
  id: string;
  title: string;
  content: string;
  version: number;
  status: "draft" | "needs_review" | string;
  references?: ArtifactReference[];
  validationIssues?: ValidationIssue[];
};

function unwrapArtifact(value: unknown): Artifact | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { artifact?: unknown; document?: unknown };
  const candidate = (record.artifact ?? record.document ?? value) as Partial<Artifact>;
  if (typeof candidate.id !== "string") return null;
  return {
    id: candidate.id,
    title: candidate.title || "Documento sem título",
    content: candidate.content || "",
    version: candidate.version ?? 1,
    status: candidate.status || "draft",
    references: candidate.references ?? [],
    validationIssues: candidate.validationIssues ?? [],
  };
}

async function getError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
  return body?.error ?? body?.message ?? fallback;
}

function issueText(issue: ValidationIssue) {
  return typeof issue === "string" ? issue : issue.message ?? issue.text ?? "Verificação pendente";
}

export function DocumentEditor({ artifactId }: { artifactId: string }) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(await getError(response, "Não foi possível abrir o documento."));
        const next = unwrapArtifact(await response.json());
        if (!next) throw new Error("O documento retornou dados incompletos.");
        setArtifact(next);
        setTitle(next.title);
        setContent(next.content);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível abrir o documento.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [artifactId]);

  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);

  async function save() {
    if (!artifact || saving || !dirty) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/artifacts/${encodeURIComponent(artifact.id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim() || "Documento sem título", content, version: artifact.version }),
      });
      if (!response.ok) throw new Error(await getError(response, response.status === 409 ? "Este documento foi alterado em outra sessão. Recarregue antes de salvar." : "Não foi possível salvar o documento."));
      const next = unwrapArtifact(await response.json());
      setArtifact(next ?? { ...artifact, title: title.trim() || "Documento sem título", content, version: artifact.version + 1 });
      setDirty(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o documento.");
    } finally {
      setSaving(false);
    }
  }

  function changeTitle(value: string) {
    setTitle(value);
    setDirty(true);
  }

  function changeContent(value: string) {
    setContent(value);
    setDirty(true);
  }

  function wrapSelection(before: string, after = before, fallback = "texto") {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = content.slice(start, end) || fallback;
    const next = `${content.slice(0, start)}${before}${selected}${after}${content.slice(end)}`;
    changeContent(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }

  function prefixLines(prefix: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = content.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const selected = content.slice(lineStart, end) || "Item";
    const replacement = selected.split("\n").map((line, index) => `${prefix === "1. " ? `${index + 1}. ` : prefix}${line}`).join("\n");
    changeContent(`${content.slice(0, lineStart)}${replacement}${content.slice(end)}`);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(lineStart, lineStart + replacement.length);
    });
  }

  if (loading) {
    return <div className="grid flex-1 place-items-center text-sm text-muted-foreground"><span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />Abrindo documento…</span></div>;
  }

  if (!artifact) {
    return <div className="mx-auto grid min-h-[50dvh] max-w-lg place-items-center px-6 text-center"><div><p className="text-sm text-destructive">{error || "Documento não encontrado."}</p><Button asChild variant="outline" className="mt-4"><Link href="/app/agents">Voltar aos agentes</Link></Button></div></div>;
  }

  const references = artifact.references ?? [];
  const issues = artifact.validationIssues ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-16 flex-wrap items-center gap-2 border-b px-4 py-2 md:px-8">
        <Button asChild variant="ghost" size="icon" aria-label="Voltar aos agentes"><Link href="/app/agents"><ArrowLeft /></Link></Button>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Título do documento</span>
          <input value={title} onChange={(event) => changeTitle(event.target.value)} className="display w-full truncate bg-transparent text-[24px] outline-none placeholder:text-subtle-foreground md:text-[28px]" placeholder="Título do documento" />
        </label>
        <span className="mr-1 text-xs text-muted-foreground" aria-live="polite">{saving ? "Salvando…" : dirty ? "Alterações não salvas" : "Salvo"}</span>
        <Button onClick={() => void save()} disabled={!dirty || saving}><Save />Salvar</Button>
        <Button asChild variant="outline"><a href={`/api/artifacts/${encodeURIComponent(artifact.id)}/export`}><Download />Exportar DOCX</a></Button>
      </header>

      {error && <div className="border-b px-4 py-2 text-sm text-destructive md:px-8" role="alert">{error}</div>}

      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_18rem]">
        <section aria-label="Editor" className="flex min-h-0 min-w-0 flex-col md:border-r">
          <div className="flex flex-wrap items-center gap-1 border-b px-4 py-2 md:px-8" role="toolbar" aria-label="Formatação do documento">
            <ToolbarButton label="Título de seção" onClick={() => prefixLines("## ")}><Heading2 /></ToolbarButton>
            <ToolbarButton label="Negrito" onClick={() => wrapSelection("**")}><Bold /></ToolbarButton>
            <ToolbarButton label="Itálico" onClick={() => wrapSelection("_")}><Italic /></ToolbarButton>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <ToolbarButton label="Lista" onClick={() => prefixLines("- ")}><List /></ToolbarButton>
            <ToolbarButton label="Lista numerada" onClick={() => prefixLines("1. ")}><ListOrdered /></ToolbarButton>
            <p className="ml-auto hidden text-xs text-muted-foreground lg:block">Use títulos para organizar a estrutura antes da exportação.</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-10">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(event) => changeContent(event.target.value)}
              onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); } }}
              aria-label="Conteúdo do documento"
              spellCheck
              className="mx-auto block min-h-full w-full max-w-[52rem] resize-none rounded-md bg-background text-sm leading-7 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
        </section>

        <aside className="min-h-0 overflow-y-auto border-t px-5 py-5 md:border-t-0">
          <section>
            <h2 className="font-medium">Verificações</h2>
            <p className="mt-1 text-xs text-muted-foreground">{artifact.status === "needs_review" ? "Revisão necessária antes do uso." : "Documento em edição."}</p>
            {issues.length === 0 ? <p className="mt-4 text-sm text-subtle-foreground">Nenhuma pendência registrada.</p> : (
              <div className="mt-3 divide-y">
                {issues.map((issue, index) => <p key={index} className="flex gap-2 py-3 text-sm"><CircleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{issueText(issue)}</p>)}
              </div>
            )}
          </section>

          <DocumentVerification artifactId={artifact.id} version={artifact.version} dirty={dirty} />
          <section className="mt-8 border-t pt-5">
            <h2 className="font-medium">Fontes</h2>
            {references.length === 0 ? <p className="mt-3 text-sm text-subtle-foreground">Nenhuma fonte vinculada.</p> : (
              <div className="mt-2 divide-y">
                {references.map((reference, index) => (
                  <div key={reference.id ?? index} className="py-3 text-sm">
                    <p className="font-medium">{reference.sourceLabel ?? reference.label ?? `Fonte ${index + 1}`}</p>
                    {reference.locator && <p className="mt-0.5 text-xs text-muted-foreground">{reference.locator}</p>}
                    {reference.excerpt && <p className="mt-2 line-clamp-4 leading-5 text-muted-foreground">{reference.excerpt}</p>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <Button type="button" variant="ghost" size="icon-sm" onClick={onClick} aria-label={label} title={label}>{children}</Button>;
}
