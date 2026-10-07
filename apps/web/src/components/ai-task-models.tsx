"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, Pill } from "@/components/canvas/canvas-controls";
import { AdminBlock, AdminBlockHead, adminButton, adminQuietAction } from "@/components/admin/admin-blocks";
import type { AssignmentOverview, AssignmentView, Origin, TaskModelPlan } from "@/lib/ai-assignments-core";
import type { AiProvider } from "@/lib/ai-connections-core";
import {
  AI_TASK_DEFINITIONS, AI_TASK_GROUP_DEFINITIONS, AI_TASK_KEYS, REASONING_EFFORTS, groupChain, reasoningEffortLabels, supportsReasoningEffort,
  type AiTaskGroup, type AiTaskKey, type ReasoningEffort,
} from "@/lib/ai-tasks";
import { cn } from "@/lib/utils";

// 44px controls on touch, the canvas input height from md up.
const touch = "h-11 md:h-9";
const fieldLabel = "text-xs font-normal text-muted-foreground";
type Level = { scope: "group" | "task"; target: string };
type Group = AssignmentOverview["groups"][number];
type Task = AssignmentOverview["tasks"][number];
type Catalogs = { chat: Record<AiProvider, string[]>; transcription: Record<AiProvider, string[]> };

const labelOf = (level: Level) => level.scope === "task" ? AI_TASK_DEFINITIONS[level.target as AiTaskKey].label : AI_TASK_GROUP_DEFINITIONS[level.target as AiTaskGroup].label;
const sameLevel = (a: Origin, b: Level) => a.scope !== "default" && a.scope === b.scope && a.target === b.target;
const levelsOf = (task: AiTaskKey): Level[] => [{ scope: "task", target: task }, ...groupChain(AI_TASK_DEFINITIONS[task].group).map(target => ({ scope: "group" as const, target }))];

async function api(url: string, method: string, body: object) {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? "Não foi possível concluir a operação.");
  return payload;
}

/** The resolved model in one line, and where its model and effort come from in a second. */
function PlanSummary({ plan, level, root }: { plan: TaskModelPlan; level: Level; root: AiTaskGroup }) {
  if (plan.status === "unavailable") return <p className="flex items-start gap-2 text-destructive text-sm"><CircleAlert className="mt-0.5 size-4 shrink-0" />{plan.message}</p>;
  if (plan.status === "unconfigured") return <p className="text-sm text-subtle-foreground">{plan.message}</p>;
  if (plan.status === "disabled") return <p className="text-sm text-muted-foreground">{plan.reason === "unsupported" ? "Indisponível: o modelo do Agente não ouve áudio. Escolha um modelo de transcrição." : "Desativada."}</p>;
  const from = (origin: Origin) => sameLevel(origin, level) ? "definido aqui"
    : origin.scope === "default" ? (root === "transcription" ? "segue o provider do Agente" : "padrão do Lume: primeira conexão ativa")
    : `herdado de ${labelOf(origin)}`;
  const effort = plan.effort ? `esforço ${reasoningEffortLabels[plan.effort].toLowerCase()}` : "esforço padrão do provider";
  const effortWhy = plan.effortNote === "unsupported" ? "o provider não recebe esforço"
    : plan.effortNote === "other_provider" ? `o esforço de ${labelOf(plan.effortOrigin as Level)} foi escolhido para outro provider`
    : from(plan.effortOrigin);
  return <div className="grid gap-0.5 text-sm">
    <p className="break-words">{plan.connectionName} · <span className="font-mono text-[13px]">{plan.modelId}</span>{root === "transcription" ? "" : ` · ${effort}`}</p>
    <p className="text-subtle-foreground text-xs">Modelo {from(plan.modelOrigin)}{root === "transcription" ? "" : `; esforço ${effortWhy}`}.</p>
  </div>;
}

const inherits = (assignments: Map<string, AssignmentView>, levels: Level[], field: "model" | "effort") =>
  levels.every(item => { const row = assignments.get(`${item.scope}:${item.target}`); return !row || row[field].mode === "inherit"; });

/**
 * Which tasks a change at this level reaches: those whose chain passes through it with nothing
 * set below. The rest keep a choice of their own, which the administrator should see before saving.
 * Transcription is outside the agent's chain but, with no model of its own, follows the agent's
 * provider, so a change to the agent can turn the microphone off.
 */
