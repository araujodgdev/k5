"use client";

import { useId, useState, type FormEvent } from "react";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/canvas/canvas-controls";
import { FolderAccessFields, type FolderAccessValue } from "@/components/vault-folder-access";
import type { VaultFolder } from "@/lib/vault";
import { CaseDialog, CaseDialogFooter } from "./case-dialog";

const openToCase: FolderAccessValue = { visibility: "public", memberIds: [] };

/** "Nova pasta": a name and who sees it, at the level the case shows. */
export function FolderDialog({ caseId, parentId, open, onOpenChange, onCreated }: {
  caseId: string;
  parentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (folder: VaultFolder) => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [access, setAccess] = useState(openToCase);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const blocked = !name.trim() || busy || (access.visibility === "restricted" && !access.memberIds.length);

  function close(next: boolean) {
    if (busy) return;
    if (!next) { setName(""); setAccess(openToCase); setFailure(""); }
    onOpenChange(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (blocked) return;
    setBusy(true); setFailure("");
    try {
      const response = await fetch("/api/vault/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caseId, name: name.trim(), parentId, visibility: access.visibility,
          memberIds: access.visibility === "restricted" ? access.memberIds : [] }),
      });
      const result = await response.json().catch(() => null) as { error?: string; folder?: VaultFolder } | null;
      if (!response.ok || !result?.folder) { setFailure(result?.error ?? "Não foi possível criar a pasta."); return; }
      onCreated(result.folder);
      setName(""); setAccess(openToCase);
      onOpenChange(false);
    } catch {
      setFailure("Não foi possível conectar. Confira sua conexão.");
    } finally { setBusy(false); }
  }

  return (
    <CaseDialog open={open} onOpenChange={close} title="Nova pasta">
      <form onSubmit={submit} className="flex flex-col gap-[18px]">
        <Field label="Nome da pasta" htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required autoFocus className="max-md:h-11" />
        </Field>
        <FolderAccessFields caseId={caseId} value={access} onChange={setAccess} idPrefix={`${id}-access`} />
        {failure && <p role="alert" className="flex items-start gap-2 text-[13px] text-destructive"><CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{failure}</p>}
        <CaseDialogFooter className="justify-end">
          <Button type="submit" size="lg" disabled={blocked}>{busy && <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}{busy ? "Criando…" : "Criar pasta"}</Button>
        </CaseDialogFooter>
      </form>
    </CaseDialog>
  );
}
