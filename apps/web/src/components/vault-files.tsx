"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, LoaderCircle, RotateCw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { FileItem } from "@/components/casos/case-items";
import { approveAndRun } from "@/lib/approve-and-run";
import type { VaultDocument } from "@/lib/vault";
import { documentPageSize, fetchVaultDocumentPage } from '@/lib/vault-document-page';
import { MAX_UPLOAD_BYTES, UPLOAD_SIZE_ERROR } from '@/lib/vault-upload-contract';

export function usePolledDocuments(query: string, initial: VaultDocument[], initialTotal: number) {
  const [documents, setDocuments] = useState(initial);
  const [total, setTotal] = useState(initialTotal);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const currentOffset = useRef(0);
  const failedOffset = useRef<number | null>(null);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async (target = currentOffset.current) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    try {
      let result = await fetchVaultDocumentPage(query, target, controller.signal);
      // Deletion can empty the last page. Return to the last page that still contains files.
      const lastOffset = Math.max(0, Math.ceil(result.total / documentPageSize) - 1) * documentPageSize;
      if (target > lastOffset) {
        target = lastOffset;
        result = await fetchVaultDocumentPage(query, target, controller.signal);
      }
      if (controller.signal.aborted) return;
      setDocuments(result.documents);
      setTotal(result.total);
      currentOffset.current = target;
      setOffset(target);
      failedOffset.current = null;
    } catch (error) {
      if (controller.signal.aborted) return;
      failedOffset.current = target;
      setError(error instanceof Error && !(error instanceof TypeError) ? error.message : 'Confira sua conexão e tente novamente.');
    } finally {
      if (!controller.signal.aborted) { request.current = null; setLoading(false); }
    }
  }, [query]);
  const pending = documents.some((document) => document.status === "queued" || document.status === "processing");
  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = pending ? window.setInterval(() => {
      if (document.visibilityState === 'visible' && !request.current) void refresh();
    }, 3_000) : undefined;
    return () => { window.clearTimeout(first); window.clearInterval(timer); request.current?.abort(); };
  }, [pending, refresh]);
  const firstPage = useCallback(() => refresh(0), [refresh]);
  return { documents, setDocuments, refresh, firstPage,
    pagination: { total, offset, loading, error, previous: () => refresh(Math.max(0, offset - documentPageSize)),
      next: () => refresh(offset + documentPageSize), retry: () => refresh(failedOffset.current ?? offset) } };
}

/** Under the files: where the list is, and the way to the next 50 when there are more. */
export function DocumentPagination({ total, offset, loading, error, previous, next, retry }: ReturnType<typeof usePolledDocuments>['pagination']) {
  return <div className="flex flex-col gap-2">
    {error && <div role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-destructive">{error}<Button variant="outline" className="max-md:h-11" onClick={() => void retry()} disabled={loading}>Tentar novamente</Button></div>}
    <nav aria-label="Páginas de arquivos" className="flex flex-wrap items-center justify-between gap-3">
      <p role="status" className="text-[12.5px] text-muted-foreground">{total <= documentPageSize ? '' : loading ? 'Carregando arquivos…' : `${offset + 1}–${Math.min(offset + documentPageSize, total)} de ${total} arquivos`}</p>
      {total > documentPageSize && <div className="flex gap-2">
        <Button variant="ghost" className="max-md:h-11" disabled={loading || offset === 0} onClick={() => void previous()}>Anterior</Button>
        <Button variant="ghost" className="max-md:h-11" disabled={loading || offset + documentPageSize >= total} onClick={() => void next()}>Próxima</Button>
      </div>}
    </nav>
  </div>;
}

export function UploadControl({ scope, caseId, folderId, disabled, onUploaded, onError }: {
  scope: "library" | "case";
  caseId?: string | null;
  folderId?: string | null;
  disabled?: boolean;
  onUploaded: (document: VaultDocument) => void;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  // Which file of the batch is on its way; null when idle.
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  async function sendOne(file: File): Promise<string | null> {
    if (file.size > MAX_UPLOAD_BYTES) return UPLOAD_SIZE_ERROR;
    const headers = new Headers({ 'x-k5-file-name': encodeURIComponent(file.name), 'x-k5-upload-scope': scope });
    if (scope === 'case' && caseId) headers.set('x-k5-upload-caseid', caseId);
    if (folderId) headers.set('x-k5-upload-folderid', folderId);
    try {
      const response = await fetch("/api/vault/documents", { method: "POST", body: file, headers });
      const result = await response.json().catch(() => null) as { error?: string; document?: VaultDocument } | null;
      if (!response.ok || !result?.document) return result?.error ?? "Não foi possível enviar o arquivo.";
      onUploaded(result.document);
      return null;
    } catch {
      return "Não foi possível conectar. Confira sua conexão.";
    }
  }

  // One request per file, in order: each keeps the route's own limits and checks, and every
  // document joins the list as soon as it lands. A failure doesn't stop the rest of the batch.
  async function send(files: File[]) {
    onError("");
    const failed: { name: string; reason: string }[] = [];
    for (const [index, file] of files.entries()) {
      setProgress({ current: index + 1, total: files.length });
      const reason = await sendOne(file);
      if (reason) failed.push({ name: file.name, reason });
    }
    setProgress(null);
    if (failed.length === 1) onError(files.length === 1 ? failed[0].reason : `${failed[0].name}: ${failed[0].reason}`);
    else if (failed.length > 1) onError(`Não foi possível enviar ${failed.length} arquivos: ${failed.map((item) => item.name).join(", ")}.`);
  }

  const busy = progress !== null;

  return (
    <>
      {/* The native file control carries its own font and chrome, so the button is ours. */}
      <input
        ref={input}
        type="file"
        multiple
        aria-label="Arquivos para enviar"
        tabIndex={-1}
        className="sr-only"
        accept=".pdf,.docx,.eml,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) void send(files);
        }}
      />
      <Button type="button" variant="ghost" className="text-muted-foreground max-md:h-11" disabled={busy || disabled} onClick={() => input.current?.click()}>
        {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Upload aria-hidden="true" className="size-3.5" />}
        <span aria-live="polite">{progress ? (progress.total > 1 ? `Enviando ${progress.current} de ${progress.total}…` : "Enviando…") : "Enviar arquivos"}</span>
      </Button>
    </>
  );
}

