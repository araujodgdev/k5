"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Calendar, SquareCheck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CanvasRow } from "@/components/canvas/canvas-page";
import { brl, civilDayMonth, dayMonthTime } from "./labels";

type Task = { id: string; kind: "task" | "meeting"; title: string; status: string; dueOn: string | null; startsAt: string | null };
type Installment = { id: string; agreementId: string; number: number; installmentCount: number; title: string; clientName: string;
  dueOn: string; pendingCents: number; amountCents: number; status: string; overdue: boolean };

type Load<T> = { state: "loading" } | { state: "failed"; message: string } | { state: "ready"; rows: T[] };

const taskStatus: Record<string, string> = { pending: "Pendente", in_progress: "Em andamento", completed: "Concluída", cancelled: "Cancelada" };

/** One POST of a capability route, read when the section opens, and a way to read it again. */
function useRows<T>(url: string, body: unknown, pick: (result: unknown) => T[]): [Load<T>, () => void] {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify(body);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: key, signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        if (!response.ok) throw new Error(result?.error ?? "Não foi possível carregar.");
        setLoad({ state: "ready", rows: pick(result) });
      })
      .catch((cause) => { if (!controller.signal.aborted) setLoad({ state: "failed", message: cause instanceof Error && cause.message ? cause.message : "Não foi possível carregar." }); });
    return () => controller.abort();
  }, [url, key, pick, attempt]);
  return [load, () => { setLoad({ state: "loading" }); setAttempt((value) => value + 1); }];
}

function Rows<T>({ load, label, empty, retry, render }: { load: Load<T>; label: string; empty: string; retry: () => void; render: (row: T) => ReactNode }) {
  if (load.state === "loading") return <p role="status" className="text-[13.5px] text-muted-foreground">Carregando…</p>;
  if (load.state === "failed") {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-[13.5px] text-destructive">
        {load.message}<Button variant="outline" className="max-md:h-11" onClick={retry}>Tentar novamente</Button>
      </div>
    );
  }
  if (!load.rows.length) return <p className="text-[13.5px] text-muted-foreground">{empty}</p>;
  return <div role="list" aria-label={label} className="flex flex-col gap-0.5 md:max-w-[760px]">{load.rows.map(render)}</div>;
}

const pickTasks = (result: unknown) => (result as { activities: Task[] }).activities;
const pickInstallments = (result: unknown) => (result as { installments: Installment[] }).installments;

/** Tarefas: the office's open tasks and meetings tied to this case, as the agenda keeps them. */
export function CaseTasks({ caseId }: { caseId: string }) {
  const [load, retry] = useRows("/api/agenda/activities/list", { caseId, openOnly: true, limit: 50, offset: 0 }, pickTasks);
  return (
    <Rows load={load} label="Tarefas do caso" empty="Nenhuma tarefa aberta neste caso." retry={retry}
      render={(task) => (
        <div key={task.id} role="listitem">
          <CanvasRow stacked href={`/app/agenda/tasks/${task.id}`} icon={task.kind === "meeting" ? <Calendar /> : <SquareCheck />} title={task.title}
            detail={task.kind === "meeting" ? "Reunião" : taskStatus[task.status] ?? task.status}
            meta={<span suppressHydrationWarning>{task.dueOn ? civilDayMonth(task.dueOn) : task.startsAt ? dayMonthTime(task.startsAt) : "sem data"}</span>} />
        </div>
      )} />
  );
}

/** Honorários: the installments still to receive for this case. */
export function CaseFees({ caseId }: { caseId: string }) {
  const [load, retry] = useRows("/api/honorarios/list", { caseId, view: "pending", limit: 50, offset: 0 }, pickInstallments);
  return (
    <Rows load={load} label="Honorários do caso" empty="Nenhum honorário a receber neste caso." retry={retry}
      render={(item) => (
        <div key={item.id} role="listitem">
          <CanvasRow stacked href={`/app/honorarios?agreementId=${encodeURIComponent(item.agreementId)}`} icon={<Wallet />} title={item.title}
            detail={`${item.clientName} · parcela ${item.number} de ${item.installmentCount}`} urgent={item.overdue}
            meta={brl(item.pendingCents)} status={item.overdue ? `venceu ${civilDayMonth(item.dueOn)}` : `vence ${civilDayMonth(item.dueOn)}`} />
        </div>
      )} />
  );
}