export function reach(level: Level, assignments: Map<string, AssignmentView>) {
  const tasks = level.scope === "task" ? [level.target as AiTaskKey] : AI_TASK_KEYS.filter(task => groupChain(AI_TASK_DEFINITIONS[task].group).includes(level.target as AiTaskGroup));
  const items = tasks.map(task => {
    const levels = levelsOf(task);
    const below = levels.slice(0, levels.findIndex(item => item.scope === level.scope && item.target === level.target));
    return { task, model: inherits(assignments, below, "model"), effort: inherits(assignments, below, "effort") };
  });
  const voiceNote = level.scope === "group" && level.target === "agent" && inherits(assignments, levelsOf("transcription.voice_note"), "model");
  return { items, voiceNote };
}

function Reach({ level, assignments }: { level: Level; assignments: Map<string, AssignmentView> }) {
  if (level.scope === "task") return null;
  const { items, voiceNote } = reach(level, assignments);
  const follow = items.filter(item => item.model || item.effort)
    .map(item => `${AI_TASK_DEFINITIONS[item.task].label}${item.model && !item.effort ? " (só o modelo)" : !item.model ? " (só o esforço)" : ""}`);
  const own = items.filter(item => !item.model && !item.effort).map(item => AI_TASK_DEFINITIONS[item.task].label);
  return <p className="text-muted-foreground text-xs sm:col-span-2">
    {follow.length ? `Vale para: ${follow.join(", ")}.` : "Nenhuma tarefa segue este nível agora."}
    {own.length ? ` Continuam com escolha própria: ${own.join(", ")}.` : ""}
    {voiceNote ? " A nota de voz segue o provider do Agente: na OpenAI usa o modelo de transcrição; com um modelo que não ouve áudio, o microfone é desligado." : ""}
  </p>;
}

type Draft = { model: "inherit" | "explicit" | "disabled"; connectionId: string; modelId: string; effort: "inherit" | "provider_default" | ReasoningEffort };

function draftOf(assignment: AssignmentView, fallbackConnection: string): Draft {
  return {
    model: assignment?.model.mode ?? "inherit",
    connectionId: assignment?.model.connectionId ?? fallbackConnection,
    modelId: assignment?.model.modelId ?? "",
    effort: assignment?.effort.mode === "explicit" ? assignment.effort.value ?? "inherit" : assignment?.effort.mode ?? "inherit",
  };
}

