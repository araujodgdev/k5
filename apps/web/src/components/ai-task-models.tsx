"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AssignmentOverview, AssignmentView, Origin, TaskModelPlan } from "@/lib/ai-assignments-core";
import type { AiProvider } from "@/lib/ai-connections-core";
import {
  AI_TASK_DEFINITIONS, AI_TASK_GROUP_DEFINITIONS, AI_TASK_KEYS, REASONING_EFFORTS, groupChain, reasoningEffortLabels, supportsReasoningEffort,
  type AiTaskGroup, type AiTaskKey, type ReasoningEffort,
} from "@/lib/ai-tasks";

// 44px controls on touch, default height from md up.
const touch = "h-11 md:h-9";
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
    : origin.scope === "default" ? (root === "transcription" ? "segue o provider do Agente" : "padrão do Tises: primeira conexão ativa")
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

/**
 * Which tasks a change at this level reaches: those whose chain passes through it with nothing
 * set below. The rest keep a choice of their own, which the administrator should see before saving.
 */
function reach(level: Level, assignments: Map<string, AssignmentView>) {
  const tasks = level.scope === "task" ? [level.target as AiTaskKey] : AI_TASK_KEYS.filter(task => groupChain(AI_TASK_DEFINITIONS[task].group).includes(level.target as AiTaskGroup));
  return tasks.map(task => {
    const levels = levelsOf(task);
    const below = levels.slice(0, levels.findIndex(item => item.scope === level.scope && item.target === level.target));
    const own = below.map(item => assignments.get(`${item.scope}:${item.target}`));
    return { task, model: own.every(row => !row || row.model.mode === "inherit"), effort: own.every(row => !row || row.effort.mode === "inherit") };
  });
}

function Reach({ level, assignments }: { level: Level; assignments: Map<string, AssignmentView> }) {
  if (level.scope === "task") return null;
  const items = reach(level, assignments);
  const follow = items.filter(item => item.model || item.effort)
    .map(item => `${AI_TASK_DEFINITIONS[item.task].label}${item.model && !item.effort ? " (só o modelo)" : !item.model ? " (só o esforço)" : ""}`);
  const own = items.filter(item => !item.model && !item.effort).map(item => AI_TASK_DEFINITIONS[item.task].label);
  return <p className="text-muted-foreground text-xs sm:col-span-2">
    {follow.length ? `Vale para: ${follow.join(", ")}.` : "Nenhuma tarefa segue este nível agora."}
    {own.length ? ` Continuam com escolha própria: ${own.join(", ")}.` : ""}
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
  const inheritLabel = parent ? `Herdar de ${labelOf(parent)}` : group.key === "transcription" ? "Seguir o provider do Agente" : "Padrão do Tises (primeira conexão ativa)";

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

  return <form onSubmit={save} aria-busy={busy} className="mt-4 grid gap-4 border-t border-dashed pt-4 sm:grid-cols-2">
    <fieldset disabled={busy} className="contents">
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor={`${id}-mode`}>Modelo</Label>
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
            <Label htmlFor={`${id}-connection`}>Conexão</Label>
            <Select value={draft.connectionId} onValueChange={value => setDraft({ ...draft, connectionId: value })}>
              <SelectTrigger id={`${id}-connection`} className="w-full"><SelectValue placeholder="Escolha a conexão" /></SelectTrigger>
              <SelectContent position="popper">{connections.map(entry => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-list`}>Escolher da lista</Label>
            <Select value={listed} onValueChange={value => setDraft({ ...draft, modelId: value === "custom" ? "" : value })}>
              <SelectTrigger id={`${id}-list`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent position="popper">
                {suggestions.map(model => <SelectItem key={model} value={model}>{model}</SelectItem>)}
                <SelectItem value="custom">ID digitado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor={`${id}-model`}>ID do modelo</Label>
            <Input id={`${id}-model`} className={touch} value={draft.modelId} onChange={event => setDraft({ ...draft, modelId: event.target.value })}
              maxLength={160} required autoComplete="off" spellCheck={false} placeholder={transcription ? "Ex.: gpt-4o-mini-transcribe" : "Ex.: gpt-6-luna"} />
          </div>
        </>)}
      {transcription
        ? <p className="text-muted-foreground text-xs sm:col-span-2">A transcrição não usa esforço de raciocínio.</p>
        : <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor={`${id}-effort`}>Esforço de raciocínio</Label>
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
        <Button type="submit" className={touch} disabled={busy || (draft.model === "explicit" && (!connection || !draft.modelId.trim()))}>{busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}Salvar</Button>
        <Button type="button" variant="ghost" className={touch} onClick={onCancel}>Cancelar</Button>
        {busy && <span role="status" className="text-muted-foreground text-xs">Salvando…</span>}
      </div>
      {error && <p role="alert" className="flex items-start gap-2 text-destructive text-sm sm:col-span-2"><CircleAlert className="mt-0.5 size-4 shrink-0" />{error}</p>}
    </fieldset>
  </form>;
}

function Row({ level, item, root, overview, catalogs, assignments, editing, setEditing, onSaved, nested }: {
  level: Level; item: Group | Task; root: AiTaskGroup; overview: AssignmentOverview; catalogs: Catalogs; assignments: Map<string, AssignmentView>;
  editing: string | null; setEditing: (key: string | null) => void; onSaved: (overview: AssignmentOverview) => void; nested?: boolean;
}) {
  const key = `${level.scope}:${level.target}`;
  const open = editing === key;
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const own = item.assignment && (item.assignment.model.mode !== "inherit" || item.assignment.effort.mode !== "inherit");
  async function test() {
    setTesting(true); setNotice(""); setError("");
    try { const result = await api("/api/platform/ai/assignments/test", "POST", level); setNotice(`Teste concluído com ${result.modelId}.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "O teste falhou."); }
    finally { setTesting(false); }
  }
  const Heading = nested ? "h5" : "h4";
  return <div className={nested ? "border-t py-4 md:pl-6" : "py-6"}>
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
      <div className="min-w-0 md:w-2/5">
        <Heading className={nested ? "text-sm font-medium" : "font-medium"}>{item.label}</Heading>
        <p className="mt-0.5 text-muted-foreground text-xs">{item.description}</p>
      </div>
      <div className="min-w-0 flex-1">
        {nested && !own ? <p className="text-sm text-subtle-foreground">Segue o grupo.</p> : <PlanSummary plan={item.plan} level={level} root={root} />}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button type="button" variant="outline" className={touch} aria-expanded={open} onClick={() => setEditing(open ? null : key)}>{open ? "Fechar" : nested && !own ? "Personalizar" : "Editar"}</Button>
        <Button type="button" variant="ghost" className={touch} disabled={testing || item.plan.status !== "ready"} onClick={() => void test()}>{testing && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}Testar</Button>
      </div>
    </div>
    {(testing || notice || error) && <div className="mt-2 text-xs">
      {testing && <span role="status" className="text-muted-foreground">Testando…</span>}
      {notice && <span role="status" className="text-muted-foreground">{notice}</span>}
      {error && <span role="alert" className="flex items-start gap-2 text-destructive"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{error}</span>}
    </div>}
    {open && <Editor level={level} item={item} overview={overview} catalogs={catalogs} assignments={assignments}
      onSaved={next => { onSaved(next); setEditing(null); }} onCancel={() => setEditing(null)} />}
  </div>;
}

