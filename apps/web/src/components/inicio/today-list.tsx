'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Calendar, Gavel, SquareCheck, Wallet } from 'lucide-react';
import { CanvasRow } from '@/components/canvas/canvas-page';
import { agendaCall } from '@/lib/agenda-client';
import type { AgendaActivity } from '@/lib/capabilities/agenda';
import type { CapabilityName, CapabilityOutput } from '@/lib/capabilities/contracts';
import { requestCapability } from '@/lib/capabilities/http-client';
import { dayOf, todayItems, type TodayItem, type TodayKind } from './today';

const LIST_LIMIT = 50;
const VISIBLE_ROWS = 8;
// A module the person cannot open has nothing for them today; it is not a failure of the list.
const unavailable = new Set(['FORBIDDEN', '403', 'NOT_FOUND', '404']);

const icons: Record<Exclude<TodayKind, 'task'>, ReactNode> = {
  meeting: <Calendar />,
  fee: <Wallet />,
  publication: <Gavel />,
};

type Load = { kind: 'loading' } | { kind: 'ready'; items: TodayItem[]; failed: boolean };

async function read<N extends CapabilityName>(name: N, input: Record<string, unknown>, signal: AbortSignal): Promise<CapabilityOutput<N> | null> {
  const result = await requestCapability(name, input, signal);
  if (result.ok) return result.data as CapabilityOutput<N>;
  if (unavailable.has(result.code)) return null;
  throw new Error(result.error);
}

async function loadToday(caseNames: Record<string, string>, signal: AbortSignal): Promise<Load> {
  const now = new Date();
  const day = dayOf(now);
  const [tasks, meetings, fees, alerts] = await Promise.allSettled([
    read('k5_agenda_list_activities', { kind: 'task', openOnly: true, dueTo: day.today, limit: LIST_LIMIT }, signal),
    read('k5_agenda_list_activities', { kind: 'meeting', openOnly: true, from: now.toISOString(), to: day.end.toISOString(), limit: LIST_LIMIT }, signal),
    read('k5_honorarios_list', { view: 'pending', dueTo: day.tomorrow, limit: LIST_LIMIT }, signal),
    read('k5_judicial_list_alerts', { unreadOnly: true, limit: LIST_LIMIT }, signal),
  ]);
  const value = <T,>(result: PromiseSettledResult<T | null>) => (result.status === 'fulfilled' ? result.value : null);
  const items = todayItems({
    tasks: value(tasks)?.activities ?? [],
    meetings: value(meetings)?.activities ?? [],
    fees: value(fees)?.installments ?? [],
    alerts: value(alerts)?.alerts ?? [],
  }, day, caseNames);
  return { kind: 'ready', items, failed: [tasks, meetings, fees, alerts].some((result) => result.status === 'rejected') };
}

/** The task's lead: an empty square that completes it, drawn like the prototype's task icon. */
function TaskCheck({ task, checked, disabled, onComplete }: { task: AgendaActivity; checked: boolean; disabled: boolean; onComplete: (task: AgendaActivity) => void }) {
  return (
    <label className="relative -m-2 flex size-8 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground has-disabled:cursor-default max-md:after:absolute max-md:after:-inset-1.5">
      <input type="checkbox" aria-label={`Concluir ${task.title}`} checked={checked} disabled={disabled} onChange={() => onComplete(task)}
        className="peer absolute inset-0 m-0 cursor-pointer appearance-none rounded-md outline-ring focus-visible:outline-2 focus-visible:-outline-offset-2 disabled:cursor-default" />
      <SquareCheck aria-hidden="true" className="size-4 [&>path]:opacity-0 [&>path]:transition-opacity peer-checked:[&>path]:opacity-100 peer-hover:[&>path]:opacity-60" />
    </label>
  );
}

/** The Hoje list: what needs the person today, from the agenda, the fees and the courts. */
export function TodayList({ caseNames, today }: { caseNames: Record<string, string>; today: string | null }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const section = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!today) return;
    const controller = new AbortController();
    void loadToday(caseNames, controller.signal).then((next) => {
      if (!controller.signal.aborted) setLoad(next);
    });
    return () => controller.abort();
  }, [caseNames, today, revision]);

  function retry() {
    setLoad({ kind: 'loading' });
    setRevision((value) => value + 1);
  }

  async function complete(task: AgendaActivity) {
    setBusy(task.id); setFailure(''); setNotice('');
    try {
      await agendaCall('k5_agenda_update_activity', { activityId: task.id, version: task.version, status: 'completed', idempotencyKey: crypto.randomUUID() });
      setLoad((current) => current.kind === 'ready' ? { ...current, items: current.items.filter((item) => item.activity?.id !== task.id) } : current);
      setNotice(`Tarefa concluída: ${task.title}`);
      section.current?.focus();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Não foi possível concluir a tarefa.');
    } finally {
      setBusy(null);
    }
  }

  const items = load.kind === 'ready' ? load.items : [];
  const hidden = items.length - VISIBLE_ROWS;
  return (
    <section ref={section} tabIndex={-1} aria-label="Hoje" aria-busy={load.kind === 'loading'} className="flex flex-col outline-none md:-mt-4 md:gap-0.5">
      {load.kind === 'loading' ? <p role="status" className="py-3 text-sm text-muted-foreground">Carregando o que é para hoje…</p> : items.slice(0, VISIBLE_ROWS).map((item) => (
        <CanvasRow key={item.key} title={item.title} detail={item.detail} urgent={Boolean(item.urgent)} href={item.href}
          {...(item.activity
            ? { control: <TaskCheck task={item.activity} checked={busy === item.activity.id} disabled={busy !== null} onComplete={(task) => void complete(task)} /> }
            : { icon: icons[item.kind as Exclude<TodayKind, 'task'>] })}
          meta={<time dateTime={item.dateTime}>{item.urgent && <span className="sr-only">{item.urgent}, </span>}{item.when}</time>} />
      ))}
      {hidden > 0 && <CanvasRow href="/app/agenda?view=tasks" title={`Mais ${hidden} no Escritório`} className="text-muted-foreground" />}
      {load.kind === 'ready' && !items.length && !load.failed && <p className="py-3 text-sm text-muted-foreground">Nada para hoje.</p>}
      {load.kind === 'ready' && load.failed && (
        <p role="alert" className="flex flex-wrap items-baseline gap-x-2 py-3 text-sm text-muted-foreground">
          {items.length ? 'Parte do dia não carregou.' : 'Não foi possível carregar o dia.'}
          <button type="button" onClick={retry} className="rounded-sm text-foreground underline underline-offset-4 outline-ring focus-visible:outline-2 focus-visible:outline-offset-2">Tentar novamente</button>
        </p>
      )}
      {failure && <p role="alert" className="py-2 text-sm text-destructive">{failure}</p>}
      <p aria-live="polite" className="sr-only">{notice}</p>
    </section>
  );
}
