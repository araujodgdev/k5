import { localDate } from '@/lib/calendar-days';
import type { AgendaActivity } from '@/lib/capabilities/agenda';
import type { CapabilityOutput } from '@/lib/capabilities/contracts';
import type { HonorarioInstallment } from '@/lib/honorarios/contracts';

export type JudicialAlert = CapabilityOutput<'k5_judicial_list_alerts'>['alerts'][number];

export type TodayKind = 'task' | 'meeting' | 'fee' | 'publication';

/** One line of the Hoje list: something that needs the person today, from the office's own data. */
export type TodayItem = {
  key: string;
  kind: TodayKind;
  title: string;
  detail: string | null;
  /** The mono text at the end: "hoje", "15:00", "07/10". */
  when: string;
  dateTime: string;
  /** Why it is urgent, in words for screen readers; the brand dot says it to the eye. */
  urgent: string | null;
  href: string;
  sortAt: number;
  /** Open tasks carry their activity, so the row can complete them. */
  activity?: AgendaActivity;
};

export type TodaySources = {
  tasks: AgendaActivity[];
  meetings: AgendaActivity[];
  fees: HonorarioInstallment[];
  alerts: JudicialAlert[];
};

/** The person's civil day, in the browser's zone like the rest of the agenda. */
export type Day = { today: string; tomorrow: string; start: Date; end: Date };

export function dayOf(now: Date): Day {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { today: localDate(start), tomorrow: localDate(end), start, end };
}

const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
// A dated item without a time sorts after the timed ones of its day.
const endOf = (date: string) => new Date(`${date}T23:59:59.999`).getTime();
const clock = (instant: Date) => instant.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const joined = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ') || null;

function taskItem(task: AgendaActivity, day: Day, caseNames: Record<string, string>): TodayItem | null {
  if (!task.dueOn) return null;
  const late = task.dueOn < day.today;
  return {
    key: `task:${task.id}`, kind: 'task', title: task.title,
    detail: task.caseId ? caseNames[task.caseId] ?? null : null,
    when: late ? shortDate(task.dueOn) : 'hoje', dateTime: task.dueOn,
    urgent: late ? 'Atrasada' : null,
    href: `/app/agenda/tasks/${encodeURIComponent(task.id)}`,
    sortAt: endOf(task.dueOn), activity: task,
  };
}

function meetingItem(meeting: AgendaActivity, day: Day, caseNames: Record<string, string>): TodayItem | null {
  if (!meeting.startsAt) return null;
  const starts = new Date(meeting.startsAt);
  return {
    key: `meeting:${meeting.id}`, kind: 'meeting', title: meeting.title,
    detail: meeting.caseId ? caseNames[meeting.caseId] ?? null : null,
    // A meeting that began before today and is still on shows the day, not yesterday's time.
    when: starts < day.start ? 'hoje' : clock(starts), dateTime: meeting.startsAt,
    urgent: null,
    href: `/app/agenda?view=calendar&activityId=${encodeURIComponent(meeting.id)}`,
    sortAt: starts.getTime(),
  };
}

function feeItem(fee: HonorarioInstallment, day: Day): TodayItem {
  const late = fee.dueOn < day.today;
  const due = late ? 'venceu' : fee.dueOn === day.today ? 'vence hoje' : 'vence amanhã';
  const name = fee.installmentCount > 1 ? `Parcela ${fee.number} de ${fee.installmentCount}` : 'Parcela única';
  return {
    key: `fee:${fee.id}`, kind: 'fee', title: `${name} ${due}`,
    detail: joined(fee.clientName, money(fee.pendingCents)),
    when: shortDate(fee.dueOn), dateTime: fee.dueOn,
    urgent: late ? 'Vencida' : null,
    href: `/app/honorarios?agreementId=${encodeURIComponent(fee.agreementId)}`,
    sortAt: endOf(fee.dueOn),
  };
}

function publicationItem(alert: JudicialAlert, day: Day): TodayItem | null {
  if (!alert.caseId) return null;
  const at = new Date(alert.createdAt);
  return {
    key: `publication:${alert.id}`, kind: 'publication', title: 'Publicação nova',
    detail: joined(alert.caseName, alert.summary),
    when: at >= day.start ? clock(at) : shortDate(localDate(at)), dateTime: alert.createdAt,
    urgent: 'Nova',
    href: `/app/vault/cases/${encodeURIComponent(alert.caseId)}`,
    sortAt: at.getTime(),
  };
}

/** What needs the person today: urgent items first, then in the order the day brings them. */
export function todayItems(sources: TodaySources, day: Day, caseNames: Record<string, string>): TodayItem[] {
  const items = [
    ...sources.tasks.map((task) => taskItem(task, day, caseNames)),
    ...sources.meetings.map((meeting) => meetingItem(meeting, day, caseNames)),
    ...sources.fees.filter((fee) => fee.dueOn <= day.tomorrow).map((fee) => feeItem(fee, day)),
    ...sources.alerts.filter((alert) => alert.eventKind === 'new_publication' && !alert.read).map((alert) => publicationItem(alert, day)),
  ].filter((item): item is TodayItem => item !== null);
  return items.sort((a, b) => Number(!a.urgent) - Number(!b.urgent) || a.sortAt - b.sortAt || a.key.localeCompare(b.key));
}

/** "Terça-feira, 6 de outubro". */
export function dateLine(now: Date) {
  const text = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** When a case changed, as the card says it: "atualizado há 1 h", "atualizado ontem". */
export function updatedLabel(updatedAt: string, now: Date) {
  const at = new Date(updatedAt);
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  const day = dayOf(now);
  if (minutes < 1) return 'atualizado agora';
  if (minutes < 60) return `atualizado há ${minutes} min`;
  if (at >= day.start) return `atualizado há ${Math.floor(minutes / 60)} h`;
  if (at >= new Date(day.start.getFullYear(), day.start.getMonth(), day.start.getDate() - 1)) return 'atualizado ontem';
  return `atualizado em ${shortDate(localDate(at))}`;
}

/** The time of something the Lume did: "09:14" today, "ontem", or the date. */
export function doneLabel(at: string, now: Date) {
  const instant = new Date(at);
  const day = dayOf(now);
  if (instant >= day.start) return clock(instant);
  if (instant >= new Date(day.start.getFullYear(), day.start.getMonth(), day.start.getDate() - 1)) return 'ontem';
  return shortDate(localDate(instant));
}

export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '').slice(0, 2);
  return letters.toUpperCase();
}
