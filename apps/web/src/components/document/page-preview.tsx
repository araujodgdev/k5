"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

/**
 * The Word file as it will be exported, letterhead included: the server builds the DOCX through
 * the same path as Exportar, and docx-preview draws its pages. Read-only by design; editing
 * happens in Editar, where the text is the source of truth.
 */
export function PagePreview({ artifactId, version }: { artifactId: string; version: number }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();
    async function render() {
      setState("loading");
      try {
        const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/export`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("export");
        const blob = await response.blob();
        const { renderAsync } = await import("docx-preview");
        const target = pagesRef.current;
        if (!target || controller.signal.aborted) return;
        target.replaceChildren();
        await renderAsync(blob, target, target, {
          inWrapper: true, breakPages: true, renderHeaders: true, renderFooters: true,
          renderFootnotes: false, renderEndnotes: false, renderComments: false, useBase64URL: true,
          className: "docx",
        });
        fit();
        if (!controller.signal.aborted) setState("ready");
      } catch {
        if (!controller.signal.aborted) setState("error");
      }
    }
    void render();
    return () => controller.abort();
  }, [artifactId, version]);

  // Pages keep their real size and are scaled down to the panel, so line breaks match Word.
  function fit() {
    const frame = frameRef.current, pages = pagesRef.current;
    const page = pages?.querySelector<HTMLElement>("section.docx");
    if (!frame || !pages || !page) return;
    pages.style.zoom = "1"; // measure the page at its real size
    const available = frame.clientWidth - 32;
    const scale = Math.min(1, available / page.offsetWidth);
    pages.style.zoom = String(scale);
  }
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={frameRef} className="document-pages relative min-h-0 flex-1 overflow-auto bg-muted px-4 py-6">
      {state === "loading" && <p role="status" className="absolute inset-x-0 top-6 flex items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Montando as páginas…</p>}
      {state === "error" && <p role="alert" className="py-10 text-center text-sm text-destructive">Não foi possível montar a pré-visualização. Exporte o DOCX para conferir.</p>}
      <div ref={pagesRef} aria-label="Pré-visualização das páginas" className={state === "ready" ? "" : "invisible"} />
    </div>
  );
}
