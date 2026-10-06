"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AiConnectionView } from "@/lib/ai-connections-core";
import { providerLabels, type AiProvider } from "@/lib/ai-provider-names";
// 44px controls on touch, default height from md up.
const touch = "h-11 md:h-9";

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
  return <div className="grid gap-5">
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-1.5"><Label htmlFor={`${id}-name`}>Nome</Label><Input id={`${id}-name`} className={touch} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Produção principal" required minLength={2} maxLength={80} /></div>
      <div className="grid gap-1.5"><Label htmlFor={`${id}-provider`}>Provider</Label><Select value={draft.provider} onValueChange={(value) => setDraft({ ...draft, provider: value as AiProvider })}><SelectTrigger id={`${id}-provider`} className="w-full" aria-describedby={draft.provider === "cliproxyapi" ? `${id}-proxy` : undefined}><SelectValue /></SelectTrigger><SelectContent position="popper">{Object.entries(providerLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
    </div>
    {draft.provider === "cliproxyapi" && <p id={`${id}-proxy`} className="text-muted-foreground text-sm">O CLIProxyAPI responde pelo endereço fixo do Lume, api.lume.software. A conexão só atende as tarefas em que você escolhê-la em Modelos por tarefa. Ele não oferece transcrição nem embeddings.</p>}
    <div className="grid gap-1.5"><Label htmlFor={`${id}-key`}>{requireKey ? "Chave da API" : "Nova chave da API"}</Label><Input id={`${id}-key`} className={touch} type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={requireKey ? "Cole a chave" : keyHint ? `Atual: ${keyHint}. Deixe em branco para manter.` : "Deixe em branco para manter"} required={requireKey} autoComplete="new-password" /></div>
    <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-0"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} className="size-4 accent-foreground" />Conexão ativa</label>
    {!draft.enabled && serves.length > 0 && <p className="flex items-start gap-2 text-destructive text-sm"><CircleAlert className="mt-0.5 size-4 shrink-0" />Ao salvar desativada, param de responder: {serves.join(", ")}. Elas não passam para outra conexão sozinhas.</p>}
  </div>;
}

function ErrorText({ message }: { message: string }) { return <p className="flex items-start gap-2 text-destructive text-sm" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" />{message}</p>; }

function ExistingConnection({ connection, serves }: { connection: AiConnectionView; serves: string[] }) {
  const router = useRouter();
  const noteId = useId();
  const [draft, setDraft] = useState(() => fromConnection(connection));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const base = `/api/platform/ai/connections/${connection.id}`;
  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label); setError(""); setNotice("");
    try { await action(); setNotice(label === "test" ? "Conexão validada." : "Alterações salvas."); if (label !== "test") router.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível concluir a operação."); }
    finally { setBusy(null); }
  }
  // Tests use the saved credential with the model of a task it serves, or the provider default.
  return <article className="border-t py-7 first:border-t-0">
    <div className="mb-5 flex items-start justify-between gap-4"><div className="min-w-0"><h4 className="break-words font-medium">{connection.name}</h4><p className="mt-1 text-muted-foreground text-xs">{providerLabels[connection.provider]} · {connection.keyHint}</p><p className="mt-1 text-subtle-foreground text-xs">{serves.length ? `Atende: ${serves.join(", ")}.` : "Não atende nenhuma tarefa diretamente."}</p></div><span className="shrink-0 text-muted-foreground text-xs">{connection.enabled ? "Ativa" : "Desativada"}</span></div>
    <Fields draft={draft} setDraft={setDraft} keyHint={connection.keyHint} serves={serves}
      requireKey={draft.provider !== connection.provider && (draft.provider === "cliproxyapi" || connection.provider === "cliproxyapi")} />
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <Button type="button" className={touch} disabled={Boolean(busy)} onClick={() => run("save", () => api(base, "PATCH", { ...draft, apiKey: draft.apiKey || undefined }))}>{busy === "save" && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}Salvar alterações</Button>
      <Button type="button" variant="outline" className={touch} aria-describedby={noteId} disabled={Boolean(busy) || !connection.enabled} title={!connection.enabled ? "Ative e salve a conexão antes de testar." : undefined} onClick={() => run("test", () => api(`${base}/test`, "POST", {}))}>{busy === "test" && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}Testar conexão</Button>
      <AlertDialog>
        <AlertDialogTrigger asChild><Button type="button" variant="ghost" className={`${touch} text-destructive`} disabled={Boolean(busy)}>{busy === "delete" && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}Excluir</Button></AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Excluir {connection.name}?</AlertDialogTitle><AlertDialogDescription>A credencial armazenada será apagada. A chave continua válida no provider até ser revogada lá.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel className={touch}>Cancelar</AlertDialogCancel><AlertDialogAction className={touch} onClick={() => void run("delete", () => api(base, "DELETE"))}>Excluir conexão</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {busy && <span className="text-muted-foreground text-xs" role="status">Processando…</span>}{notice && <span className="text-muted-foreground text-xs" role="status">{notice}</span>}
    </div>
    <p id={noteId} className="mt-3 text-subtle-foreground text-xs">O teste envia uma requisição mínima ao provider, sem documentos do cliente, e pode gerar uma pequena cobrança.</p>
    {error && <div className="mt-3"><ErrorText message={error} /></div>}
  </article>;
}

/** The platform's AI connections: one set of credentials for every office. */
export function PlatformConnections({ initialConnections, usage }: {
  initialConnections: AiConnectionView[];
  /** Group and task names each connection serves directly. */
  usage: Record<string, string[]>;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await api("/api/platform/ai/connections", "POST", draft);
      setDraft(emptyDraft()); setCreating(false); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível criar a conexão."); }
    finally { setBusy(false); }
  }
  return <div>
    <h3 className="mt-8 font-medium">Conexões</h3>
    <p className="mt-1 text-muted-foreground text-sm">As conexões guardam as credenciais dos provedores. O modelo de embedding acompanha o índice de busca.</p>
    <div className="mt-4 flex items-center justify-between gap-4 border-b pb-4"><p className="text-muted-foreground text-sm">{initialConnections.length === 1 ? "1 conexão cadastrada" : `${initialConnections.length} conexões cadastradas`}</p><Button className={touch} aria-expanded={creating} onClick={() => { setCreating((value) => !value); setError(""); }} variant={creating ? "outline" : "default"}>{creating ? "Cancelar" : "Nova conexão"}</Button></div>
    {creating && <form onSubmit={create} className="border-b py-7"><h4 className="mb-5 font-medium">Nova conexão</h4><Fields draft={draft} setDraft={setDraft} requireKey /><div className="mt-5 flex items-center gap-3"><Button type="submit" className={touch} disabled={busy}>{busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}Criar conexão</Button>{busy && <span className="text-muted-foreground text-xs" role="status">Criando…</span>}</div>{error && <div className="mt-3"><ErrorText message={error} /></div>}</form>}
    <div>{initialConnections.map((connection) => <ExistingConnection key={`${connection.id}:${connection.updatedAt}`} connection={connection} serves={usage[connection.id] ?? []} />)}</div>
    {!creating && initialConnections.length === 0 && <p className="py-12 text-subtle-foreground">Nenhuma conexão configurada. Cadastre a primeira para liberar o Lume em todos os escritórios.</p>}
  </div>;
}
