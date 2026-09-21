"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, LoaderCircle, RotateCw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { approveAndRun } from "@/lib/approve-and-run";
import type { VaultDocument } from "@/lib/vault";

// 44px on touch, compact from md up.
export const touchIcon = "size-11 md:size-8";

export function stateLabel(document: VaultDocument) {
  if (document.status === "queued") return "Na fila";
  if (document.status === "processing") return `Processando ${document.progress}%`;
  if (document.status === "ready") return "Pronto";
  return document.errorMessage ? `Falhou: ${document.errorMessage}` : "Falhou";
}

/**
 * Keeps a list fresh while anything in it is still being extracted, and stops polling the moment
 * nothing is pending. The query is whatever the calling view is showing.
 */
export function usePolledDocuments(query: string, initial: VaultDocument[]) {
  const [documents, setDocuments] = useState(initial);
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/vault/documents?${query}`, { cache: "no-store" });
    if (response.ok) setDocuments((await response.json() as { documents: VaultDocument[] }).documents);
  }, [query]);
  const pending = documents.some((document) => document.status === "queued" || document.status === "processing");
  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = pending ? window.setInterval(() => void refresh(), 3_000) : undefined;
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [pending, refresh]);
  return { documents, setDocuments, refresh };
}

export function UploadControl({ canWrite, scope, caseId, folderId, disabled, onUploaded, onError }: {
  canWrite: boolean;
  scope: "library" | "case";
  caseId?: string | null;
  folderId?: string | null;
  disabled?: boolean;
  onUploaded: (document: VaultDocument) => void;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  if (!canWrite) return null;

  async function send(file: File) {
    setBusy(true);
    onError("");
    const body = new FormData();
    body.set("file", file);
    body.set("scope", scope);
    if (scope === "case" && caseId) body.set("caseId", caseId);
    if (folderId) body.set("folderId", folderId);
    const response = await fetch("/api/vault/documents", { method: "POST", body });
    const result = await response.json().catch(() => null) as { error?: string; document?: VaultDocument } | null;
    setBusy(false);
    if (!response.ok || !result?.document) { onError(result?.error ?? "Não foi possível enviar o arquivo."); return; }
    onUploaded(result.document);
  }

  return (
    <>
      {/* The native file control carries its own font and chrome, so the button is ours. */}
      <input
        ref={input}
        type="file"
        className="sr-only"
        accept=".pdf,.docx,.eml,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void send(file);
        }}
      />
      <Button type="button" variant="outline" disabled={busy || disabled} onClick={() => input.current?.click()}>
        {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Upload aria-hidden="true" />}Enviar arquivo
      </Button>
    </>
  );
}

export function DocumentRows({ documents, canWrite, showOrigin, onRetried, onDeleted, onError, empty }: {
  documents: VaultDocument[];
  canWrite: boolean;
  showOrigin?: boolean;
  onRetried: (documentId: string) => void;
  onDeleted: (documentId: string) => void;
  onError: (message: string) => void;
  empty: string;
}) {
  async function retry(documentId: string) {
    onError("");
    const response = await fetch(`/api/vault/documents/${documentId}/retry`, { method: "POST" });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      onError(result?.error ?? "Não foi possível reenviar o documento.");
      return;
    }
    onRetried(documentId);
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
            {(document.status === "failed" || document.status === "queued") && canWrite && (
              <Button type="button" variant="ghost" size="icon-sm" className={touchIcon} onClick={() => void retry(document.id)} aria-label={`Reenviar ${document.name}`}><RotateCw aria-hidden="true" /></Button>
            )}
            {canWrite && <DocumentDelete name={document.name} onConfirm={() => void remove(document.id)} />}
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
