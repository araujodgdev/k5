import type { AgendaActivity } from './capabilities/agenda';

export function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Civil dates for tasks; half-open local-day overlap for meetings, including DST. */
export function calendarDays(month: string, activities: AgendaActivity[]) {
  const [year, index] = month.split('-').map(Number);
  const result: Record<string, number> = {};
  for (let date = new Date(year, index - 1, 1); date.getMonth() === index - 1; date = new Date(year, index - 1, date.getDate() + 1)) {
    const day = localDate(date);
    const next = new Date(year, index - 1, date.getDate() + 1);
    const count = activities.filter(activity => activity.kind === 'task'
      ? activity.dueOn === day
      : !!activity.startsAt && !!activity.endsAt && new Date(activity.startsAt) < next && new Date(activity.endsAt) > date).length;
    if (count) result[day] = count;
  }
  return result;
}
