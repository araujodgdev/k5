'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { activityDto, type AgendaActivity } from '@/lib/capabilities/agenda';
import { selectStyle, type Choice } from '@/lib/agenda-client';

const columns = [
  { status: 'pending', title: 'A fazer' },
  { status: 'in_progress', title: 'Em andamento' },
  { status: 'completed', title: 'Concluídas' },
  { status: 'cancelled', title: 'Canceladas' },
] as const;

export function TaskBoard({ activities, members, clients, canWrite, busy, inspect, move, delegate }: {
  activities: AgendaActivity[]; members: Choice[]; clients: Choice[]; canWrite: boolean; busy: boolean;
  inspect: (activity: AgendaActivity) => void;
  move: (activity: AgendaActivity, status: AgendaActivity['status']) => void;
  delegate: (activity: AgendaActivity) => void;
}) {
  return <div role="region" aria-label="Quadro de tarefas" tabIndex={0} className="grid min-w-0 grid-flow-col auto-cols-[85%] overflow-x-auto border-t border-line focus-visible:ring-2 focus-visible:ring-ring md:auto-cols-[45%] xl:grid-flow-row xl:auto-cols-auto xl:grid-cols-4">
    {columns.map(column => {
      const tasks = activities.filter(activity => activity.status === column.status);
      return <section key={column.status} aria-label={column.title} className="min-w-0 border-r border-b border-line px-3 pb-5 first:pl-0">
        <h2 className="flex min-h-14 items-center justify-between gap-3 text-sm font-medium">{column.title}<span className="label-mono text-muted-foreground">{tasks.length}</span></h2>
        <div className="divide-y">{tasks.length ? tasks.map(activity => <article key={activity.id} className="space-y-3 py-4">
          <button type="button" onClick={() => inspect(activity)} className="min-h-11 break-words text-left text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring">{activity.title}</button>
          {activity.notes && <p className="line-clamp-3 break-words text-xs text-muted-foreground">{activity.notes}</p>}
          <p className="text-xs text-muted-foreground">{activity.dueOn ? new Date(`${activity.dueOn}T12:00:00`).toLocaleDateString('pt-BR') : 'Sem data'}</p>
          {(activity.clientId || activity.assigneeId) && <p className="break-words text-xs text-muted-foreground">{[clients.find(item => item.id === activity.clientId)?.name, members.find(item => item.id === activity.assigneeId)?.name].filter(Boolean).join(' · ')}</p>}
          {canWrite && <select aria-label={`Mover ${activity.title}`} className={`${selectStyle} w-full`} value={activity.status} disabled={busy}
            onChange={event => move(activity, activityDto.shape.status.parse(event.target.value))}>
            {columns.map(target => <option key={target.status} value={target.status}>{target.title}</option>)}
          </select>}
          {activity.agentConversationId ? canWrite && (activity.status === 'pending' || activity.status === 'in_progress')
            ? <Button variant="ghost" className="w-full justify-start px-0 text-brand-ink" disabled={busy} onClick={() => delegate(activity)}>Abrir sessão do Lume</Button>
            : <Link className="flex min-h-11 items-center text-sm text-brand-ink underline underline-offset-4" href={`/app/agents?conversationId=${encodeURIComponent(activity.agentConversationId)}${activity.caseId ? `&caseId=${encodeURIComponent(activity.caseId)}` : ''}`}>Abrir sessão do Lume</Link>
            : canWrite && (activity.status === 'pending' || activity.status === 'in_progress') && <Button variant="ghost" className="w-full justify-start px-0 text-brand-ink" disabled={busy} onClick={() => delegate(activity)}>Delegar ao Lume</Button>}
        </article>) : <p className="py-4 text-sm text-muted-foreground">Nenhuma tarefa.</p>}</div>
      </section>;
    })}
  </div>;
}
