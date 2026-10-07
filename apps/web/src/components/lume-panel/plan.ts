import { statusModule, toolModule, type ToolModule } from "@/lib/chat-status";

/**
 * The Lume's plan for one turn, read from what the turn actually did. The model decides one step at
 * a time, so there is no list of future steps: the plan is the finished tool calls, the actions that
 * wait for the person, and the step running now.
 */
export type StepState = "done" | "failed" | "running" | "needs" | "cancelled";

export type PlanStep = {
  id: string;
  module: ToolModule | null;
  title: string;
  detail: string;
  state: StepState;
  /** What the step created or changed. */
  href?: string;
};

export type Plan = { steps: PlanStep[]; done: number; needs: number; failed: number };

/** A part of the assistant message as the thread holds it: `data-tool` and `data-approval`. */
export type PlanPart = { name: string; data: unknown };

export type ApprovalState = "pending" | "confirmed" | "cancelled" | "failed";
type ApprovalOutcome = { state: ApprovalState; result?: string };

/** The plan card appears from this many steps on; fewer read better as quiet lines. */
export const PLAN_MIN_STEPS = 2;

export const MODULE_LABELS: Record<ToolModule, string> = {
  vault: "Cofre", knowledge: "Cofre", runs: "Documentos", artifacts: "Documentos", conversations: "Conversas",
  memory: "Memória", citations: "Citações", ui: "Lume", session: "Sessão", platform: "Plataforma", judicial: "Processos",
  agenda: "Agenda", research: "Pesquisa", google: "Google", whatsapp: "WhatsApp", honorarios: "Honorários",
  calc: "Cálculos", collaboration: "Equipe", messages: "Mensagens", notifications: "Notificações",
  agent_settings: "Preferências do Lume", help: "Ajuda", web: "Web",
};

const text = (record: Record<string, unknown>, key: string) => typeof record[key] === "string" ? record[key] as string : undefined;
const recordOf = (value: unknown) => value && typeof value === "object" ? value as Record<string, unknown> : null;

/** "Pesquisou na web: vício construtivo" → action and detail. A summary without a colon is all action. */
export function splitSummary(summary: string): { title: string; detail: string } {
  const colon = summary.indexOf(":");
  if (colon < 0) return { title: summary.trim(), detail: "" };
  return { title: summary.slice(0, colon).trim(), detail: summary.slice(colon + 1).trim() };
}

type ToolCall = { callId: string; name: string; summary: string; failed: boolean; href?: string };

function toolCall(data: unknown, index: number): ToolCall | null {
  const record = recordOf(data);
  const summary = record && text(record, "summary");
  // Calls without a summary are the Lume's own plumbing; they were never shown.
  if (!record || !summary) return null;
  return {
    callId: text(record, "callId") ?? `call-${index}`,
    name: text(record, "name") ?? `tool-${index}`,
    summary,
    failed: text(record, "state") === "failed",
    href: text(record, "href"),
  };
}

/** Repeated calls of one tool (three web searches) are one step of the plan. */
function toolSteps(calls: ToolCall[]): PlanStep[] {
  const groups = new Map<string, ToolCall[]>();
  for (const call of calls) groups.set(call.name, [...(groups.get(call.name) ?? []), call]);
  return [...groups.values()].map((group) => {
    const parts = group.map((call) => splitSummary(call.summary));
    const failed = group.filter((call) => call.failed).length;
    const details = [...new Set(parts.map((part) => part.detail).filter(Boolean))];
    const title = parts.find((_, index) => !group[index].failed)?.title ?? parts[0].title;
    const failures = failed && failed < group.length ? [failed === 1 ? "1 falhou" : `${failed} falharam`] : [];
    return {
      id: group[0].callId,
      module: toolModule(group[0].name),
      title,
      detail: [...details, ...failures].join(" · "),
      state: failed === group.length ? "failed" : "done",
      href: group.findLast((call) => call.href && !call.failed)?.href,
    };
  });
}

const APPROVAL_DETAIL: Record<ApprovalState, string> = {
  pending: "Precisa de você: confirme abaixo",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  failed: "Não concluído",
};
const APPROVAL_STEP: Record<ApprovalState, StepState> = { pending: "needs", confirmed: "done", cancelled: "cancelled", failed: "failed" };

/** The first line of what the Lume asks to do, without the colon that introduces its content. */
export function approvalTitle(summary: string): string {
  const line = summary.split("\n").find((value) => value.trim())?.trim() ?? "";
  const title = line.replace(/:$/, "");
  return title.length > 90 ? `${title.slice(0, 87)}…` : title;
}

function approvalStep(data: unknown, decisions: ReadonlyMap<string, ApprovalOutcome>): PlanStep | null {
  const record = recordOf(data);
  const approvalId = record && text(record, "approvalId");
  if (!record || !approvalId) return null;
  const stored = text(record, "state") as ApprovalState | undefined;
  const outcome = decisions.get(approvalId) ?? { state: stored ?? "pending", result: text(record, "result") };
  const state = APPROVAL_STEP[outcome.state] ? outcome.state : "pending";
  return {
    id: approvalId,
    module: toolModule(text(record, "capability") ?? ""),
    title: approvalTitle(text(record, "summary") ?? ""),
    detail: state === "pending" ? APPROVAL_DETAIL.pending : [APPROVAL_DETAIL[state], outcome.result].filter(Boolean).join(" · "),
    state: APPROVAL_STEP[state],
  };
}

/**
 * Builds the plan of one assistant message. `running` is the status line of the turn in progress
 * ("Consultando o Cofre…"), only for the newest message while it runs.
 */
export function buildPlan(parts: readonly PlanPart[], options: { running?: string | null; decisions?: ReadonlyMap<string, ApprovalOutcome> } = {}): Plan {
  const calls = parts.flatMap((part, index) => part.name === "tool" ? [toolCall(part.data, index)].filter((call): call is ToolCall => call !== null) : []);
  const approvals = parts.flatMap((part) => part.name === "approval" ? [approvalStep(part.data, options.decisions ?? new Map())].filter((step): step is PlanStep => step !== null) : []);
  const steps = [...toolSteps(calls), ...approvals];
  if (options.running) steps.push({ id: "running", module: statusModule(options.running), title: options.running, detail: "", state: "running" });
  return {
    steps,
    done: steps.filter((step) => step.state === "done").length,
    needs: steps.filter((step) => step.state === "needs").length,
    failed: steps.filter((step) => step.state === "failed").length,
  };
}

/** Whether the turn reads as a plan: enough finished or waiting steps, not counting the one running. */
export function showsPlan(plan: Plan): boolean {
  return plan.steps.filter((step) => step.state !== "running").length >= PLAN_MIN_STEPS;
}

/** "2 de 4 concluídas · 1 precisa de você", the line beside "Plano do Lume". */
export function planSummary(plan: Plan): string {
  const total = plan.steps.length;
  const parts = [`${plan.done} de ${total} ${total === 1 ? "concluída" : "concluídas"}`];
  if (plan.needs) parts.push(plan.needs === 1 ? "1 precisa de você" : `${plan.needs} precisam de você`);
  if (plan.failed) parts.push(plan.failed === 1 ? "1 com falha" : `${plan.failed} com falha`);
  return parts.join(" · ");
}

/** The header's status: "trabalhando · 2 de 4 tarefas" while running, "precisa de você" while an action waits. */
export function panelStatus(plan: Plan | null, running: boolean): string {
  if (running) return plan && plan.steps.length > 1 ? `trabalhando · ${plan.done} de ${plan.steps.length} tarefas` : "trabalhando";
  return plan?.needs ? "precisa de você" : "";
}
