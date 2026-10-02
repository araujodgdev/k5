"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { FolderVisibility, VaultFolder } from "@/lib/vault";
import { folderDto } from "@/lib/capabilities/contracts";

export type FolderAccessValue = { visibility: FolderVisibility; memberIds: string[] };
type Person = { id: string; name: string; email: string };
const folderAccessResponse = z.object({ error: z.string().optional(), folder: folderDto.optional() });

export const visibilityLabels: Record<FolderVisibility, string> = { public: "Todos do caso", private: "Só eu", restricted: "Pessoas escolhidas" };
/** How a folder row says who sees it; a public folder needs no note. */
export const visibilityNote = (folder: Pick<VaultFolder, "visibility" | "owned">) =>
  folder.visibility === "private" ? "Privada" : folder.visibility === "restricted" ? (folder.owned ? "Restrita" : "Compartilhada com você") : null;

/** The case's people, read from the participants list the case already exposes. */
function useCasePeople(caseId: string, enabled: boolean) {
  const [state, setState] = useState<{ people: Person[]; viewerId: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled || state) return;
    let active = true;
    void fetch(`/api/collaboration?caseId=${encodeURIComponent(caseId)}`, { cache: "no-store" }).then(async (response) => {
      const result = await response.json() as { error?: string; owner: Person | null; participants: Person[]; viewerId: string };
      if (!response.ok) throw new Error(result.error);
      if (active) setState({ people: [...(result.owner ? [result.owner] : []), ...result.participants], viewerId: result.viewerId });
    }).catch((cause) => { if (active) setError(cause instanceof Error && cause.message ? cause.message : "Não foi possível carregar as pessoas do caso."); });
    return () => { active = false; };
  }, [caseId, enabled, state]);
  return { people: state?.people.filter((person) => person.id !== state.viewerId) ?? null, error };
}

export function FolderAccessFields({ caseId, value, onChange, idPrefix }: {
  caseId: string; value: FolderAccessValue; onChange: (value: FolderAccessValue) => void; idPrefix: string;
}) {
  const { people, error } = useCasePeople(caseId, value.visibility === "restricted");
  const toggle = (id: string, checked: boolean) => onChange({ ...value, memberIds: checked ? [...value.memberIds, id] : value.memberIds.filter((item) => item !== id) });
  return <div className="grid min-w-0 gap-3">
    <div className="grid gap-1.5"><Label htmlFor={`${idPrefix}-visibility`}>Quem vê a pasta</Label>
      <select id={`${idPrefix}-visibility`} value={value.visibility} className="min-h-11 min-w-56 border border-input bg-background px-3 text-sm md:min-h-9"
        onChange={(event) => onChange({ ...value, visibility: event.target.value as FolderVisibility })}>
        {(Object.keys(visibilityLabels) as FolderVisibility[]).map((option) => <option key={option} value={option}>{visibilityLabels[option]}</option>)}
      </select>
    </div>
    {value.visibility === "restricted" && <fieldset className="grid min-w-0 gap-1">
      <legend className="mb-1 text-sm">Quem mais vê, além de você</legend>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p>
        : !people ? <p role="status" className="text-sm text-muted-foreground">Carregando pessoas do caso…</p>
        : people.length ? people.map((person) => <label key={person.id} className="flex min-h-11 min-w-0 items-center gap-3 text-sm md:min-h-9">
          <input type="checkbox" className="size-5 shrink-0 accent-primary md:size-4" checked={value.memberIds.includes(person.id)} onChange={(event) => toggle(person.id, event.target.checked)} />
          <span className="min-w-0 truncate">{person.name} <span className="text-muted-foreground">· {person.email}</span></span>
        </label>)
        : <p className="text-sm text-subtle-foreground">Ainda não há outras pessoas neste caso. Inclua participantes em Participantes.</p>}
    </fieldset>}
    <p className="text-[13px] text-muted-foreground">{value.visibility === "public" ? "Todos que participam do caso veem esta pasta." : value.visibility === "private"
      ? "Só você vê esta pasta, nem o responsável pelo caso." : "Só você e as pessoas escolhidas veem esta pasta."} As subpastas seguem esta regra e podem ser ainda mais fechadas.</p>
  </div>;
}

/** Changing who sees a folder is its creator's decision; the dialog is only offered to them. */
export function FolderAccessDialog({ caseId, folder, open, onOpenChange, onSaved }: {
  caseId: string; folder: VaultFolder; open: boolean; onOpenChange: (open: boolean) => void; onSaved: (folder: VaultFolder) => void;
}) {
  const [value, setValue] = useState<FolderAccessValue>({ visibility: folder.visibility, memberIds: folder.memberIds });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/vault/folders/${encodeURIComponent(folder.id)}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: value.visibility, memberIds: value.visibility === "restricted" ? value.memberIds : [] }),
      });
      const result = folderAccessResponse.safeParse(await response.json().catch(() => null));
      if (!response.ok || !result.success || !result.data.folder) {
        setError(result.success ? result.data.error ?? "Não foi possível alterar o acesso." : "Não foi possível alterar o acesso.");
        return;
      }
      onSaved(result.data.folder); onOpenChange(false);
    } catch { setError("Não foi possível conectar. Confira sua conexão."); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
    <DialogContent className="flex max-h-[92dvh] flex-col gap-4 overflow-y-auto sm:max-w-lg [&_[data-slot=dialog-close]]:size-11 md:[&_[data-slot=dialog-close]]:size-9">
      <DialogTitle className="break-words pr-10">Acesso à pasta {folder.name}</DialogTitle>
      <DialogDescription>Só você, que criou a pasta, pode mudar quem a vê.</DialogDescription>
      <FolderAccessFields caseId={caseId} value={value} onChange={setValue} idPrefix={`folder-${folder.id}`} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="button" disabled={busy || (value.visibility === "restricted" && !value.memberIds.length)} onClick={() => void save()} className="min-h-11 w-full md:min-h-9">
        {busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}{busy ? "Salvando…" : "Salvar acesso"}
      </Button>
    </DialogContent>
  </Dialog>;
}
