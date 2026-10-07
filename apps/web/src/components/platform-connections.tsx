"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, Pill } from "@/components/canvas/canvas-controls";
import { AdminBlock, AdminBlockHead, adminButton, adminQuietAction } from "@/components/admin/admin-blocks";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AiConnectionView } from "@/lib/ai-connections-core";
import { providerLabels, type AiProvider } from "@/lib/ai-provider-names";
// 44px controls on touch, the canvas input height from md up.
const touch = "h-11 md:h-9";
const fieldLabel = "text-xs font-normal text-muted-foreground";

type Draft = { name: string; provider: AiProvider; apiKey: string; enabled: boolean };
const emptyDraft = (): Draft => ({ name: "", provider: "openai", apiKey: "", enabled: true });
const fromConnection = (item: AiConnectionView): Draft => ({ name: item.name, provider: item.provider, apiKey: "", enabled: item.enabled });

async function api(url: string, method: string, body?: object) {
  const response = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? "Não foi possível concluir a operação.");
  return payload;
}

/**
 * A connection is a provider and a credential. Models are assigned per task above this list;
 * the embedding model remains pinned to an index generation.
 */
function Fields({ draft, setDraft, requireKey, keyHint, serves = [] }: { draft: Draft; setDraft: (draft: Draft) => void; requireKey?: boolean; keyHint?: string; serves?: string[] }) {
  const id = useId();
  return <div className="grid gap-3.5">
    <div className="grid gap-3.5 sm:grid-cols-2">
      <div className="grid gap-1.5"><Label className={fieldLabel} htmlFor={`${id}-name`}>Nome</Label><Input id={`${id}-name`} className={touch} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Produção principal" required minLength={2} maxLength={80} /></div>
      <div className="grid gap-1.5"><Label className={fieldLabel} htmlFor={`${id}-provider`}>Provider</Label><Select value={draft.provider} onValueChange={(value) => setDraft({ ...draft, provider: value as AiProvider })}><SelectTrigger id={`${id}-provider`} className="w-full" aria-describedby={draft.provider === "cliproxyapi" ? `${id}-proxy` : undefined}><SelectValue /></SelectTrigger><SelectContent position="popper">{Object.entries(providerLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
    </div>
    {draft.provider === "cliproxyapi" && <p id={`${id}-proxy`} className="text-[12.5px] text-muted-foreground">O CLIProxyAPI responde pelo endereço fixo do Lume, api.lume.software. A conexão só atende as tarefas em que você escolhê-la em Modelos por tarefa. Ele não oferece transcrição nem embeddings.</p>}
    <div className="grid gap-1.5"><Label className={fieldLabel} htmlFor={`${id}-key`}>{requireKey ? "Chave da API" : "Nova chave da API"}</Label><Input id={`${id}-key`} className={touch} type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={requireKey ? "Cole a chave" : keyHint ? `Atual: ${keyHint}. Deixe em branco para manter.` : "Deixe em branco para manter"} required={requireKey} autoComplete="new-password" /></div>
    <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-0"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} className="size-4 accent-foreground" />Conexão ativa</label>
    {!draft.enabled && serves.length > 0 && <p className="flex items-start gap-2 text-destructive text-sm"><CircleAlert className="mt-0.5 size-4 shrink-0" />Ao salvar desativada, param de responder: {serves.join(", ")}. Elas não passam para outra conexão sozinhas.</p>}
  </div>;
}

function ErrorText({ message }: { message: string }) { return <p className="flex items-start gap-2 text-[13.5px] text-destructive" role="alert"><CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{message}</p>; }


type Notice = { tone: "status" | "alert"; text: string };

function NoticeLine({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return notice.tone === "status" ? <p role="status" className="text-[12.5px] text-muted-foreground">{notice.text}</p> : <ErrorText message={notice.text} />;
}

/** One connection opened from the table: its fields, saving and deleting. */
function EditConnection({ connection, serves, onDone }: { connection: AiConnectionView; serves: string[]; onDone: (notice: Notice) => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState(() => fromConnection(connection));
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState("");
  const base = `/api/platform/ai/connections/${connection.id}`;
  async function run(kind: "save" | "delete", action: () => Promise<unknown>, done: string) {
    setBusy(kind); setError("");
    try { await action(); router.refresh(); onDone({ tone: "status", text: done }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível concluir a operação."); }
    finally { setBusy(null); }
  }
  function save(event: React.FormEvent) {
    event.preventDefault();
    void run("save", () => api(base, "PATCH", { ...draft, apiKey: draft.apiKey || undefined }), `${draft.name}: alterações salvas.`);
  }
  return <form className="grid gap-[18px]" onSubmit={save}>
    <DialogHeader>
      <DialogTitle>{connection.name}</DialogTitle>
      <DialogDescription>{providerLabels[connection.provider]} · {connection.keyHint} · {serves.length ? `Atende: ${serves.join(", ")}.` : "Não atende nenhuma tarefa diretamente."}</DialogDescription>
    </DialogHeader>
    <fieldset disabled={Boolean(busy)} className="contents">
      <Fields draft={draft} setDraft={setDraft} keyHint={connection.keyHint} serves={serves}
        requireKey={draft.provider !== connection.provider && (draft.provider === "cliproxyapi" || connection.provider === "cliproxyapi")} />
    </fieldset>
    {error && <ErrorText message={error} />}
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" className={adminButton} disabled={Boolean(busy)}>{busy === "save" && <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}Salvar alterações</Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="ghost" className={`${adminButton} text-destructive`} disabled={Boolean(busy)}>
            {busy === "delete" && <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}Excluir
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {connection.name}?</AlertDialogTitle>
            <AlertDialogDescription>A credencial armazenada será apagada. A chave continua válida no provider até ser revogada lá.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={touch}>Cancelar</AlertDialogCancel>
            <AlertDialogAction className={touch} onClick={() => void run("delete", () => api(base, "DELETE"), `${connection.name} excluída.`)}>Excluir conexão</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {busy && <span role="status" className="text-xs text-muted-foreground">Processando…</span>}
    </div>
  </form>;
}

function NewConnection({ onDone }: { onDone: (notice: Notice) => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api("/api/platform/ai/connections", "POST", draft); router.refresh(); onDone({ tone: "status", text: `${draft.name}: conexão criada.` }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível criar a conexão."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={create} className="grid gap-[18px]">
    <DialogHeader>
      <DialogTitle>Nova conexão</DialogTitle>
      <DialogDescription>As conexões guardam as credenciais dos provedores. O modelo de embedding acompanha o índice de busca.</DialogDescription>
    </DialogHeader>
    <fieldset disabled={busy} className="contents"><Fields draft={draft} setDraft={setDraft} requireKey /></fieldset>
    {error && <ErrorText message={error} />}
    <div className="flex items-center gap-3">
      <Button type="submit" className={adminButton} disabled={busy}>{busy && <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}Criar conexão</Button>
      {busy && <span role="status" className="text-xs text-muted-foreground">Criando…</span>}
    </div>
  </form>;
}

/** The platform's AI connections: one set of credentials for every office. */
export function PlatformConnections({ initialConnections, usage }: {
  initialConnections: AiConnectionView[];
  /** Group and task names each connection serves directly. */
  usage: Record<string, string[]>;
}) {
  // "new", a connection's id, or nothing open.
  const [open, setOpen] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const editing = initialConnections.find(connection => connection.id === open);
  const done = (next: Notice) => { setOpen(null); setNotice(next); };
  const show = (target: string) => { setNotice(null); setOpen(target); };
  // Tests use the saved credential with the model of a task it serves, or the provider default.
  async function test(connection: AiConnectionView) {
    setTesting(connection.id); setNotice(null);
    try { await api(`/api/platform/ai/connections/${connection.id}/test`, "POST", {}); setNotice({ tone: "status", text: `${connection.name}: conexão validada.` }); }
    catch (cause) { setNotice({ tone: "alert", text: `${connection.name}: ${cause instanceof Error ? cause.message : "o teste falhou."}` }); }
    finally { setTesting(null); }
  }
  return <AdminBlock labelledBy="connections-title">
    <AdminBlockHead id="connections-title" title="Conexões" actions={<Button variant="outline" className={adminButton} onClick={() => show("new")}>Nova conexão</Button>} />
    <DataTable label="Conexões" rows={initialConnections} rowKey={connection => `${connection.id}:${connection.updatedAt}`}
      empty="Nenhuma conexão configurada. Cadastre a primeira para liberar o Lume em todos os escritórios." columns={[
        { header: "Nome", width: "minmax(0, 1fr)", strong: true, cell: connection => connection.name },
        { header: "Provider", width: "150px", cell: connection => providerLabels[connection.provider] },
        { header: "Situação", width: "96px", cell: connection => <Pill>{connection.enabled ? "Ativa" : "Inativa"}</Pill> },
        { header: "", width: "150px", align: "end", cell: connection => (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <button type="button" className={adminQuietAction} aria-label={`Testar ${connection.name}`} disabled={Boolean(testing) || !connection.enabled}
              title={connection.enabled ? undefined : "Ative e salve a conexão antes de testar."} onClick={() => void test(connection)}>
              {testing === connection.id ? "Testando…" : "Testar conexão"}
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" className={adminQuietAction} aria-label={`Editar ${connection.name}`} onClick={() => show(connection.id)}>Editar</button>
          </span>
        ) },
      ]} />
    <NoticeLine notice={notice} />
    <p className="text-[12.5px] text-muted-foreground">O teste envia uma requisição mínima ao provider, sem documentos do cliente, e pode gerar uma pequena cobrança.</p>
    <Dialog open={open !== null} onOpenChange={next => { if (!next) setOpen(null); }}>
      {open !== null && <DialogContent>
        {editing
          ? <EditConnection key={`${editing.id}:${editing.updatedAt}`} connection={editing} serves={usage[editing.id] ?? []} onDone={done} />
          : <NewConnection onDone={done} />}
      </DialogContent>}
    </Dialog>
  </AdminBlock>;
}
