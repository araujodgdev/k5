"use client";

import { useId, useState, type FormEvent } from "react";
import { CircleAlert, LoaderCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AppliesTo, Instruction, InstructionScope } from "@/lib/agent-instructions";

export type RulesState = { office: Instruction[]; personal: Instruction[]; budget: number };

const appliesLabel: Record<AppliesTo, string> = { all: "Conversas e documentos", chat: "Só conversas", documents: "Só documentos" };
const placeholders = [
  "Endereçamento: use \"Excelentíssimo Senhor Doutor Juiz de Direito\" nas petições iniciais.",
  "Parágrafos de no máximo seis linhas. Evite latinismos quando houver termo equivalente em português.",
];

async function errorMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

const used = (rules: Instruction[]) => rules.reduce((sum, rule) => sum + (rule.enabled ? rule.content.trim().length : 0), 0);

export function AgentRules({ initial }: { initial: RulesState }) {
  const [state, setState] = useState(initial);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const replace = (scope: InstructionScope, update: (rules: Instruction[]) => Instruction[]) =>
    setState((current) => ({ ...current, [scope]: update(current[scope]) }));
  const entries = [
    ...state.office.map(rule => ({ rule, scope: "office" as const })),
    ...state.personal.map(rule => ({ rule, scope: "personal" as const })),
  ];

  return (
    <section aria-labelledby="rules-heading" className="mt-8">
      <h2 id="rules-heading" className="font-medium">Regras de escrita</h2>
      <p className="mt-1 text-sm text-muted-foreground">Como o Lume escreve: tom, forma, vocabulário. As regras não mudam o cuidado com fontes e citações jurídicas.</p>
      <p className="mt-2 text-[13px] text-muted-foreground" aria-live="polite">Ativas: {used(entries.map(entry => entry.rule)).toLocaleString("pt-BR")} caracteres</p>
      <div className="mt-3 divide-y border-y">
        {entries.length === 0 && editing !== "new" && <p className="py-4 text-sm text-subtle-foreground">Nenhuma regra definida.</p>}
        {entries.map(({ rule, scope }) => editing === rule.id
          ? <RuleForm key={rule.id} scope={scope} rule={rule} placeholder={placeholders[0]} onDone={(next) => {
              setEditing(null);
              if (next === "deleted") replace(scope, (list) => list.filter((item) => item.id !== rule.id));
              else if (next) replace(scope, (list) => list.map((item) => item.id === rule.id ? next : item));
            }} />
          : <RuleRow key={rule.id} scope={scope} rule={rule} editable onEdit={() => setEditing(rule.id)}
              onSaved={(next) => replace(scope, (list) => list.map((item) => item.id === next.id ? next : item))} />)}
        {editing === "new" && <RuleForm scope="personal" placeholder={placeholders[1]} onDone={(next) => {
          setEditing(null);
          if (next && next !== "deleted") replace("personal", (list) => [...list, next]);
        }} />}
      </div>

      {editing !== "new" && (
        <Button type="button" variant="ghost" className="mt-2 min-h-11 md:min-h-9" onClick={() => setEditing("new")}><Plus aria-hidden="true" />Nova regra</Button>
      )}
    </section>
  );
}

