"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Globe, LoaderCircle, Lock, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { initials } from "@/lib/profile-contract";
import { CaseDialog, CaseDialogFooter } from "./case-dialog";

type Person = { id: string; name: string; email: string };
type Overview = { associates: Person[]; participants: Person[]; owner: Person | null; isOwner: boolean; viewerId: string };
type Portal = { state: "invited" | "active" | "expired" | "revoked" | null; files: number };

/** The CRM client tied to the case, whose portal the dialog reports on. */
export type CaseClient = { id: string; name: string };

async function post(body: unknown) {
  const response = await fetch("/api/collaboration", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(result?.error ?? "Não foi possível concluir.");
}

function portalLine(client: CaseClient, portal: Portal | null) {
  if (!portal) return "Carregando o portal…";
  const first = client.name.split(/\s+/)[0];
  const published = portal.files === 1 ? "1 arquivo publicado" : `${portal.files} arquivos publicados`;
  if (portal.state === "active") return `${first} vê só o que você publicar. ${published}.`;
  if (portal.state === "invited") return `Convite enviado a ${first}, ainda não aceito. ${published}.`;
  return `${first} ainda não tem acesso ao portal.`;
}

/**
 * "Compartilhar caso" (`Compartilhar.dc.html`): who works on the case with you, chosen among your
 * associates, and what the client sees in the portal. Conversations with the Lume stay personal.
 */
export function ShareDialog({ caseId, caseName, client, open, onOpenChange }: {
  caseId: string;
  caseName: string;
  /** Null when no client of the office is tied to the case, or the viewer is not its owner. */
  client: CaseClient | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [portal, setPortal] = useState<Portal | null>(null);
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/collaboration?caseId=${encodeURIComponent(caseId)}`, { cache: "no-store" });
      const next = await response.json().catch(() => null) as (Overview & { error?: string }) | null;
      if (!response.ok || !next) throw new Error(next?.error ?? "Não foi possível carregar quem participa do caso.");
      setData(next); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar quem participa do caso."); }
  }, [caseId]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [open, load]);

  useEffect(() => {
    if (!open || !client) return;
    const controller = new AbortController();
    void fetch(`/api/client-portal/manage?clientId=${encodeURIComponent(client.id)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json().catch(() => null) as { access: { state: Portal["state"] } | null; files: { kind: string }[] } | null;
        if (!response.ok || !result) throw new Error();
        setPortal({ state: result.access?.state ?? null, files: result.files.filter((file) => file.kind === "published").length });
      })
      .catch(() => { if (!controller.signal.aborted) setPortal({ state: null, files: 0 }); });
    return () => controller.abort();
  }, [open, client]);

  async function act(body: unknown, done: string) {
    setBusy(true); setError(""); setNotice("");
    try { await post(body); await load(); router.refresh(); setNotice(done); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível concluir."); return false; }
    finally { setBusy(false); }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!chosen) return;
    if (await act({ action: "participant", caseId, userId: chosen, add: true }, "Participante incluído no caso.")) setChosen("");
  }

  const candidates = data ? data.associates.filter((person) => !data.participants.some((item) => item.id === person.id)) : [];
  const members = data ? [...(data.owner ? [{ person: data.owner, owner: true }] : []), ...data.participants.map((person) => ({ person, owner: false }))] : [];

  return (
    <CaseDialog open={open} onOpenChange={(next) => { if (!next) { setNotice(""); setError(""); } onOpenChange(next); }} title="Compartilhar caso" description={caseName}>
      {data?.isOwner && (
        <form onSubmit={add} className="flex gap-2 max-md:flex-col">
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-md border border-border-strong px-2.5 text-muted-foreground focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring md:h-9">
            <UserPlus aria-hidden="true" className="size-3.5 shrink-0" />
            <select value={chosen} onChange={(event) => setChosen(event.target.value)} aria-label="Associado para adicionar ao caso" disabled={!candidates.length}
              className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none disabled:text-subtle-foreground md:text-[13.5px]">
              <option value="">{candidates.length ? "Escolha entre seus associados" : data.associates.length ? "Todos os seus associados já participam" : "Você ainda não tem associados"}</option>
              {candidates.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.email}</option>)}
            </select>
          </label>
          <Button type="submit" className="h-11 md:h-9" disabled={busy || !chosen}>{busy && <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}Adicionar</Button>
        </form>
      )}

      {error && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-destructive">
          {error}{!data && <Button variant="outline" className="max-md:h-11" onClick={() => void load()}>Tentar novamente</Button>}
        </p>
      )}
      {notice && <p role="status" className="text-[13px]">{notice}</p>}

      <div className="flex flex-col gap-0.5">
        <span className="pb-1 text-xs font-medium text-muted-foreground">Participantes</span>
        {!data && !error && <p role="status" className="py-3 text-[13.5px] text-muted-foreground">Carregando…</p>}
        {members.map(({ person, owner }) => (
          <div key={person.id} className="flex min-h-12 items-center gap-3">
            <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11.5px] font-semibold text-muted-foreground">{initials(person.name)}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="truncate text-sm">{person.name}{person.id === data?.viewerId && " (você)"}</span>
              <span className="truncate text-[12.5px] text-muted-foreground">{person.email}</span>
            </span>
            {owner ? <span className="pr-2 text-[13px] text-muted-foreground">Responsável</span>
              : data?.isOwner ? <Removal busy={busy} label="Remover" name={person.name} title={`Remover ${person.name} do caso?`}
                description="O acesso a este caso será revogado. As pastas privadas dessa pessoa no caso continuam guardadas e fora do alcance dos demais."
                onConfirm={() => void act({ action: "participant", caseId, userId: person.id, add: false }, `${person.name} saiu do caso.`)} />
              : person.id === data?.viewerId && <Removal busy={busy} label="Sair do caso" name={person.name} title="Sair deste caso?"
                description="Você deixa de ver o caso. Para voltar, o responsável precisa incluir você de novo."
                onConfirm={async () => { if (await act({ action: "participant", caseId, userId: person.id, add: false }, "Você saiu do caso.")) router.push("/app/vault"); }} />}
          </div>
        ))}
      </div>

      <p className="-mt-1.5 flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <Lock aria-hidden="true" className="size-3.5 shrink-0" />Conversas com o Lume, as páginas que você escreve com ele e a memória de cada pessoa continuam pessoais.
      </p>

      {data?.isOwner && (
        <div className="flex flex-col gap-1 border-t border-border pt-3.5">
          <div className="flex min-h-[52px] items-center gap-3">
            <span aria-hidden="true" className="flex w-8 shrink-0 justify-center text-muted-foreground"><Globe className="size-[18px]" /></span>
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="text-sm">Portal do cliente</span>
              <span className="text-[12.5px] leading-[1.45] text-muted-foreground">{client ? portalLine(client, portal) : "Ligue um cliente do escritório a este caso para publicar no portal."}</span>
            </span>
            <Button asChild variant="outline" size="sm" className="h-11 border-border-strong px-2.5 text-[13px] md:h-[30px]">
              <Link href={client ? `/app/agenda/clients/${client.id}` : "/app/agenda?view=clients"}>{client ? "Gerenciar" : "Ver clientes"}</Link>
            </Button>
          </div>
        </div>
      )}

      <CaseDialogFooter>
        {data?.isOwner && (
          <Button asChild variant="ghost" size="lg" className="px-2.5 text-muted-foreground">
            <Link href="/app/agenda?view=associates"><UserPlus aria-hidden="true" className="size-3.5" />Convidar novo associado</Link>
          </Button>
        )}
        <span className="flex-1" />
        <Button type="button" size="lg" className="px-4" onClick={() => onOpenChange(false)}>Concluir</Button>
      </CaseDialogFooter>
    </CaseDialog>
  );
}

function Removal({ busy, label, name, title, description, onConfirm }: {
  busy: boolean; label: string; name: string; title: string; description: string; onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-11 px-2 text-[13px] text-muted-foreground hover:text-foreground md:h-[30px]" disabled={busy}
          aria-label={label === "Remover" ? `Remover ${name}` : undefined}>{label}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={onConfirm}>{label}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
