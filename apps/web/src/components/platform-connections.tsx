"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ModelPicker } from "@/components/model-picker";
import type { AiConnectionView, AiProvider, AiTask } from "@/lib/ai-connections-core";

type Catalog = Record<AiProvider, string[]>;

const providerNames: Record<AiProvider, string> = { openai: "OpenAI", anthropic: "Anthropic", google: "Google", deepseek: "DeepSeek", inception: "Inception", openrouter: "OpenRouter", vercel: "AI Gateway" };
const tasks: Array<{ id: AiTask; label: string }> = [
  { id: "chat", label: "Conversa" }, { id: "extraction", label: "Extração" }, { id: "drafting", label: "Redação" },
  // Embedding is configured here so an office can choose its index model deliberately, instead of
  // inheriting whichever model happens to serve chat.
  { id: "embedding", label: "Embedding" },
];
// 44px controls on touch, default height from md up.
const touch = "h-11 md:h-9";

type Draft = { name: string; provider: AiProvider; apiKey: string; enabled: boolean; models: Record<AiTask, string> };
const emptyDraft = (): Draft => ({ name: "", provider: "openai", apiKey: "", enabled: true, models: { chat: "", extraction: "", drafting: "", embedding: "" } });
const fromConnection = (item: AiConnectionView): Draft => ({ name: item.name, provider: item.provider, apiKey: "", enabled: item.enabled, models: { chat: item.models.chat ?? "", extraction: item.models.extraction ?? "", drafting: item.models.drafting ?? "", embedding: item.models.embedding ?? "" } });
const modelsOf = (draft: Draft) => Object.fromEntries(Object.entries(draft.models).map(([key, value]) => [key, value.trim() || null]));

async function api(url: string, method: string, body?: object) {
  const response = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? "Não foi possível concluir a operação.");
  return payload;
}