function RuleRow({ scope, rule, editable, onEdit, onSaved }: {
  scope: InstructionScope; rule: Instruction; editable: boolean; onEdit: () => void; onSaved: (rule: Instruction) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/agent/instructions/${encodeURIComponent(rule.id)}`, {
        method: "PUT", headers: { "content-type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ scope, title: rule.title, content: rule.content, appliesTo: rule.appliesTo, enabled: !rule.enabled, version: rule.version }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Não foi possível alterar a regra."));
      onSaved((await response.json() as { instruction: Instruction }).instruction);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível alterar a regra.");
    } finally { setBusy(false); }
  }

  return (
    <div className="flex items-start gap-3 py-3">
      {editable && (
        <input type="checkbox" checked={rule.enabled} disabled={busy} onChange={() => void toggle()}
          aria-label={`${rule.enabled ? "Desativar" : "Ativar"} ${rule.title}`} className="mt-1 size-5 shrink-0 accent-primary md:size-4" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{rule.title}</p>
        <p className="text-[13px] text-muted-foreground">{appliesLabel[rule.appliesTo]}{rule.enabled ? "" : " · Desativada"}</p>
        <p className={`mt-1 line-clamp-2 text-sm ${rule.enabled ? "text-muted-foreground" : "text-subtle-foreground"}`}>{rule.content}</p>
        {error && <p role="alert" className="mt-1 flex items-start gap-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
      </div>
      {editable && <Button type="button" variant="ghost" className="min-h-11 shrink-0 md:min-h-9" onClick={onEdit} aria-label={`Editar ${rule.title}`}>Editar</Button>}
    </div>
  );
}

function RuleForm({ scope, rule, placeholder, onDone }: {
  scope: InstructionScope; rule?: Instruction; placeholder: string; onDone: (result: Instruction | "deleted" | null) => void;
}) {
  const [title, setTitle] = useState(rule?.title ?? "");
  const [content, setContent] = useState(rule?.content ?? "");
  const [appliesTo, setAppliesTo] = useState<AppliesTo>(rule?.appliesTo ?? "all");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const id = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(rule ? `/api/agent/instructions/${encodeURIComponent(rule.id)}` : "/api/agent/instructions", {
        method: rule ? "PUT" : "POST", headers: { "content-type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ scope, title, content, appliesTo, enabled: rule?.enabled ?? true, ...(rule ? { version: rule.version } : {}) }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Não foi possível salvar a regra."));
      onDone((await response.json() as { instruction: Instruction }).instruction);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a regra.");
      setBusy(false);
    }
  }

  async function remove() {
    if (!rule) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/agent/instructions/${encodeURIComponent(rule.id)}?scope=${scope}`, { method: "DELETE", cache: "no-store" });
      if (!response.ok) throw new Error(await errorMessage(response, "Não foi possível excluir a regra."));
      onDone("deleted");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível excluir a regra.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 py-4" aria-label={rule ? `Editar ${rule.title}` : "Nova regra"}>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-title`}>Título</Label>
        <Input id={`${id}-title`} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required autoFocus className="h-11 md:h-9" placeholder="Endereçamento" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-content`}>Regra</Label>
        <Textarea id={`${id}-content`} value={content} onChange={(event) => setContent(event.target.value)} maxLength={2000} required className="min-h-28" placeholder={placeholder} aria-describedby={`${id}-count`} />
        <p id={`${id}-count`} className="text-xs text-muted-foreground">{content.trim().length.toLocaleString("pt-BR")} de 2.000 caracteres</p>
      </div>
      <div className="grid gap-1.5 md:max-w-72">
        <Label htmlFor={`${id}-applies`}>Vale para</Label>
        <select id={`${id}-applies`} value={appliesTo} onChange={(event) => setAppliesTo(event.target.value as AppliesTo)} className="h-11 rounded-md border bg-background px-3 text-sm md:h-9">
          {(Object.keys(appliesLabel) as AppliesTo[]).map((value) => <option key={value} value={value}>{appliesLabel[value]}</option>)}
        </select>
      </div>
      {error && <p role="alert" className="flex items-start gap-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" className="min-h-11 md:min-h-9" disabled={busy || !title.trim() || !content.trim()}>
          {busy && !confirmDelete && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}Salvar
        </Button>
        <Button type="button" variant="ghost" className="min-h-11 md:min-h-9" disabled={busy} onClick={() => onDone(null)}>Cancelar</Button>
        {rule && (
          <Button type="button" variant="ghost" className="min-h-11 text-destructive hover:text-destructive md:ml-auto md:min-h-9" disabled={busy} onClick={() => void remove()}>
            {confirmDelete ? "Confirmar exclusão" : "Excluir"}
          </Button>
        )}
      </div>
    </form>
  );
}