/** Tises' models per group of tasks, with exceptions per task. One configuration serves every office. */
export function AiTaskModels({ initial, catalogs }: { initial: AssignmentOverview; catalogs: Catalogs }) {
  const router = useRouter();
  const [overview, setOverview] = useState(initial);
  const [received, setReceived] = useState(initial);
  // A refresh after a connection change brings a new overview from the server.
  if (initial !== received) { setReceived(initial); setOverview(initial); }
  const [editing, setEditing] = useState<string | null>(null);
  // The connections list shows what each one serves, so it is refreshed after a save.
  const saved = (next: AssignmentOverview) => { setOverview(next); router.refresh(); };
  const assignments = new Map<string, AssignmentView>([
    ...overview.groups.map(group => [`group:${group.key}`, group.assignment] as const),
    ...overview.tasks.map(task => [`task:${task.key}`, task.assignment] as const),
  ]);
  return <section className="border-b pb-8" aria-labelledby="task-models-title">
    <h3 id="task-models-title" className="font-medium">Modelos por tarefa</h3>
    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Cada grupo define conexão, modelo e esforço para as suas tarefas. Uma tarefa pode ter escolha própria; sem ela, segue o grupo. O teste envia uma requisição mínima, sem dados de clientes, e pode gerar uma pequena cobrança.</p>
    <div className="mt-2">
      {overview.groups.map(group => {
        const root = groupChain(group.key).at(-1)!;
        return <article key={group.key} className="border-t first:border-t-0">
          <Row level={{ scope: "group", target: group.key }} item={group} root={root} overview={overview} catalogs={catalogs} assignments={assignments}
            editing={editing} setEditing={setEditing} onSaved={saved} />
          <div className="pb-2">
            {overview.tasks.filter(task => task.group === group.key).map(task =>
              <Row key={task.key} nested level={{ scope: "task", target: task.key }} item={task} root={root} overview={overview} catalogs={catalogs}
                assignments={assignments} editing={editing} setEditing={setEditing} onSaved={saved} />)}
          </div>
        </article>;
      })}
    </div>
  </section>;
}