/** Retrying and deleting a file, for the grids that show files. */
export function documentActions({ onRetried, onDeleted, onError }: {
  onRetried: (documentId: string) => void;
  onDeleted: (documentId: string) => void;
  onError: (message: string) => void;
}) {
  async function retry(documentId: string) {
    onError("");
    try {
      const response = await fetch(`/api/vault/documents/${documentId}/retry`, { method: "POST" });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        onError(result?.error ?? "Não foi possível reenviar o documento.");
        return;
      }
      onRetried(documentId);
    } catch { onError("Não foi possível conectar. Confira sua conexão."); }
  }

  async function remove(documentId: string) {
    onError("");
    const failure = await approveAndRun("k5_vault_delete_document", { documentId }, (approvalId) =>
      fetch(`/api/vault/documents/${documentId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalId }),
      }));
    if (failure) { onError(failure); return; }
    onDeleted(documentId);
  }

  return { retry, remove };
}

/** The files of a page of results as items: a card on a desktop, a row on a phone. */
export function DocumentItems({ documents, onRetried, onDeleted, onError }: {
  documents: VaultDocument[];
  onRetried: (documentId: string) => void;
  onDeleted: (documentId: string) => void;
  onError: (message: string) => void;
}) {
  const { retry, remove } = documentActions({ onRetried, onDeleted, onError });
  return documents.map((document) => (
    <FileItem key={document.id} document={document} onRetry={() => void retry(document.id)} onDelete={() => void remove(document.id)} />
  ));
}

// 44px on touch, compact from md up.
const touchIcon = "size-11 md:size-8";

function stateLabel(document: VaultDocument) {
  if (document.status === "queued") return "Na fila";
  if (document.status === "processing") return `Processando ${document.progress}%`;
  if (document.status === "ready") return "Pronto";
  return document.errorMessage ? `Falhou: ${document.errorMessage}` : "Falhou";
}

/** The file table of the case page, which keeps the Lume workspace's own layout. */
export function DocumentRows({ documents, showOrigin, onRetried, onDeleted, onError, empty }: {
  documents: VaultDocument[];
  showOrigin?: boolean;
  onRetried: (documentId: string) => void;
  onDeleted: (documentId: string) => void;
  onError: (message: string) => void;
  empty: string;
}) {
  const { retry, remove } = documentActions({ onRetried, onDeleted, onError });
  if (!documents.length) return <p className="py-10 text-sm text-subtle-foreground">{empty}</p>;

  const columns = showOrigin ? "md:grid-cols-[minmax(240px,1fr)_150px_120px_130px]" : "md:grid-cols-[minmax(240px,1fr)_120px_130px]";
  return (
    <div>
      <div className={`hidden gap-4 border-b pb-2 text-[13px] text-muted-foreground md:grid ${columns}`}>
        <span>Documento</span>{showOrigin && <span>Destino</span>}<span>Estado</span><span className="text-right">Ações</span>
      </div>
      {documents.map((document) => (
        <div key={document.id} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b py-2 text-sm md:py-3 ${columns}`}>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2"><FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="truncate">{document.name}</span></div>
            <p className={`mt-0.5 truncate pl-6 text-[13px] md:hidden ${document.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
              {showOrigin ? `${document.caseName ?? "Biblioteca"} · ` : ""}{stateLabel(document)}
            </p>
          </div>
          {showOrigin && <span className="hidden truncate text-muted-foreground md:block">{document.caseName ?? "Biblioteca"}</span>}
          <span className={`hidden md:block ${document.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{stateLabel(document)}</span>
          <div className="flex justify-end gap-1">
            <Button asChild variant="ghost" size="icon-sm" className={touchIcon}>
              <a href={`/api/vault/documents/${document.id}/download`} aria-label={`Baixar ${document.name}`}><Download aria-hidden="true" /></a>
            </Button>
            {(document.status === "failed" || document.status === "queued") && (
              <Button type="button" variant="ghost" size="icon-sm" className={touchIcon} onClick={() => void retry(document.id)} aria-label={`Reenviar ${document.name}`}><RotateCw aria-hidden="true" /></Button>
            )}
            <DocumentDelete name={document.name} onConfirm={() => void remove(document.id)} />
          </div>
        </div>
      ))}
    </div>
  );
}

function DocumentDelete({ name, onConfirm }: { name: string; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" className={touchIcon} aria-label={`Excluir ${name}`}><Trash2 aria-hidden="true" /></Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            O arquivo sai do Cofre e da busca, e as versões anteriores vão junto. Não dá para desfazer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>Excluir documento</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
