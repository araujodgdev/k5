"use client";

import { useId, useState, type FormEvent } from "react";
import { ChevronRight, CircleAlert, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/canvas/canvas-controls";
import type { VaultCase } from "@/lib/vault";
import { CaseDialog, CaseDialogFooter } from "./case-dialog";

type Client = Record<keyof VaultCase["client"], string>;

const clientOf = (record?: VaultCase): Client => ({
  name: record?.client.name ?? "", document: record?.client.document ?? "", email: record?.client.email ?? "",
  phone: record?.client.phone ?? "", notes: record?.client.notes ?? "",
});

/**
 * The case's name, what it is about and, folded, the client's details: "Novo caso" without a
 * record, "Editar caso" with one.
 */
export function CaseFormDialog({ record, open, onOpenChange, onSaved }: {
  record?: VaultCase;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (record: VaultCase) => void;
}) {
  const editing = Boolean(record);
  const id = useId();
  const [name, setName] = useState(record?.name ?? "");
  const [description, setDescription] = useState(record?.description ?? "");
  const [client, setClient] = useState(() => clientOf(record));
  const [advanced, setAdvanced] = useState(() => Object.values(clientOf(record)).some(Boolean));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  function reset() {
    setName(record?.name ?? ""); setDescription(record?.description ?? ""); setClient(clientOf(record));
    setAdvanced(Object.values(clientOf(record)).some(Boolean)); setFailure("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const clean = name.trim();
    if (clean.length < 2) { setFailure("Informe um nome de caso com pelo menos 2 caracteres."); return; }
    setBusy(true); setFailure("");
    try {
      const response = await fetch(record ? `/api/vault/cases/${encodeURIComponent(record.id)}` : "/api/vault/cases", {
        method: record ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: clean, description: description.trim() || null, client }),
      });
      const result = await response.json().catch(() => null) as { error?: string; case?: VaultCase } | null;
      if (!response.ok || !result?.case) { setFailure(result?.error ?? (record ? "Não foi possível salvar o caso." : "Não foi possível criar o caso.")); return; }
      onSaved(result.case);
      if (!record) { setName(""); setDescription(""); setClient(clientOf()); setAdvanced(false); }
      onOpenChange(false);
    } catch {
      setFailure("Não foi possível conectar. Confira sua conexão.");
    } finally { setBusy(false); }
  }

  const clientField = (key: keyof Client, label: string, max: number, type = "text") => (
    <Field label={label} htmlFor={`${id}-client-${key}`}>
      <Input id={`${id}-client-${key}`} type={type} value={client[key]} maxLength={max} className="max-md:h-11"
        onChange={(event) => setClient({ ...client, [key]: event.target.value })} />
    </Field>
  );

  return (
    <CaseDialog open={open} onOpenChange={(next) => { if (busy) return; if (!next) reset(); onOpenChange(next); }}
      title={editing ? "Editar caso" : "Novo caso"}
      description={editing ? undefined : "Um espaço para os arquivos, as páginas e o trabalho de um processo."}>
      <form onSubmit={submit} className="flex flex-col gap-[18px]">
        <Field label="Título" htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} placeholder="Silva vs. Construtora Horizonte"
            maxLength={180} required autoFocus className="max-md:h-11" />
        </Field>
        <Field label="Descrição" htmlFor={`${id}-description`}>
          <Textarea id={`${id}-description`} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Do que trata este caso."
            className="min-h-20 resize-y" maxLength={4000} />
        </Field>
        <button type="button" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}
          className="-my-1 flex min-h-11 w-fit items-center gap-1 rounded-sm text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:min-h-8">
          <ChevronRight aria-hidden="true" className={`size-4 transition-transform motion-reduce:transition-none ${advanced ? "rotate-90" : ""}`} />Dados do cliente (opcional)
        </button>
        {advanced && (
          <div className="grid gap-3.5 sm:grid-cols-2">
            {clientField("name", "Nome", 180)}
            {clientField("document", "CPF ou CNPJ", 40)}
            {clientField("email", "E-mail", 200, "email")}
            {clientField("phone", "Telefone", 40)}
            <Field label="Observações" htmlFor={`${id}-client-notes`} className="sm:col-span-2">
              <Textarea id={`${id}-client-notes`} value={client.notes} onChange={(event) => setClient({ ...client, notes: event.target.value })} className="min-h-20 resize-y" maxLength={4000} />
            </Field>
          </div>
        )}
        {failure && <p role="alert" className="flex items-start gap-2 text-[13px] text-destructive"><CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{failure}</p>}
        <CaseDialogFooter className="justify-end">
          <Button type="submit" size="lg" disabled={busy}>
            {busy && <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}{editing ? "Salvar caso" : "Criar caso"}
          </Button>
        </CaseDialogFooter>
      </form>
    </CaseDialog>
  );
}