function Fields({ draft, setDraft, catalog, requireKey, keyHint }: { draft: Draft; setDraft: (draft: Draft) => void; catalog: Catalog; requireKey?: boolean; keyHint?: string }) {
  const id = useId();
  return <div className="grid gap-5">
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-1.5"><Label htmlFor={`${id}-name`}>Nome</Label><Input id={`${id}-name`} className={touch} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Produção principal" required minLength={2} maxLength={80} /></div>
      <div className="grid gap-1.5"><Label htmlFor={`${id}-provider`}>Provider</Label><Select value={draft.provider} onValueChange={(value) => setDraft({ ...draft, provider: value as AiProvider })}><SelectTrigger id={`${id}-provider`} className="w-full"><SelectValue /></SelectTrigger><SelectContent position="popper">{Object.entries(providerNames).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
    </div>
    <div className="grid gap-1.5"><Label htmlFor={`${id}-key`}>{requireKey ? "Chave da API" : "Nova chave da API"}</Label><Input id={`${id}-key`} className={touch} type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={requireKey ? "Cole a chave" : keyHint ? `Atual: ${keyHint}. Deixe em branco para manter.` : "Deixe em branco para manter"} required={requireKey} autoComplete="new-password" /></div>
    <fieldset className="grid gap-3">
      <legend className="mb-3 text-muted-foreground text-[13px]">Modelos por tarefa</legend>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{tasks.map((task) => <div className="grid gap-1.5" key={task.id}><Label htmlFor={`${id}-${task.id}`}>{task.label}</Label><ModelPicker id={`${id}-${task.id}`} value={draft.models[task.id]} models={catalog[draft.provider] ?? []} onChange={(value) => setDraft({ ...draft, models: { ...draft.models, [task.id]: value } })} /></div>)}</div>
    </fieldset>
    <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-0"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} className="size-4 accent-foreground" />Conexão ativa</label>
  </div>;
}

function ErrorText({ message }: { message: string }) { return <p className="flex items-start gap-2 text-destructive text-sm" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" />{message}</p>; }

function ExistingConnection({ officeId, connection, catalog }: { officeId: string; connection: AiConnectionView; catalog: Catalog }) {
  const router = useRouter();
  const noteId = useId();
  const [draft, setDraft] = useState(() => fromConnection(connection));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const base = `/api/platform/offices/${officeId}/connections/${connection.id}`;
  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label); setError(""); setNotice("");
    try { await action(); setNotice(label === "test" ? "Conexão validada." : "Alterações salvas."); if (label !== "test") router.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível concluir a operação."); }
    finally { setBusy(null); }
  }
  // Tests use the saved configuration; unsaved edits are not sent to the provider.
  const savedTask = tasks.find((task) => connection.models[task.id]);
  const assigned = tasks.some((task) => draft.models[task.id].trim());
  return <article className="border-t py-7 first:border-t-0">
    <div className="mb-5 flex items-start justify-between gap-4"><div className="min-w-0"><h2 className="break-words font-medium">{connection.name}</h2><p className="mt-1 text-muted-foreground text-xs">{providerNames[connection.provider]} · {connection.keyHint}</p></div><span className="shrink-0 text-muted-foreground text-xs">{connection.enabled ? "Ativa" : "Desativada"}</span></div>
    <Fields draft={draft} setDraft={setDraft} catalog={catalog} keyHint={connection.keyHint} />
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <Button type="button" className={touch} disabled={Boolean(busy)} onClick={() => run("save", () => api(base, "PATCH", { ...draft, apiKey: draft.apiKey || undefined, models: modelsOf(draft) }))}>{busy === "save" && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}Salvar alterações</Button>
      <Button type="button" variant="outline" className={touch} aria-describedby={noteId} disabled={Boolean(busy) || !savedTask || !connection.enabled} title={!connection.enabled ? "Ative e salve a conexão antes de testar." : !savedTask ? "Salve um modelo antes de testar." : undefined} onClick={() => run("test", () => api(`${base}/test`, "POST", { task: savedTask?.id }))}>{busy === "test" && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}Testar conexão</Button>
      <AlertDialog>
        <AlertDialogTrigger asChild><Button type="button" variant="ghost" className={`${touch} text-destructive`} disabled={Boolean(busy) || assigned} title={assigned ? "Remova as atribuições e salve antes de excluir." : undefined}>{busy === "delete" && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}Excluir</Button></AlertDialogTrigger>
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

export function PlatformConnections({ officeId, initialConnections, catalog }: { officeId: string; initialConnections: AiConnectionView[]; catalog: Catalog }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await api(`/api/platform/offices/${officeId}/connections`, "POST", { ...draft, models: modelsOf(draft) });
      setDraft(emptyDraft()); setCreating(false); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível criar a conexão."); }
    finally { setBusy(false); }
  }
  return <div className="mt-8">
    <div className="flex items-center justify-between gap-4 border-b pb-4"><p className="text-muted-foreground text-sm">{initialConnections.length === 1 ? "1 conexão cadastrada" : `${initialConnections.length} conexões cadastradas`}</p><Button className={touch} aria-expanded={creating} onClick={() => { setCreating((value) => !value); setError(""); }} variant={creating ? "outline" : "default"}>{creating ? "Cancelar" : "Nova conexão"}</Button></div>
    {creating && <form onSubmit={create} className="border-b py-7"><h2 className="mb-5 font-medium">Nova conexão</h2><Fields draft={draft} setDraft={setDraft} catalog={catalog} requireKey /><div className="mt-5 flex items-center gap-3"><Button type="submit" className={touch} disabled={busy}>{busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}Criar conexão</Button>{busy && <span className="text-muted-foreground text-xs" role="status">Criando…</span>}</div>{error && <div className="mt-3"><ErrorText message={error} /></div>}</form>}
    <div>{initialConnections.map((connection) => <ExistingConnection key={`${connection.id}:${connection.updatedAt}`} officeId={officeId} connection={connection} catalog={catalog} />)}</div>
    {!creating && initialConnections.length === 0 && <p className="py-12 text-subtle-foreground">Nenhuma conexão configurada. Cadastre a primeira para liberar os modelos deste escritório.</p>}
  </div>;
}
