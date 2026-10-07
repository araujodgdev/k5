'use client';

import type { ReactNode } from 'react';
import { Calendar, Check, Clock, Users, X } from 'lucide-react';
import { CanvasRow } from '@/components/canvas/canvas-page';
import { Skeleton } from '@/components/ui/skeleton';
import type { Choice } from '@/lib/agenda-client';
import { localDate } from '@/lib/calendar-days';
import { legalAreaLabels, type AgendaActivity, type CrmClient } from '@/lib/capabilities/agenda';

/** A task's situation in the words of the board's columns. */
export const statusWords = { pending: 'A fazer', in_progress: 'Em andamento', completed: 'Concluída', cancelled: 'Cancelada' } as const;
export const stageLabels = { prospect: 'Potencial cliente', active: 'Cliente ativo', archived: 'Arquivado' } as const;

const weekdays = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const DAY_MS = 86_400_000;
const noon = (date: string) => new Date(`${date}T12:00:00`);
const andList = new Intl.ListFormat('pt-BR', { type: 'conjunction' });

/** "14/10". */
export const dayMonth = (date: string) => noon(date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
export const clockTime = (instant: string) => new Date(instant).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export const addDays = (date: string, days: number) => { const next = noon(date); next.setDate(next.getDate() + days); return localDate(next); };

/**
 * The day in words: "hoje", "amanhã", "ontem", otherwise the weekday ("sexta"). `withDate` adds the
 * date to a weekday outside the coming week ("sexta, 16/10"), for rows whose meta is a time.
 */
export function dayWord(date: string, today: string, { withDate = false } = {}) {
  const days = Math.round((noon(date).getTime() - noon(today).getTime()) / DAY_MS);
  if (days === 0) return 'hoje';
  if (days === 1) return 'amanhã';
  if (days === -1) return 'ontem';
  const weekday = weekdays[noon(date).getDay()];
  return withDate && (days < 0 || days > 6) ? `${weekday}, ${dayMonth(date)}` : weekday;
}

/** "Terça-feira, 6 de outubro". */
export function longDate(date: string) {
  const label = noon(date).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export type Names = { cases: Choice[]; clients: Choice[]; members: Choice[] };
const nameIn = (choices: Choice[], id: string | null) => id ? choices.find(choice => choice.id === id)?.name : undefined;

/** What the activity is about: its case, its client and who is responsible, in that order. */
export function contextOf(activity: AgendaActivity, names: Names) {
  return [nameIn(names.cases, activity.caseId), nameIn(names.clients, activity.clientId), nameIn(names.members, activity.assigneeId)].filter(Boolean).join(' · ') || undefined;
}

const isOpen = (activity: AgendaActivity) => activity.status === 'pending' || activity.status === 'in_progress';

/** An open task due today or earlier carries the urgent dot, in the rows and on the board alike. */
export const isUrgent = (activity: AgendaActivity, today: string) => isOpen(activity) && Boolean(activity.dueOn) && activity.dueOn! <= today;

/** The task checkbox: the prototype's square in the secondary ink, a check once done. */
function TaskCheck({ activity, disabled, onToggle }: { activity: AgendaActivity; disabled: boolean; onToggle: () => void }) {
  const done = activity.status === 'completed';
  return (
    <label className="group/check relative -m-2 flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground has-disabled:cursor-default max-md:after:absolute max-md:after:-inset-1.5">
      <input type="checkbox" aria-label={`${done ? 'Reabrir' : 'Concluir'} ${activity.title}`} checked={done} disabled={disabled} onChange={onToggle}
 className="peer size-[13px] appearance-none rounded-[3px] border border-current checked:border-transparent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:opacity-50" />
 <Check aria-hidden="true" className="pointer-events-none absolute size-2.5 opacity-0 group-hover/check:opacity-70 peer-checked:hidden peer-disabled:hidden" />
 <Check aria-hidden="true" className="pointer-events-none absolute hidden size-4 peer-checked:block" />
 </label>
 );
}

/** A row of Tarefas: the checkbox, the title over its case and client, the due date and the situation. */
export function TaskRow({ activity, today, names, busy, onToggle }: { activity: AgendaActivity; today: string; names: Names; busy: boolean; onToggle: (activity: AgendaActivity) => void }) {
 const open = isOpen(activity);
 const overdue = open && Boolean(activity.dueOn) && activity.dueOn! < today;
 const lead = activity.status ==='cancelled'
    ? { icon: <X /> }
    : { control: <TaskCheck activity={activity} disabled={busy} onToggle={() => onToggle(activity)} /> };
  return (
    <CanvasRow stacked {...lead} title={activity.title} detail={contextOf(activity, names)}
      meta={activity.dueOn ? activity.dueOn === today ? 'hoje' : dayMonth(activity.dueOn) : 'sem data'}
      status={overdue && activity.status === 'pending' ? 'Atrasada' : statusWords[activity.status]}
      urgent={isUrgent(activity, today)}
      href={`/app/agenda/tasks/${encodeURIComponent(activity.id)}`} label={activity.title} />
  );
}

/** When an activity happens, as a civil date: a task's due date, a meeting's local start. */
export const activityDate = (activity: AgendaActivity) => activity.kind === 'meeting' ? localDate(new Date(activity.startsAt!)) : activity.dueOn;

/** A row of Agenda: a meeting at its time, a deadline on its date, and the day in words. */
export function AgendaRow({ activity, today, names, onOpen }: { activity: AgendaActivity; today: string; names: Names; onOpen: (activity: AgendaActivity) => void }) {
  const meeting = activity.kind === 'meeting';
  const date = activityDate(activity);
  const about = contextOf(activity, names);
  const detail = meeting
    ? [`${clockTime(activity.startsAt!)} às ${clockTime(activity.endsAt!)}`, about].filter(Boolean).join(' · ')
    : [isOpen(activity) ? 'Prazo' : statusWords[activity.status], about].filter(Boolean).join(' · ');
  return (
    <CanvasRow stacked icon={meeting ? <Calendar /> : <Clock />} title={activity.title} detail={detail}
      meta={meeting ? clockTime(activity.startsAt!) : date ? dayMonth(date) : ''}
      status={date ? dayWord(date, today, { withDate: meeting }) : undefined}
      urgent={!meeting && isUrgent(activity, today)} label={activity.title}
      {...(meeting ? { onClick: () => onOpen(activity) } : { href: `/app/agenda/tasks/${encodeURIComponent(activity.id)}` })} />
  );
}

/** A row of Clientes: the relationship and areas under the name, the cases on the right. */
export function ClientRow({ client }: { client: CrmClient }) {
  const areas = client.legalAreas.map(area => legalAreaLabels[area]);
  const cases = client.caseIds.length;
  return (
    <CanvasRow stacked icon={<Users />} title={client.name}
      detail={[stageLabels[client.stage], areas.length ? andList.format(areas) : ''].filter(Boolean).join(' · ')}
      meta={cases ? `${cases} ${cases === 1 ? 'caso' : 'casos'}` : 'sem caso'}
      status={[client.city, client.state].filter(Boolean).join('/') || undefined}
      href={`/app/agenda/clients/${encodeURIComponent(client.id)}`} label={client.name} />
  );
}

/** Rows standing in for a list that is still loading. */
export function RowsLoading({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-0.5">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex min-h-14 items-center gap-3 py-2">
          <Skeleton className="size-4 shrink-0 rounded-sm" />
          <div className="flex flex-1 flex-col gap-1.5"><Skeleton className="h-3.5 w-2/5" /><Skeleton className="h-3 w-3/5" /></div>
          <Skeleton className="h-3.5 w-12" />
        </div>
      ))}
    </div>
  );
}

/** The quiet sentence of an empty list. */
export function EmptyRows({ children }: { children: ReactNode }) {
  return <p className="py-3 text-[13.5px] text-muted-foreground">{children}</p>;
}