function Editor({ level, item, overview, catalogs, assignments, onSaved, onCancel }: {
  level: Level; item: Group | Task; overview: AssignmentOverview; catalogs: Catalogs; assignments: Map<string, AssignmentView>;
  onSaved: (overview: AssignmentOverview) => void; onCancel: () => void;
}) {
  const id = useId();
  const group = AI_TASK_GROUP_DEFINITIONS[level.scope === "task" ? (item as Task).group : level.target as AiTaskGroup];
  const connections = overview.connections.filter(connection => connection.enabled && connection.hasKey);
  const parent: Level | null = level.scope === "task" ? { scope: "group", target: group.key } : group.parent ? { scope: "group", target: group.parent } : null;
  const [draft, setDraft] = useState(() => {
    const initial = draftOf(item.assignment, connections[0]?.id ?? "");
    // At the top of the chain, inheriting the effort and the provider default are the same choice.
    return !parent && initial.effort === "provider_default" ? { ...initial, effort: "inherit" as const } : initial;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const connection = connections.find(entry => entry.id === draft.connectionId);
  const transcription = group.execution === "transcription";
  const suggestions = connection ? (transcription ? catalogs.transcription : catalogs.chat)[connection.provider] : [];
  const listed = suggestions.includes(draft.modelId) ? draft.modelId : "custom";
  // The provider the effort will apply to: the chosen connection's, or the one inherited from above.
  const parentPlan = parent ? overview.groups.find(entry => entry.key === parent.target)?.plan : undefined;
  const provider = draft.model === "explicit" ? connection?.provider : parentPlan?.status === "ready" ? parentPlan.provider : undefined;
  const effortAccepted = provider === undefined || supportsReasoningEffort(provider);
  const inheritLabel = parent ? `Herdar de ${labelOf(parent)}` : group.key === "transcription" ? "Seguir o provider do Agente" : "Padrão do Lume (primeira conexão ativa)";

  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const body = {
        ...level,
        model: draft.model === "explicit" ? { mode: "explicit", connectionId: draft.connectionId, modelId: draft.modelId.trim() } : { mode: draft.model },
        effort: transcription || draft.effort === "inherit" || draft.effort === "provider_default" ? { mode: transcription ? "inherit" : draft.effort } : { mode: "explicit", value: draft.effort },
      };
      onSaved(await api("/api/platform/ai/assignments", "PUT", body));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }

  return <form onSubmit={save} aria-busy={busy} className="grid gap-3.5 sm:grid-cols-2">
    <fieldset disabled={busy} className="contents">
      <div className="grid gap-1.5 sm:col-span-2">
        <Label className={fieldLabel} htmlFor={`${id}-mode`}>Modelo</Label>
        <Select value={draft.model} onValueChange={value => setDraft({ ...draft, model: value as Draft["model"] })}>
          <SelectTrigger id={`${id}-mode`} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="inherit">{inheritLabel}</SelectItem>
            <SelectItem value="explicit">Escolher conexão e modelo</SelectItem>
            {group.canDisable && <SelectItem value="disabled">Desativar</SelectItem>}
          </SelectContent>
        </Select>
      </div>
      {draft.model === "explicit" && (connections.length === 0
        ? <p className="text-sm text-subtle-foreground sm:col-span-2">Cadastre e ative uma conexão para escolher um modelo.</p>
        : <>
          <div className="grid gap-1.5">
            <Label className={fieldLabel} htmlFor={`${id}-connection`}>Conexão</Label>
            <Select value={draft.connectionId} onValueChange={value => setDraft({ ...draft, connectionId: value })}>
              <SelectTrigger id={`${id}-connection`} className="w-full"><SelectValue placeholder="Escolha a conexão" /></SelectTrigger>
              <SelectContent position="popper">{connections.map(entry => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className={fieldLabel} htmlFor={`${id}-list`}>Escolher da lista</Label>
            <Select value={listed} onValueChange={value => setDraft({ ...draft, modelId: value === "custom" ? "" : value })}>
              <SelectTrigger id={`${id}-list`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent position="popper">
                {suggestions.map(model => <SelectItem key={model} value={model}>{model}</SelectItem>)}
                <SelectItem value="custom">ID digitado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label className={fieldLabel} htmlFor={`${id}-model`}>ID do modelo</Label>
            <Input id={`${id}-model`} className={touch} value={draft.modelId} onChange={event => setDraft({ ...draft, modelId: event.target.value })}
              maxLength={160} required autoComplete="off" spellCheck={false} placeholder={transcription ? "Ex.: gpt-4o-mini-transcribe" : "Ex.: gpt-6-luna"} />
          </div>
        </>)}
      {transcription
        ? <p className="text-muted-foreground text-xs sm:col-span-2">A transcrição não usa esforço de raciocínio.</p>
        : <div className="grid gap-1.5 sm:col-span-2">
          <Label className={fieldLabel} htmlFor={`${id}-effort`}>Esforço de raciocínio</Label>
          <Select value={draft.effort} onValueChange={value => setDraft({ ...draft, effort: value as Draft["effort"] })}>
            <SelectTrigger id={`${id}-effort`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="inherit">{parent ? `Herdar de ${labelOf(parent)}` : "Padrão do provider"}</SelectItem>
              {parent && <SelectItem value="provider_default">Padrão do provider</SelectItem>}
              {REASONING_EFFORTS.map(effort => <SelectItem key={effort} value={effort} disabled={!effortAccepted}>{reasoningEffortLabels[effort]}</SelectItem>)}
            </SelectContent>
          </Select>
          {!effortAccepted && <p className="text-muted-foreground text-xs">Este provider não recebe esforço; ele usa o próprio padrão.</p>}
        </div>}
      <Reach level={level} assignments={assignments} />
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <Button type="submit" className={adminButton} disabled={busy || (draft.model === "explicit" && (!connection || !draft.modelId.trim()))}>{busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}Salvar</Button>
        <Button type="button" variant="outline" className={adminButton} onClick={onCancel}>Cancelar</Button>
        {busy && <span role="status" className="text-muted-foreground text-xs">Salvando…</span>}
      </div>
      {error && <p role="alert" className="flex items-start gap-2 text-destructive text-sm sm:col-span-2"><CircleAlert className="mt-0.5 size-4 shrink-0" />{error}</p>}
    </fieldset>
  </form>;
}

/** The model a plan resolves to, in the table's few words. */
function modelCell(plan: TaskModelPlan) {
  if (plan.status === "ready") return plan.modelId;
  if (plan.status === "disabled") return "Desativada";
  if (plan.status === "unavailable") return <Pill tone="accent">Indisponível</Pill>;
  return "Sem conexão";
}

function effortCell(plan: TaskModelPlan, transcription: boolean) {
  if (transcription) return "";
  if (plan.status !== "ready") return "—";
  return plan.effort ? reasoningEffortLabels[plan.effort] : "Padrão";
}

/** Lume's models per task, each with its group. One configuration serves every office. */
export function AiTaskModels({ initial, catalogs }: { initial: AssignmentOverview; catalogs: Catalogs }) {
  const router = useRouter();
  const [overview, setOverview] = useState(initial);
  const [received, setReceived] = useState(initial);
  // A refresh after a connection change brings a new overview from the server.
  if (initial !== received) { setReceived(initial); setOverview(initial); }
  const [editing, setEditing] = useState<Level | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [result, setResult] = useState<{ tone: "status" | "alert"; text: string } | null>(null);
  const assignments = new Map<string, AssignmentView>([
    ...overview.groups.map(group => [`group:${group.key}`, group.assignment] as const),
    ...overview.tasks.map(task => [`task:${task.key}`, task.assignment] as const),
  ]);
  const groupOf = (key: AiTaskGroup) => overview.groups.find(group => group.key === key)!;
  const item: Group | Task | undefined = !editing ? undefined
    : editing.scope === "task" ? overview.tasks.find(task => task.key === editing.target) : groupOf(editing.target as AiTaskGroup);
  const root = editing && item ? groupChain(editing.scope === "task" ? (item as Task).group : editing.target as AiTaskGroup).at(-1)! : null;

  async function test(task: Task) {
    setTesting(task.key); setResult(null);
    try {
      const outcome = await api("/api/platform/ai/assignments/test", "POST", { scope: "task", target: task.key });
      setResult({ tone: "status", text: `${task.label}: teste concluído com ${outcome.modelId}.` });
    } catch (cause) { setResult({ tone: "alert", text: `${task.label}: ${cause instanceof Error ? cause.message : "o teste falhou."}` }); }
    finally { setTesting(null); }
  }

  return <AdminBlock labelledBy="task-models-title">
    <AdminBlockHead id="task-models-title" title="Modelos por tarefa" sub="Uma tarefa sem modelo próprio usa o do grupo, e o grupo usa o do grupo acima." />
    <DataTable label="Modelos por tarefa" tall rows={overview.tasks} rowKey={task => task.key} columns={[
      { header: "Tarefa", width: "minmax(0, 1fr)", strong: true, cell: task => task.label, sub: task => task.description },
      { header: "Grupo", width: "168px", cell: task => (
        <button type="button" className={cn(adminQuietAction, "max-w-full truncate text-left")} aria-label={`Editar o grupo ${groupOf(task.group).label}`}
          onClick={() => setEditing({ scope: "group", target: task.group })}>{groupOf(task.group).label}</button>
      ) },
      { header: "Modelo", width: "140px", mono: true, cell: task => modelCell(task.plan), sub: task => task.plan.status === "ready" ? task.plan.connectionName : undefined },
      { header: "Esforço", width: "72px", phone: false, cell: task => effortCell(task.plan, task.group === "transcription") },
      { header: "", width: "104px", align: "end", cell: task => (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <button type="button" className={adminQuietAction} aria-label={`Editar ${task.label}`} onClick={() => setEditing({ scope: "task", target: task.key })}>Editar</button>
          <span aria-hidden="true">·</span>
          <button type="button" className={adminQuietAction} aria-label={`Testar ${task.label}`} disabled={Boolean(testing) || task.plan.status !== "ready"}
            onClick={() => void test(task)}>{testing === task.key ? "Testando…" : "Testar"}</button>
        </span>
      ) },
    ]} />
    {result && (result.tone === "status"
      ? <p role="status" className="text-[12.5px] text-muted-foreground">{result.text}</p>
      : <p role="alert" className="flex items-start gap-2 text-[13.5px] text-destructive"><CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{result.text}</p>)}
    <Dialog open={Boolean(item)} onOpenChange={open => { if (!open) setEditing(null); }}>
      {editing && item && root && <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing.scope === "group" ? `Grupo ${item.label}` : item.label}</DialogTitle>
          <DialogDescription>{item.description}</DialogDescription>
        </DialogHeader>
        <PlanSummary plan={item.plan} level={editing} root={root} />
        <Editor key={`${editing.scope}:${editing.target}`} level={editing} item={item} overview={overview} catalogs={catalogs} assignments={assignments}
          onSaved={next => { setOverview(next); setEditing(null); router.refresh(); }} onCancel={() => setEditing(null)} />
        <p className="text-xs text-muted-foreground">O teste envia uma requisição mínima, sem dados de clientes, e pode gerar uma pequena cobrança.</p>
      </DialogContent>}
    </Dialog>
  </AdminBlock>;
}
