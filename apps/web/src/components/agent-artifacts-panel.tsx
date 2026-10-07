"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { CircleAlert, Download, FileText, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VaultContextSection, type AgentContext } from "@/components/agent-sources-panel";
import { requestCapability } from "@/lib/capabilities/http-client";
import type { ConversationArtifacts, VaultCopy } from "@/lib/conversation-artifacts";

const LIBRARY = "__library";
const CASE_ROOT = "__root";

type Source = { kind: "document"; id: string; version: number } | { kind: "attachment"; id: string };

async function responseError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

function size(bytes: number) {
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function copyPlace(copy: VaultCopy) {
  return copy.caseName ?? (copy.scope === "library" ? "Biblioteca" : "Caso");
}

function Copies({ copies }: { copies: VaultCopy[] }) {
  if (!copies.length) return null;
  return (
    <ul className="mt-1 grid gap-0.5 text-[13px] text-muted-foreground">
      {copies.map(copy => (
        <li key={copy.documentId} className="min-w-0 truncate">
          No Cofre{copy.format ? ` (${copy.format.toUpperCase()}${copy.version ? `, versão ${copy.version}` : ""})` : ""}:{" "}
          <Link href={copy.href} className="underline underline-offset-2 hover:text-foreground">{copyPlace(copy)}</Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Where a document or an attachment goes in the Vault. The cases and folders come from the
 * person's own access; the server checks the destination again before copying.
 */
function SaveForm({ conversationId, source, onSaved, onCancel }: {
  conversationId: string;
  source: Source;
  onSaved: (copy: { name: string; href: string; place: string }) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [format, setFormat] = useState<"pdf" | "docx">("pdf");
  const [target, setTarget] = useState(LIBRARY);
  const [folder, setFolder] = useState(CASE_ROOT);
  const [cases, setCases] = useState<Array<{ id: string; name: string }> | null>(null);
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([]);
  const [loadError, setLoadError] = useState("");
  const [foldersError, setFoldersError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/vault/cases", { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error(await responseError(response, "Não foi possível carregar os casos."));
        setCases(((await response.json()) as { cases: Array<{ id: string; name: string }> }).cases);
      })
      .catch(cause => { if (!controller.signal.aborted) { setCases([]); setLoadError(cause instanceof Error ? cause.message : "Não foi possível carregar os casos."); } });
    return () => controller.abort();
  }, []);

  function chooseTarget(value: string) {
    setTarget(value);
    setFolder(CASE_ROOT);
    setFolders([]);
    setFoldersError("");
  }

  useEffect(() => {
    if (target === LIBRARY) return;
    let live = true;
    void requestCapability("k5_vault_list_folders", { caseId: target }).then(result => {
      if (!live) return;
      if (result.ok) setFolders((result.data as { folders: Array<{ id: string; name: string }> }).folders);
      else setFoldersError(result.error);
    });
    return () => { live = false; };
  }, [target]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const destination = target === LIBRARY ? { scope: "library" } : { scope: "case", caseId: target, folderId: folder === CASE_ROOT ? null : folder };
      const body = source.kind === "document" ? { source: "document", id: source.id, version: source.version, format, ...destination } : { source: "attachment", id: source.id, ...destination };
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/artifacts`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await responseError(response, "Não foi possível salvar no Cofre."));
      const { document } = (await response.json()) as { document: { name: string; caseId: string | null; caseName: string | null; folderId: string | null } };
      const href = document.caseId ? `/app/vault/cases/${encodeURIComponent(document.caseId)}${document.folderId ? `?folder=${encodeURIComponent(document.folderId)}` : ""}` : "/app/vault/library";
      onSaved({ name: document.name, href, place: document.caseName ?? "Biblioteca" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar no Cofre.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="mt-3 grid min-w-0 gap-3 border-l-2 border-brand pl-3" onSubmit={event => { event.preventDefault(); void save(); }}>
      {source.kind === "document" && (
        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-sm">Formato</legend>
          <div className="flex gap-4 text-sm">
            {(["pdf", "docx"] as const).map(value => (
              <label key={value} className="flex min-h-11 items-center gap-2 md:min-h-8">
                <input type="radio" name={`${id}-format`} value={value} checked={format === value} onChange={() => setFormat(value)} className="size-4 accent-foreground" />
                {value.toUpperCase()}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={`${id}-target`}>Destino</Label>
        <Select value={target} onValueChange={chooseTarget} disabled={cases === null}>
          <SelectTrigger id={`${id}-target`} className="w-full max-w-full overflow-hidden [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate">
            <SelectValue placeholder={cases === null ? "Carregando casos…" : undefined} />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={LIBRARY}>Biblioteca</SelectItem>
            {(cases ?? []).map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {loadError && <p className="text-[13px] text-destructive" role="alert">{loadError} A Biblioteca continua disponível.</p>}
      </div>
      {target !== LIBRARY && folders.length > 0 && (
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-folder`}>Pasta</Label>
          <Select value={folder} onValueChange={setFolder}>
            <SelectTrigger id={`${id}-folder`} className="w-full max-w-full overflow-hidden [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate"><SelectValue /></SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value={CASE_ROOT}>Raiz do caso</SelectItem>
              {folders.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {target !== LIBRARY && foldersError && <p className="text-[13px] text-destructive" role="alert">{foldersError} O documento pode ser salvo na raiz do caso.</p>}
      {error && <p className="flex gap-2 text-sm text-destructive" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving || cases === null}>{saving ? "Salvando…" : error ? "Tentar de novo" : "Salvar"}</Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancelar</Button>
      </div>
    </form>
  );
}

function ArtifactRow({ icon, title, detail, copies, actions, saving, conversationId, source, onSaved, onOpenSave, onCloseSave }: {
  icon: React.ReactNode; title: React.ReactNode; detail: string; copies: VaultCopy[]; actions?: React.ReactNode;
  saving: boolean; conversationId: string; source: Source;
  onSaved: (copy: { name: string; href: string; place: string }) => void; onOpenSave: () => void; onCloseSave: () => void;
}) {
  return (
    <li className="min-w-0 border-b py-3 last:border-b-0">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="min-w-0 truncate text-sm">{title}</div>
          <p className="truncate text-[13px] text-subtle-foreground">{detail}</p>
          <Copies copies={copies} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {!saving && <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={onOpenSave}>Salvar no Cofre</Button>}
        </div>
      </div>
      {saving && <SaveForm conversationId={conversationId} source={source} onSaved={onSaved} onCancel={onCloseSave} />}
    </li>
  );
}

/**
 * Everything the Lume created or received in this conversation — its documents and the files sent
 * in the messages — with their Vault copies, plus the Vault material selected as context.
 */
export function AgentArtifactsPanel({ conversationId, context, onChange, onOpenDocument, onClose, lockedCase = false }: {
  conversationId: string | null;
  context: AgentContext;
  onChange: (context: AgentContext) => void;
  onOpenDocument: (id: string) => void;
  onClose: () => void;
  lockedCase?: boolean;
}) {
  const [artifacts, setArtifacts] = useState<ConversationArtifacts | null>(null);
  const [loading, setLoading] = useState(Boolean(conversationId));
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ name: string; href: string; place: string } | null>(null);

  // Bumped to read the list again: after a save, or when the person retries a failed load.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!conversationId) return;
    const controller = new AbortController();
    fetch(`/api/conversations/${encodeURIComponent(conversationId)}/artifacts`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error(await responseError(response, "Não foi possível carregar os artefatos."));
        setArtifacts((await response.json()) as ConversationArtifacts);
        setLoadError("");
      })
      .catch(cause => { if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : "Não foi possível carregar os artefatos."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [conversationId, generation]);

  function reload() {
    setLoading(true);
    setLoadError("");
    setGeneration(value => value + 1);
  }

  function done(copy: { name: string; href: string; place: string }) {
    setSaving(null);
    setSaved(copy);
    reload();
  }

  const empty = artifacts && !artifacts.documents.length && !artifacts.attachments.length;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
        {/* The sheet's own title names the dialog for assistive technology; this is its visible twin. */}
        <p aria-hidden="true" className="text-base font-medium">Artefatos desta conversa</p>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar artefatos"><X /></Button>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-5 [&>*]:min-w-0">
        <div aria-live="polite">
          {saved && (
            <p className="mb-4 border-l-2 border-brand pl-3 text-sm">
              {saved.name} foi salvo em {saved.place}. <Link href={saved.href} className="underline underline-offset-2">Abrir no Cofre</Link>
            </p>
          )}
        </div>
        {!conversationId && <p className="text-sm text-subtle-foreground">Comece uma conversa para ver o que o Lume criar e os arquivos que você enviar.</p>}
        {loading && !artifacts && <p role="status" className="text-sm text-muted-foreground">Carregando artefatos…</p>}
        {loadError && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-destructive" role="alert">
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />{loadError}
            <Button variant="outline" size="sm" onClick={reload}>Tentar de novo</Button>
          </p>
        )}
        {empty && <p className="text-sm text-subtle-foreground">Nada criado ou enviado nesta conversa ainda. Documentos do Lume e anexos aparecem aqui.</p>}

        {conversationId && artifacts && artifacts.documents.length > 0 && (
          <section aria-labelledby="artifacts-documents" className="mb-6">
            <h3 id="artifacts-documents" className="text-sm font-medium">Documentos do Lume</h3>
            <ul>
              {artifacts.documents.map(document => (
                <ArtifactRow key={document.id} icon={<FileText className="size-4" />}
                  title={<button type="button" className="max-w-full truncate text-left underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpenDocument(document.id)}>{document.title || "Documento sem título"}</button>}
                  detail={`Versão ${document.version}`} copies={document.copies}
                  saving={saving === document.id} conversationId={conversationId} source={{ kind: "document", id: document.id, version: document.version }}
                  onSaved={done} onOpenSave={() => { setSaved(null); setSaving(document.id); }} onCloseSave={() => setSaving(null)} />
              ))}
            </ul>
          </section>
        )}

        {conversationId && artifacts && artifacts.attachments.length > 0 && (
          <section aria-labelledby="artifacts-attachments" className="mb-6">
            <h3 id="artifacts-attachments" className="text-sm font-medium">Anexos enviados</h3>
            <ul>
              {artifacts.attachments.map(attachment => (
                <ArtifactRow key={attachment.id} icon={<Paperclip className="size-4" />} title={attachment.name}
                  detail={size(attachment.byteSize)} copies={attachment.copies}
                  actions={<Button asChild variant="ghost" size="icon-sm" className="size-11 md:size-8"><a href={attachment.url} target="_blank" rel="noreferrer" aria-label={`Abrir ${attachment.name}`}><Download /></a></Button>}
                  saving={saving === attachment.id} conversationId={conversationId} source={{ kind: "attachment", id: attachment.id }}
                  onSaved={done} onOpenSave={() => { setSaved(null); setSaving(attachment.id); }} onCloseSave={() => setSaving(null)} />
              ))}
            </ul>
          </section>
        )}

        <VaultContextSection key={context.caseId ?? 'office'} context={context} onChange={onChange} lockedCase={lockedCase} />
      </div>
    </div>
  );
}
